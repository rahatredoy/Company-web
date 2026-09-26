/**
 * Gives the demo store pictures that match their products, hosted on the
 * store's own R2 bucket.
 *
 *   npx tsx scripts/rehost-demo-images.ts --slug e-comarch --dry   # plan only
 *   npx tsx scripts/rehost-demo-images.ts --slug e-comarch         # download, upload, rewrite
 *
 * The seed pointed every picture at loremflickr, which picks a photo by keyword
 * (`…/600/600/dslr,camera?lock=103`). loremflickr now answers anything that is
 * not a browser with a 401 "Bot check" page, and the storefront fetches every
 * image on the server, so a deployed store showed no pictures at all.
 * `replace-demo-images.ts` moved them to picsum.photos, which loads but is
 * random — a phone became a mountain.
 *
 * This keeps the keyword and drops the third party: for each keyword it asks
 * Wikimedia Commons for matching photographs, downloads one per picture, puts
 * it in R2 under `stores/<tenantRef>/demo/`, and rewrites the URL to R2's public
 * address. It reads either form of the seed URL, loremflickr or the picsum seed
 * that `replace-demo-images.ts` left, so it works whichever ran last.
 *
 * Two pictures that had different locks under one keyword get different
 * photographs where Commons has enough of them. Commons pictures are free
 * licences (mostly CC BY / BY-SA): fine for a demo, and the reason this is not
 * a way to fill a real shop.
 *
 * Idempotent: a rewritten URL is an R2 address and no longer matches. The
 * audit log is skipped for the reason the other two scripts give.
 */
import { writeFileSync } from 'node:fs';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { STOREFRONT_CACHE_SCOPE, invalidateTenantCache } from '../src/lib/cache';
import { fetchTenantBySlug } from '../src/lib/company-client';
import { putObject } from '../src/lib/storage';
import { closeRedis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const SLUG = arg('slug') ?? config.devStoreSlug;
const DRY = process.argv.includes('--dry');
const USER_AGENT = 'e-comarch-demo-seeder/1.0 (demo store picture rehost)';
const CONCURRENCY = 2;

if (!SLUG) {
  console.error('No store. Pass --slug <store-slug>, or set DEV_STORE_SLUG in .env.');
  process.exit(1);
}

/** Both shapes the seed URL can be in; groups are keyword, lock. */
const SEED_URL_RE =
  /https?:\/\/(?:loremflickr\.com\/\d+\/\d+\/([^"\s\\?]+)(?:\?lock=(\d+))?|picsum\.photos\/seed\/([^"\s\\/]+?)-(\d*)\/\d+\/\d+)/g;

type Column = { table_name: string; column_name: string; data_type: string };
type Seed = { keyword: string; lock: number };

const SKIP_TABLES = new Set(['admin_audit_logs']);

function parse(url: string): Seed | null {
  SEED_URL_RE.lastIndex = 0;
  const m = SEED_URL_RE.exec(url);
  if (!m) return null;
  const keyword = decodeURIComponent(m[1] ?? m[3] ?? '');
  return keyword ? { keyword, lock: Number(m[2] ?? m[4] ?? 0) || 0 } : null;
}

/** File titles that are about the subject rather than a picture of it. */
const NOT_A_PRODUCT_PHOTO = /\b(map|chart|graph|diagram|logo|ownership|statistic|flag|rifle|gun|weapon|coat of arms|poster|screenshot|patent)\b/i;

/** Photographs on Commons matching a keyword, best match first, as ~960px JPEG thumbnails. */
async function commonsPhotos(keyword: string): Promise<string[]> {
  const search = async (terms: string) => {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch: `${terms} filetype:bitmap`,
      gsrlimit: '40',
      prop: 'imageinfo',
      iiprop: 'url|mime',
      iiurlwidth: '800',
    });
    // Commons throttles bursts with a 429, and a throttled search reads exactly
    // like a keyword with no photographs — so wait and ask again rather than
    // give up. The first run lost 280 of 294 keywords that way.
    let response: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
        headers: { 'user-agent': USER_AGENT },
      }).catch(() => null);
      if (response?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
    }
    if (!response?.ok) {
      console.log(`  search failed for "${terms}" (${response?.status ?? 'no response'})`);
      return [];
    }
    const body = (await response.json()) as {
      query?: {
        pages?: Record<string, { index: number; title: string; imageinfo?: { thumburl?: string; mime?: string }[] }>;
      };
    };
    const words = terms.toLowerCase().split(/\s+/).filter(Boolean);
    const named = (title: string) => words.some((word) => title.toLowerCase().includes(word));
    return Object.values(body.query?.pages ?? {})
      .filter((page) => page.imageinfo?.[0]?.mime === 'image/jpeg' && page.imageinfo[0].thumburl)
      .filter((page) => !NOT_A_PRODUCT_PHOTO.test(page.title))
      // A file named after the thing is far more often a picture of it than a
      // file that only mentions it in its description.
      .sort((a, b) => Number(named(b.title)) - Number(named(a.title)) || a.index - b.index)
      .map((page) => page.imageinfo![0]!.thumburl!);
  };

  const terms = keyword.replace(/[,+]/g, ' ').trim();
  let found = await search(terms);
  // A three-word keyword can be too narrow; its last word is usually the noun.
  if (found.length < 3 && terms.includes(' ')) found = [...found, ...(await search(terms.split(' ').pop()!))];
  return [...new Set(found)];
}

async function download(url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } }).catch(() => null);
    if (response?.ok) return Buffer.from(await response.arrayBuffer());
    // Commons answers 429 when thumbnails are asked for too quickly.
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
  return null;
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run));
}

async function main(): Promise<void> {
  console.log(`Store: ${SLUG}${DRY ? '  (dry run)' : ''}\n`);

  const tenant = await fetchTenantBySlug(SLUG!);
  if (!tenant) throw new Error(`No tenant "${SLUG}".`);
  const pool = await openTenantPoolForSlug(SLUG!);

  try {
    const { rows: columns } = await pool.query<Column>(
      `select c.table_name, c.column_name, c.data_type
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
          and c.data_type in ('text', 'character varying', 'jsonb', 'json')`,
    );

    // Every row holding a seed URL, by ctid so a table needs no known key.
    const hits: { table: string; column: string; isJson: boolean; ctid: string; value: string }[] = [];
    for (const column of columns) {
      if (SKIP_TABLES.has(column.table_name)) continue;
      const isJson = column.data_type.startsWith('json');
      const expr = isJson ? `"${column.column_name}"::text` : `"${column.column_name}"`;
      const { rows } = await pool.query<{ ctid: string; value: string }>(
        `select ctid::text as ctid, ${expr} as value from "${column.table_name}"
          where ${expr} like '%loremflickr.com/%' or ${expr} like '%picsum.photos/seed/%'`,
      );
      for (const row of rows) hits.push({ table: column.table_name, column: column.column_name, isJson, ctid: row.ctid, value: row.value });
    }

    const urls = new Set<string>();
    for (const hit of hits) for (const m of hit.value.matchAll(SEED_URL_RE)) urls.add(m[0]);

    // Locks per keyword, in order, so the n-th lock gets the n-th photograph.
    const byKeyword = new Map<string, number[]>();
    for (const url of urls) {
      const seed = parse(url);
      if (!seed) continue;
      const locks = byKeyword.get(seed.keyword) ?? [];
      if (!locks.includes(seed.lock)) locks.push(seed.lock);
      byKeyword.set(seed.keyword, locks);
    }
    for (const locks of byKeyword.values()) locks.sort((a, b) => a - b);

    console.log(`${hits.length} value(s), ${urls.size} distinct picture URL(s), ${byKeyword.size} keyword(s).`);
    if (DRY || urls.size === 0) return;

    // Keyword → candidate photographs.
    const photos = new Map<string, string[]>();
    let searched = 0;
    // One search at a time, spaced out: Commons throttles anything faster.
    await inBatches([...byKeyword.keys()], 1, async (keyword) => {
      photos.set(keyword, await commonsPhotos(keyword));
      await new Promise((resolve) => setTimeout(resolve, 400));
      searched += 1;
      if (searched % 25 === 0) console.log(`  searched ${searched}/${byKeyword.size}`);
    });
    const empty = [...photos.entries()].filter(([, list]) => list.length === 0).map(([k]) => k);
    if (empty.length) console.log(`  no photographs for: ${empty.join(' | ')} — those keep their current URL`);

    // One upload per (keyword, lock); the same photograph is never uploaded twice.
    const uploadedBySource = new Map<string, string>();
    const replacement = new Map<string, string>();
    let done = 0;
    await inBatches([...urls], CONCURRENCY, async (url) => {
      const seed = parse(url);
      const list = seed ? photos.get(seed.keyword) ?? [] : [];
      if (!seed || list.length === 0) return;
      const rank = byKeyword.get(seed.keyword)!.indexOf(seed.lock);
      const source = list[rank % list.length]!;

      let target = uploadedBySource.get(source);
      if (!target) {
        const bytes = await download(source);
        if (!bytes) return;
        target = (await putObject(tenant.tenantRef, 'demo', 'picture.jpg', bytes, 'image/jpeg')).url;
        uploadedBySource.set(source, target);
      }
      replacement.set(url, target);
      done += 1;
      if (done % 50 === 0) console.log(`  uploaded ${done}/${urls.size}`);
    });
    console.log(`  ${replacement.size}/${urls.size} picture URL(s) now on R2 (${uploadedBySource.size} file(s)).`);

    // The seed URL is the only record of which keyword a picture was for, and
    // the rewrite below discards it — `--map <file>` keeps the old → new pairs.
    const mapFile = arg('map');
    if (mapFile) {
      writeFileSync(mapFile, JSON.stringify(Object.fromEntries(replacement), null, 1));
      console.log(`  map written to ${mapFile}`);
    }

    // One UPDATE per row, every changed column at once: an UPDATE gives the row
    // a new ctid, so a second statement aimed at the old one would miss it
    // (a banner carries both `image_url` and `mobile_image_url`).
    const rows = new Map<string, { table: string; ctid: string; sets: { column: string; value: string; isJson: boolean }[] }>();
    for (const hit of hits) {
      const next = hit.value.replace(SEED_URL_RE, (url) => replacement.get(url) ?? url);
      if (next === hit.value) continue;
      const key = `${hit.table}|${hit.ctid}`;
      const row = rows.get(key) ?? { table: hit.table, ctid: hit.ctid, sets: [] };
      row.sets.push({ column: hit.column, value: next, isJson: hit.isJson });
      rows.set(key, row);
    }
    let rewritten = 0;
    for (const row of rows.values()) {
      const assignments = row.sets.map((set, i) => `"${set.column}" = $${i + 1}${set.isJson ? '::jsonb' : ''}`);
      const result = await pool.query(
        `update "${row.table}" set ${assignments.join(', ')} where ctid = $${row.sets.length + 1}::tid`,
        [...row.sets.map((set) => set.value), row.ctid],
      );
      rewritten += (result.rowCount ?? 0) > 0 ? row.sets.length : 0;
    }
    console.log(`Rewrote ${rewritten} value(s).`);

    await invalidateTenantCache(tenant.tenantRef, STOREFRONT_CACHE_SCOPE);
    console.log('Storefront cache dropped.');
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => undefined);
  });
