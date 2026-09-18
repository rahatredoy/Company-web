#!/usr/bin/env node
/**
 * What typecheck cannot see about the translations.
 *
 *   node scripts/i18n-audit.mjs                     # the whole app
 *   node scripts/i18n-audit.mjs src/components/admin/product-form.tsx …
 *   node scripts/i18n-audit.mjs --strict            # exit 1 on any finding
 *
 * `tsc` already refuses `t('…')` of a key the Bangla dictionary does not hold.
 * What it cannot refuse is text that never went through `t()` at all — a
 * `<p>Nothing here yet.</p>` compiles, renders, and stays English on a Bangla
 * panel. So this reports, per file:
 *
 *   - text between JSX tags, and English in `label=` / `title=` /
 *     `placeholder=` / `aria-label=` style attributes;
 *   - a string literal handed straight to `toast…()` or `setError()`;
 *   - a capitalised `label:` / `title:` / `description:` property whose value
 *     is not a dictionary key (one that *is* a key is translated where drawn).
 *
 * And, about the dictionaries themselves (these always fail the run):
 *
 *   - a key defined in two files with two different translations — the merge in
 *     `messages/bn/index.ts` keeps whichever is spread last, silently;
 *   - a translation whose `{placeholders}` differ from its key's, which renders
 *     a literal `{count}` or drops the value.
 *
 * A line can opt out with `// i18n-ignore` on it or on the line above — for
 * text that is genuinely not language (a CSS class list that matched, a code
 * sample, a unit such as `kg`).
 *
 * Heuristic on purpose: it reads source as text rather than parsing it, so it
 * has no dependency and runs in a second. It over-reports rather than under.
 * **A deliberate copy** in `client-store/scripts/`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const DICTIONARY_DIR = join(SRC, 'lib', 'i18n', 'messages', 'bn');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const targets = args.filter((arg) => !arg.startsWith('--')).map((arg) => resolve(ROOT, arg));

// ---------------------------------------------------------------- dictionary --

const STRING = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;
const ENTRY = new RegExp(String.raw`^\s*(${STRING})\s*:\s*(${STRING})\s*,?\s*(?://.*)?$`);

function unquote(literal) {
  const body = literal.slice(1, -1);
  return body.replace(/\\(.)/g, (_, char) => ({ n: '\n', t: '\t' })[char] ?? char);
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');

const dictionary = new Map(); // key -> { value, file, line }
const dictionaryErrors = [];

for (const name of readdirSync(DICTIONARY_DIR)) {
  if (!name.endsWith('.ts') || name === 'index.ts') continue;
  const file = join(DICTIONARY_DIR, name);
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((text, index) => {
      const match = ENTRY.exec(text);
      if (!match) return;
      const key = unquote(match[1]);
      const value = unquote(match[2]);
      const where = `${relative(ROOT, file)}:${index + 1}`;

      const english = key.includes('::') ? key.slice(0, key.indexOf('::')) : key;
      if (placeholders(english) !== placeholders(value)) {
        dictionaryErrors.push(`${where}  placeholders differ: '${key}' → '${value}'`);
      }
      if (!value.trim()) dictionaryErrors.push(`${where}  empty translation for '${key}'`);

      const seen = dictionary.get(key);
      if (seen && seen.value !== value) {
        dictionaryErrors.push(`${where}  '${key}' is also defined at ${seen.where} as '${seen.value}'`);
      } else if (seen) {
        dictionaryErrors.push(`${where}  '${key}' is a duplicate of ${seen.where} — keep one`);
      } else {
        dictionary.set(key, { value, where });
      }
    });
}

// ------------------------------------------------------------------- sources --

function walk(path, out = []) {
  const stat = statSync(path);
  if (stat.isFile()) {
    if (/\.(tsx?|mts)$/.test(path)) out.push(path);
    return out;
  }
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const child = join(path, name);
    if (child.startsWith(join(SRC, 'lib', 'i18n'))) continue;
    walk(child, out);
  }
  return out;
}

const files = (targets.length > 0 ? targets : [SRC]).flatMap((target) => walk(target));

/** Letters that make a phrase: two in a row, so `x`, `%`, `—` and `/` pass. */
const WORDY = /[A-Za-z]{2,}/;

const ATTRIBUTES =
  'label|title|placeholder|description|aria-label|alt|helper|hint|emptyTitle|emptyDescription|confirmLabel|cancelLabel|submitLabel|tooltip|heading|subtitle|caption';

const JS_WORDS =
  /^(?:import|export|return|const|let|var|type|interface|function|case|default|await|async|if|else|throw|new|for|while|switch|try|catch|finally|yield|typeof|keyof|extends|implements|declare|readonly|private|public|protected|static|enum|namespace|as|from|of|in|void|null|undefined|true|false|this|super|break|continue|delete|do|with)\b/;

const rules = [
  {
    name: 'jsx text',
    // Between a tag's close and the next open, not starting inside an expression.
    pattern: />([^<>{}`;=]*[A-Za-z]{2,}[^<>{}`;=]*)</g,
    // A type argument or a comparison — `Promise<void>`, `a > b && c < d` — is not markup.
    accept: (text) => !/^\s*[a-z_$][\w.$]*\s*$/.test(text) && !/(=>|&&|\|\||\?\?|[()])/.test(text),
  },
  {
    /*
     * JSX text that wraps: a line inside an element that is nothing but words.
     * Expressions are blanked first so `The {count} orders already` still reads
     * as a sentence, and anything with code punctuation left over is not one.
     */
    name: 'jsx text (wrapped line)',
    pattern: /^(.*)$/g,
    accept: (text) => {
      const words = text.replace(/\{[^{}]*\}/g, ' ').trim();
      if (!/^[A-Za-z(]/.test(words) || JS_WORDS.test(words)) return false;
      if (/[=;<>{}`[\]]|=>|\?\.|&&|\|\||^\w+\s*:|^\w+\(|\w\.\w|\)\s*$|,\s*$|'|"/.test(words.replace(/[’']\w/g, 'x'))) return false;
      return (words.match(/[A-Za-z]{2,}/g) ?? []).length >= 3;
    },
  },
  {
    name: 'attribute',
    pattern: new RegExp(String.raw`\b(?:${ATTRIBUTES})=(?:"([^"]*)"|'([^']*)'|\{\s*'([^']*)'\s*\}|\{\s*"([^"]*)"\s*\}|\{\`([^\`]*)\`\})`, 'g'),
    accept: () => true,
  },
  {
    name: 'toast/error literal',
    pattern: /\b(?:toast(?:\.\w+)?|setError|setMessage|setNotice|reject|alert)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g,
    accept: () => true,
  },
  {
    name: 'property not in dictionary',
    pattern: /\b(?:label|title|description|message|placeholder|heading|hint|empty)\s*:\s*'([A-Z][^']*)'/g,
    accept: (text) => !dictionary.has(text),
  },
];

const findings = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inBlockComment = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      return;
    }
    // `/*` or `{/*` opening a comment that this line does not close — but not the
    // `/*` inside `accept="image/*"`, which is preceded by a word character.
    const opened = /(^|[\s{(])\/\*/.exec(line);
    if (opened && !line.slice(opened.index).includes('*/')) {
      inBlockComment = true;
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ')) return;
    if (line.includes('i18n-ignore') || (lines[index - 1] ?? '').includes('i18n-ignore')) return;

    for (const rule of rules) {
      for (const match of line.matchAll(rule.pattern)) {
        const text = match.slice(1).find((group) => group !== undefined) ?? '';
        if (!WORDY.test(text)) continue;
        // Class lists and identifiers are not copy.
        if (/^[\w-]+(\s+[\w:/[\]().%-]+)*$/.test(text.trim()) && /[-:[]/.test(text)) continue;
        if (/^\$\{[^}]*\}$/.test(text.trim())) continue;
        if (!rule.accept(text, line)) continue;
        findings.push({ file: relative(ROOT, file), line: index + 1, rule: rule.name, text: text.trim() });
      }
    }
  });
}

// ------------------------------------------------------------------- report --

if (dictionaryErrors.length > 0) {
  console.log(`\nDictionary problems (${dictionaryErrors.length}):`);
  for (const error of dictionaryErrors) console.log(`  ${error}`);
}

const byFile = new Map();
for (const finding of findings) {
  if (!byFile.has(finding.file)) byFile.set(finding.file, []);
  byFile.get(finding.file).push(finding);
}

for (const [file, list] of [...byFile].sort()) {
  console.log(`\n${file} (${list.length})`);
  for (const finding of list) {
    console.log(`  ${String(finding.line).padStart(5)}  ${finding.rule.padEnd(28)} ${finding.text.slice(0, 90)}`);
  }
}

console.log(
  `\n${dictionary.size} dictionary entries · ${files.length} files scanned · ` +
    `${findings.length} possible untranslated strings · ${dictionaryErrors.length} dictionary problems`,
);

process.exit(dictionaryErrors.length > 0 || (strict && findings.length > 0) ? 1 : 0);
