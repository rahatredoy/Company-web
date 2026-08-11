#!/usr/bin/env node
/**
 * Starts every app of the platform from the repository root, in ONE terminal.
 *
 *   company-web     3000    company-api   4000
 *   company-admin   3001    client-api    4100
 *   client-admin    3002
 *   client-store    3003
 *
 * Each app still runs its own `npm run dev` in its own folder with its own
 * node_modules — this only spawns them, it does not link them. Output is
 * prefixed per app so six log streams stay readable, and one Ctrl+C stops all
 * six (dev.ps1 remains the one-window-per-app alternative).
 *
 * Deliberately dependency-free: the root holds no node_modules and no lockfile,
 * so nothing here can shadow or hoist an app's own dependency tree.
 *
 *   node dev.mjs                 all six
 *   node dev.mjs company         company-api + company-web + company-admin
 *   node dev.mjs client          client-api + client-admin + client-store
 *   node dev.mjs api | web       both APIs | all four Next apps
 *   node dev.mjs all --workers   plus the two BullMQ workers
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';

const APPS = [
  { name: 'company-api', path: 'company/company-api', script: 'dev', port: 4000, side: 'company', kind: 'api', color: 36 },
  { name: 'company-web', path: 'company/company-web', script: 'dev', port: 3000, side: 'company', kind: 'web', color: 32 },
  { name: 'company-admin', path: 'company/company-admin', script: 'dev', port: 3001, side: 'company', kind: 'web', color: 33 },
  { name: 'client-api', path: 'client/client-api', script: 'dev', port: 4100, side: 'client', kind: 'api', color: 35 },
  { name: 'client-admin', path: 'client/client-admin', script: 'dev', port: 3002, side: 'client', kind: 'web', color: 34 },
  { name: 'client-store', path: 'client/client-store', script: 'dev', port: 3003, side: 'client', kind: 'web', color: 96 },
];

const WORKERS = [
  { name: 'company-worker', path: 'company/company-api', script: 'worker:dev', port: null, color: 90 },
  { name: 'client-worker', path: 'client/client-api', script: 'worker:dev', port: null, color: 90 },
];

const TARGETS = {
  all: () => APPS,
  company: () => APPS.filter((a) => a.side === 'company'),
  client: () => APPS.filter((a) => a.side === 'client'),
  api: () => APPS.filter((a) => a.kind === 'api'),
  web: () => APPS.filter((a) => a.kind === 'web'),
};

// --- Arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const withWorkers = argv.includes('--workers') || argv.includes('-w');
const target = argv.find((arg) => !arg.startsWith('-')) ?? 'all';

if (!TARGETS[target]) {
  console.error(`Unknown target "${target}". Use one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

const selected = withWorkers ? [...TARGETS[target](), ...WORKERS] : TARGETS[target]();
const width = Math.max(...selected.map((a) => a.name.length));

// --- Output ------------------------------------------------------------------

const paint = (code, text) => `[${code}m${text}[0m`;
const dim = (text) => paint(90, text);

function emit(app, line) {
  process.stdout.write(`${paint(app.color, app.name.padEnd(width))} ${dim('│')} ${line}\n`);
}

/** Buffers partial chunks so a prefix is only ever written at a real line start. */
function prefixStream(stream, app) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) emit(app, line.replace(/\r$/, ''));
  });
  stream.on('end', () => {
    if (buffer) emit(app, buffer);
  });
}

// --- Pre-flight --------------------------------------------------------------
// A missing dependency is fatal. A port already listening is not: that app is
// simply already up, so it is skipped and the rest still start.

/** Resolves true when something is already accepting connections on the port. */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

const toStart = [];
let blocked = false;

for (const app of selected) {
  const full = join(root, app.path);

  if (!existsSync(full)) {
    console.log(`${paint(31, 'MISSING')}  ${app.name} -> ${app.path} does not exist`);
    blocked = true;
    continue;
  }

  if (!existsSync(join(full, 'node_modules'))) {
    console.log(`${paint(31, 'MISSING')}  ${app.name} has no node_modules - run: cd "${full}" && npm install`);
    blocked = true;
    continue;
  }

  if (app.port !== null && (await portInUse(app.port))) {
    console.log(dim(`running  ${app.name} :${app.port} already up - skipped`));
    continue;
  }

  toStart.push(app);
}

if (blocked) {
  console.log(`\n${paint(33, 'Install the missing dependencies above, then run this again.')}`);
  process.exit(1);
}

if (toStart.length === 0) {
  console.log(`\n${paint(36, 'Everything selected is already running.')}`);
  process.exit(0);
}

// --- Launch ------------------------------------------------------------------

const children = new Map();

// Piping stdout costs the children their TTY, and with it their colours — asking
// for them back, unless this shell has opted out of colour altogether.
const childEnv = { ...process.env };
if (!process.env.NO_COLOR) childEnv.FORCE_COLOR = '1';

for (const app of toStart) {
  // Windows: npm is a .cmd shim, which Node refuses to exec without a shell, so
  // the command goes over as one pre-built string — passing an args array
  // alongside shell:true is deprecated (DEP0190) because it is not escaped.
  // POSIX: no shell, but its own process group so shutdown can take the tree.
  // Either way the path with spaces travels in `cwd`, never the command line.
  const child = isWindows
    ? spawn(`npm run ${app.script}`, {
        cwd: join(root, app.path),
        shell: true,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawn('npm', ['run', app.script], {
        cwd: join(root, app.path),
        detached: true,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

  children.set(app.name, child);
  prefixStream(child.stdout, app);
  prefixStream(child.stderr, app);

  child.on('error', (error) => {
    emit(app, paint(31, `failed to start: ${error.message}`));
    children.delete(app.name);
  });

  child.on('exit', (code, signal) => {
    children.delete(app.name);
    if (!shuttingDown) {
      emit(app, paint(31, `exited (${signal ?? `code ${code}`}) - the other apps keep running`));
      if (children.size === 0) process.exit(code ?? 0);
    }
  });

  console.log(`${paint(32, 'started')}  ${app.name}${app.port ? ` :${app.port}` : ''}`);
}

console.log(`\n${paint(36, 'Local URLs')}`);
for (const app of selected.filter((a) => a.port)) {
  console.log(`${app.name.padEnd(width)}  http://localhost:${app.port}`);
}
console.log(dim('\nCtrl+C once stops every app started here.\n'));

// --- Shutdown ----------------------------------------------------------------

let shuttingDown = false;

/**
 * npm is only the parent of the real dev server, so on Windows the whole tree
 * has to go — killing the shim alone would leave orphaned servers holding ports.
 */
function stopAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(dim('\nstopping…'));

  for (const child of children.values()) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    try {
      if (isWindows) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGTERM'); // negative pid = the whole group
      }
    } catch {
      // Already gone between the check and the kill — nothing left to stop.
    }
  }

  // Give the tree a moment to unwind, then leave regardless.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
process.on('exit', stopAll);
