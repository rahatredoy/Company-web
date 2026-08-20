'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { HOMEPAGE_SECTION_TYPES } from '@/lib/types';
import type { HomepageSectionRow, HomepageSectionType } from '@/lib/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogColumn,
  DialogColumns,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';

const SELECT_CLASS = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm';

/** What each block is, said the way an owner would describe it. */
const LABELS: Record<HomepageSectionType, string> = {
  hero: 'Hero banner',
  category_grid: 'Categories as a grid',
  category_circle: 'Categories as circles',
  product_grid: 'Products as a grid',
  product_carousel: 'Products as a carousel',
  banner: 'Banner strip',
  deal: 'Deal of the day',
  promo_trio: 'Three promo tiles',
  flash_sale: 'Flash sale',
  benefits: 'Benefits bar',
  lookbook: 'Lookbook',
  testimonial: 'Customer quotes',
  brands: 'Brand logos',
  newsletter: 'Newsletter signup',
  text: 'Text block',
  collection: 'A collection',
  social_gallery: 'Social gallery',
  recently_viewed: 'Recently viewed',
};

/**
 * Blocks whose products the API picks from the live catalogue each time the
 * homepage is read, rather than from a list frozen when the block was saved.
 */
const SOURCED = new Set<HomepageSectionType>(['product_grid', 'product_carousel', 'flash_sale', 'deal']);

/**
 * Blocks whose artwork comes from the `/banners` screen rather than from here.
 *
 * They name a **placement**, and the API fills in whichever banners are live and
 * in date at the moment the homepage is read — so a campaign starts and finishes
 * on the dates it was given, and nobody has to come back to this page to make
 * room for it. A block whose settings already carry their own `banners` list is
 * left alone by the API, which is what the older hand-written ones do.
 */
const BANNERED = new Set<HomepageSectionType>(['banner', 'promo_trio']);

/**
 * Blocks that can be turned from a rail into the whole catalogue.
 *
 * A product block normally asks the catalogue a question and shows up to 24
 * answers — which is a bound the API enforces, because a section's products are
 * resolved into the homepage payload that four cache layers then hold. "Show
 * everything" cannot be a bigger number for that reason: the storefront pages
 * the ordinary listing endpoint instead, behind a "Load more" button, and the
 * cached homepage stays the size it always was.
 */
const FEEDABLE = new Set<HomepageSectionType>(['product_grid', 'product_carousel']);

/**
 * How a whole-catalogue block reads the shop.
 *
 * The same vocabulary the listing pages use, so the block is ordered by the
 * thing `/shop` would order by. `newest` is the default rather than
 * `relevance`: with no search term behind it, relevance is an arbitrary order
 * that reads as a shuffle to anyone scrolling a shop they have seen before.
 */
const FEED_SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'best_selling', label: 'Best selling first' },
  { value: 'rating', label: 'Best reviewed first' },
  { value: 'price_asc', label: 'Cheapest first' },
  { value: 'price_desc', label: 'Most expensive first' },
];

/**
 * Blocks that list categories, either of which can do more than list them.
 *
 * A rail of departments is the top of the shop and nothing else: a subcategory
 * is reachable from it only by opening its parent first, so on a broad catalogue
 * most of the shop is behind a click nobody knows to make. The other two modes
 * are what fix that — one prints the aisles as links, the other fills each one
 * with its own products.
 */
const CATEGORIED = new Set<HomepageSectionType>(['category_grid', 'category_circle']);

/**
 * How a category block lists what it lists.
 *
 * One control rather than two switches, because the modes are alternatives: a
 * block cannot be a row of tiles *and* a panel of product rails, and two
 * switches would let an owner ask for both and then have the storefront pick.
 * The stored shape is still two independent keys — `showProducts` and
 * `showSubcategories` — so a homepage saved before this control existed reads
 * back as whichever mode it was in.
 */
const CATEGORY_MODES = [
  {
    value: 'products' as const,
    label: 'Products under each subcategory',
    hint: 'Each department as a panel: every aisle inside it a row of its own products. What a shopper came to see.',
  },
  {
    value: 'directory' as const,
    label: 'Every subcategory, as links',
    hint: 'Each department printed with the aisles inside it, so a shopper can reach one from the homepage.',
  },
  {
    value: 'tiles' as const,
    label: 'Departments only',
    hint: 'A row of the top-level categories, the way the template draws them.',
  },
];

type CategoryMode = (typeof CATEGORY_MODES)[number]['value'];

/** Which mode a saved block is in. Products wins if a hand-edited config says both. */
function categoryModeOf(config: Record<string, unknown> | null | undefined): CategoryMode {
  if (config?.showProducts === true) return 'products';
  if (config?.showSubcategories === true) return 'directory';
  return 'tiles';
}

/** The placements a banner can be filed under on the `/banners` screen. */
const PLACEMENTS = [
  { value: 'home_promo', label: 'Homepage promo' },
  { value: 'home_hero', label: 'Homepage hero' },
  { value: 'category_top', label: 'Category page' },
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'popup', label: 'Popup' },
];

/**
 * What a banner block looks like, as one choice rather than two numbers.
 *
 * Columns and shape are not independent in practice — a full-width card at the
 * three-up aspect is a screen and a half tall, and three cards at the strip
 * aspect are letterboxes — so the form offers the combinations that work
 * instead of two selects that can be set against each other.
 */
const LAYOUTS = [
  { value: 'strip', label: 'One wide strip', columns: 1, ratio: 'strip' },
  { value: 'single', label: 'One large panel', columns: 1, ratio: 'wide' },
  { value: 'pair', label: 'Two side by side', columns: 2, ratio: 'panel' },
  { value: 'trio', label: 'Three across', columns: 3, ratio: 'panel' },
] as const;

/**
 * The questions a product block may ask of the catalogue.
 *
 * All but the first two move on an hourly rotation, so a block is a window into
 * its source rather than the top of it — `discover` walks the whole shop that
 * way, which is how a product that is neither new nor featured nor a best seller
 * still reaches the front page. `Newest first` never rotates (the thirteenth
 * newest product is not the newest), and a `Deal of the day` block stays on the
 * deepest discount there is.
 */
const SOURCES = [
  { value: 'new_arrivals', label: 'Newest first' },
  { value: 'featured', label: 'Featured products' },
  { value: 'best_selling', label: 'Best sellers' },
  { value: 'sale', label: 'Biggest discounts' },
  { value: 'recommended', label: 'Best reviewed' },
  { value: 'discover', label: 'Everything, in turn' },
];

/**
 * What the storefront's homepage is made of, in the order it is made of it.
 *
 * A block's **type cannot change** once it exists, and that is the API's rule
 * rather than a missing control: the type decides which renderer runs and which
 * `config` keys mean anything, so re-typing one in place would leave a hero's
 * slides sitting in a brands block. Changing it is delete-and-create.
 *
 * A product block asks a **question** — "the newest eight" — rather than holding
 * a list of ids, so the homepage of a shop that adds a product tomorrow shows it
 * without anyone editing this page. A banner block names a **placement** for the
 * same reason: the artwork is edited on the `/banners` screen, and the campaign
 * that starts on Friday appears in it without anyone opening this one.
 *
 * Everything else keeps its settings as JSON, which is honest about what those
 * blocks are: their shape belongs to whichever storefront template renders them,
 * and a form here would only be able to guess at it.
 */
export function HomepageBuilder({ rows, canManage }: { rows: HomepageSectionRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<HomepageSectionRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [type, setType] = React.useState<HomepageSectionType>('product_grid');

  /*
   * Two settings are controlled rather than read off the form on submit,
   * because each of them decides which *other* fields mean anything: a block
   * showing the whole catalogue has no "which products" and no "how many", and
   * leaving those selects on screen would offer a choice the block no longer
   * makes.
   */
  const [feed, setFeed] = React.useState(false);
  const [categoryMode, setCategoryMode] = React.useState<CategoryMode>('tiles');

  const openEdit = (row: HomepageSectionRow) => {
    setEditing(row);
    setType(row.type);
    setFeed(row.config?.feed === true);
    setCategoryMode(categoryModeOf(row.config));
    setError('');
    setFieldErrors({});
  };

  const openCreate = () => {
    setCreating(true);
    setType('product_grid');
    setFeed(false);
    setCategoryMode('tiles');
    setError('');
    setFieldErrors({});
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();

    // The friendly fields own only the keys they show. Everything else in the
    // block's config is carried through untouched, so editing a title cannot
    // quietly drop settings this form does not know about.
    let config: Record<string, unknown> = editing ? { ...editing.config } : {};

    if (SOURCED.has(type) && FEEDABLE.has(type) && feed) {
      // The block is the catalogue now, so the question it used to ask goes with
      // the controls that asked it — a leftover `source` would read as the block
      // still being a rail to anyone opening the record later.
      config.feed = true;
      config.sort = text('feedSort');
      delete config.source;
      delete config.limit;
    } else if (SOURCED.has(type)) {
      delete config.feed;
      // `sort` belongs to the feed and is read by nothing else, so it leaves
      // with it rather than sitting in the record meaning nothing.
      if (FEEDABLE.has(type)) delete config.sort;
      config.source = text('source');
      config.limit = Number(data.get('limit') ?? 8);
    } else if (BANNERED.has(type)) {
      config.bannerPosition = text('bannerPosition');

      // `promo_trio` draws its own three-up row and reads neither key, so
      // writing them would put settings in the record that nothing honours.
      if (type === 'banner') {
        const layout = LAYOUTS.find((option) => option.value === text('layout')) ?? LAYOUTS[0];
        config.columns = layout.columns;
        config.ratio = layout.ratio;
      }
    } else {
      const raw = text('config');
      if (raw !== '') {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            setFieldErrors({ config: 'Settings must be a JSON object, like { "items": [] }.' });
            return;
          }
          config = parsed as Record<string, unknown>;
        } catch {
          setFieldErrors({ config: 'That is not valid JSON.' });
          return;
        }
      } else {
        config = {};
      }
    }

    /*
     * Applied on top of whichever branch ran, not inside one: a category block
     * keeps the JSON settings box as well — that is where `categoryIds` and
     * `limit` are set — and the JSON branch replaces the whole config object.
     */
    if (CATEGORIED.has(type)) {
      // Both keys are written every time — the one the mode does not use is
      // *deleted* rather than set false, so a block cannot end up carrying a
      // leftover flag that says it is something it no longer is.
      delete config.showSubcategories;
      delete config.showProducts;
      if (categoryMode === 'directory') config.showSubcategories = true;
      if (categoryMode === 'products') config.showProducts = true;
    }

    const payload = {
      title: text('title') || null,
      subtitle: text('subtitle') || null,
      config,
      isEnabled: data.get('isEnabled') === 'on',
      sortOrder: Number(data.get('sortOrder') ?? 0),
    };

    setBusy(true);
    setError('');
    setFieldErrors({});

    try {
      if (editing) await api.put(`/api/v1/admin/website/homepage/${editing.id}`, payload);
      else await api.post('/api/v1/admin/website/homepage', { ...payload, type });

      close();
      toast.success('Homepage saved.');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details) {
        setFieldErrors(
          Object.fromEntries(Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? ''])),
        );
      }
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  /** A whole-row PUT, because that is what the endpoint takes. */
  const write = async (row: HomepageSectionRow, change: Partial<HomepageSectionRow>) => {
    const next = { ...row, ...change };

    try {
      await api.put(`/api/v1/admin/website/homepage/${row.id}`, {
        title: next.title,
        subtitle: next.subtitle,
        config: next.config,
        isEnabled: next.isEnabled,
        sortOrder: next.sortOrder,
      });
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  // Two writes rather than one reorder endpoint: swapping the pair's sort orders
  // is the whole move, and a block landing between them keeps its own place.
  const move = async (index: number, by: -1 | 1) => {
    const row = rows[index];
    const other = rows[index + by];
    if (!row || !other || busy) return;

    setBusy(true);
    await write(row, { sortOrder: other.sortOrder });
    await write(other, { sortOrder: row.sortOrder });
    setBusy(false);
  };

  const remove = async (row: HomepageSectionRow) => {
    if (!window.confirm(`Remove the ${LABELS[row.type]} block?`)) return;

    try {
      await api.delete(`/api/v1/admin/website/homepage/${row.id}`);
      toast.success('Block removed.');
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const open = creating || editing !== null;
  const configText = editing ? JSON.stringify(editing.config ?? {}, null, 2) : '';
  const source = typeof editing?.config?.source === 'string' ? editing.config.source : 'new_arrivals';

  const placement =
    typeof editing?.config?.bannerPosition === 'string' ? editing.config.bannerPosition : 'home_promo';

  // Matched on both keys so a block saved with a shape this form does not offer
  // falls back to the first option rather than to a half-match that would
  // silently re-shape it on the next save.
  const layout =
    LAYOUTS.find(
      (option) =>
        option.columns === editing?.config?.columns && option.ratio === editing?.config?.ratio,
    )?.value ?? 'strip';
  const limit = typeof editing?.config?.limit === 'number' ? editing.config.limit : 8;

  const feedSort = FEED_SORTS.some((option) => option.value === editing?.config?.sort)
    ? (editing!.config!.sort as string)
    : 'newest';

  return (
    <div className="space-y-4">
      {canManage ? (
        <Button size="sm" onClick={openCreate}>
          <Plus aria-hidden /> Add a block
        </Button>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <LayoutTemplate className="size-6" aria-hidden />
            Your homepage has no blocks. Add one to start building it.
          </CardContent>
        </Card>
      ) : (
        <ol className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 py-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-xs font-medium tabular-nums">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.title || LABELS[row.type]}</span>
                      <Badge variant="neutral">{LABELS[row.type]}</Badge>
                      {/* Both of these change what the block *is*, not how it
                          looks, so they belong on the row rather than only
                          inside the editor. */}
                      {row.config?.feed === true ? <Badge variant="neutral">Whole catalogue</Badge> : null}
                      {row.config?.showProducts === true ? (
                        <Badge variant="neutral">With products</Badge>
                      ) : row.config?.showSubcategories === true ? (
                        <Badge variant="neutral">With subcategories</Badge>
                      ) : null}
                      {!row.isEnabled ? <Badge variant="warning">Hidden</Badge> : null}
                    </p>
                    {row.subtitle ? (
                      <p className="truncate text-sm text-muted-foreground">{row.subtitle}</p>
                    ) : null}
                  </div>

                  {canManage ? (
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={row.isEnabled}
                        onCheckedChange={(checked) => write(row, { isEnabled: checked })}
                        aria-label={`Show ${LABELS[row.type]} on the homepage`}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => move(index, -1)}
                        disabled={index === 0 || busy}
                        aria-label="Move up"
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => move(index, 1)}
                        disabled={index === rows.length - 1 || busy}
                        aria-label="Move down"
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(row)} aria-label="Edit">
                        <Pencil aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => remove(row)} aria-label="Remove">
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}

      <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
        <DialogContent size="md">
          {/* Remounted per block so every uncontrolled field re-reads its default. */}
          <form onSubmit={onSubmit} key={editing?.id ?? 'new'}>
            <DialogHeader>
              <DialogTitle>{editing ? `Edit ${LABELS[editing.type]}` : 'New block'}</DialogTitle>
              <DialogDescription>
                {editing
                  ? 'A block’s kind is fixed once it exists — remove it and add another to change it.'
                  : 'Choose what kind of block this is. It cannot be changed afterwards.'}
              </DialogDescription>
            </DialogHeader>

            <DialogBody>
              {error ? <Alert variant="danger">{error}</Alert> : null}

              {/* What the block says on the left, what it holds and where it
                  sits on the right — the settings box is the tall one, and it
                  belongs beside the headings rather than under them. */}
              <DialogColumns>
                <DialogColumn>
                  {editing ? null : (
                    <Field label="Kind" htmlFor="type">
                      <select
                        id="type"
                        className={SELECT_CLASS}
                        value={type}
                        onChange={(event) => setType(event.target.value as HomepageSectionType)}
                      >
                        {HOMEPAGE_SECTION_TYPES.map((key) => (
                          <option key={key} value={key}>
                            {LABELS[key]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}

                  <Field label="Heading" htmlFor="title" hint="Left empty shows no heading." error={fieldErrors.title}>
                    <Input id="title" name="title" defaultValue={editing?.title ?? ''} maxLength={200} />
                  </Field>

                  <Field label="Sub-heading" htmlFor="subtitle" error={fieldErrors.subtitle}>
                    <Input id="subtitle" name="subtitle" defaultValue={editing?.subtitle ?? ''} maxLength={300} />
                  </Field>
                </DialogColumn>

                <DialogColumn>
                  {BANNERED.has(type) ? (
                    <>
                      <Field
                        label="Which banners"
                        htmlFor="bannerPosition"
                        hint="Whatever is live and in date under this placement, from Banners."
                      >
                        <select
                          id="bannerPosition"
                          name="bannerPosition"
                          defaultValue={placement}
                          className={SELECT_CLASS}
                        >
                          {PLACEMENTS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>

                      {type === 'banner' ? (
                        <Field label="Shape" htmlFor="layout" hint="A strip reads as a break between rows.">
                          <select id="layout" name="layout" defaultValue={layout} className={SELECT_CLASS}>
                            {LAYOUTS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ) : null}
                    </>
                  ) : SOURCED.has(type) ? (
                    <div className="space-y-4">
                      {FEEDABLE.has(type) ? (
                        <label className="flex items-start gap-3 text-sm">
                          <Switch
                            checked={feed}
                            onCheckedChange={setFeed}
                            aria-label="Show every product in the shop"
                          />
                          <span>
                            Show every product
                            <span className="block text-xs text-muted-foreground">
                              The whole catalogue, a page at a time behind a “Load more” button, instead of
                              a fixed row.
                            </span>
                          </span>
                        </label>
                      ) : null}

                      {FEEDABLE.has(type) && feed ? (
                        <Field label="In what order" htmlFor="feedSort">
                          <select
                            id="feedSort"
                            name="feedSort"
                            defaultValue={feedSort}
                            className={SELECT_CLASS}
                          >
                            {FEED_SORTS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ) : (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label="Which products" htmlFor="source">
                            <select id="source" name="source" defaultValue={source} className={SELECT_CLASS}>
                              {SOURCES.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="How many" htmlFor="limit" hint="Between 1 and 24.">
                            <Input id="limit" name="limit" type="number" min={1} max={24} defaultValue={limit} />
                          </Field>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {CATEGORIED.has(type) ? (
                        <Field
                          label="How it lists"
                          htmlFor="categoryMode"
                          hint={CATEGORY_MODES.find((option) => option.value === categoryMode)?.hint}
                          className="mb-4"
                        >
                          <select
                            id="categoryMode"
                            className={SELECT_CLASS}
                            value={categoryMode}
                            onChange={(event) => setCategoryMode(event.target.value as CategoryMode)}
                          >
                            {CATEGORY_MODES.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ) : null}

                    <Field
                      label="Settings"
                      htmlFor="config"
                      hint="JSON, read by whichever template renders this block. Leave empty for none."
                      error={fieldErrors.config}
                    >
                      <Textarea
                        id="config"
                        name="config"
                        rows={7}
                        defaultValue={configText === '{}' ? '' : configText}
                        className="font-mono text-xs"
                        placeholder="{}"
                      />
                    </Field>
                    </>
                  )}

                  <Field label="Position" htmlFor="sortOrder" hint="Lower shows nearer the top.">
                    <Input
                      id="sortOrder"
                      name="sortOrder"
                      type="number"
                      min={0}
                      defaultValue={editing?.sortOrder ?? (rows.at(-1)?.sortOrder ?? 0) + 10}
                    />
                  </Field>

                  <label className="flex items-center gap-3 text-sm">
                    <Switch name="isEnabled" defaultChecked={editing?.isEnabled ?? true} />
                    Show it on the homepage
                  </label>
                </DialogColumn>
              </DialogColumns>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                {editing ? 'Save block' : 'Add block'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
