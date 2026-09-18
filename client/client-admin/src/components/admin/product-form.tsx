'use client';

import * as React from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ImageUpload } from '@/components/admin/image-upload';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import type { AttributeRow, BrandRow, CategoryRow, ProductDetail, ProductStatus } from '@/lib/types';
import { SELECT_CLASS } from './category-tree';
import { MeasureSelling } from './measure-selling';

/**
 * The product's own fields, in the two places they are edited: the panel that
 * creates one, and the Details tab that changes one.
 *
 * One set of fields, one payload builder, two frames around them — because the
 * fields are the same and two copies would drift. `ProductFields` is the whole
 * form; `ProductForm` frames it as a page and `ProductCreatePanel` frames it as
 * a side panel, and neither knows anything about the other's layout.
 *
 * ## The two forms are deliberately not the same length
 *
 * Adding a product asks only what is needed to *sell and stock* one: what it is,
 * where it is filed, what it looks like, what it costs, how many there are, and
 * — when it has them — its variants. Merchandising decisions (featured, new
 * arrival, returnable) and the four list-shaped things (gallery beyond the first
 * few, specifications, descriptive attributes, bundles) are not asked for here,
 * because none of them can be answered before the product exists and every one
 * of them has its own tab on the product screen afterwards. A create form that
 * scrolls hides the fields nobody has filled in yet, which is the half that
 * matters.
 *
 * Even that is more than most products need, so the create panel asks it in two
 * tiers: name, description, pictures, category, price, opening stock and the
 * low stock alert up front, and the rest — video, sale dates, cost price, SKU,
 * barcode, stock tracking, selling by weight, variants — behind **Advanced
 * options**. The edit form has no such fold; by then the owner is looking for a
 * particular field, and a field hidden behind a button is one they cannot find.
 *
 * A product has one description. There used to be a one-line short description
 * beside it; it was dropped from the schema rather than left unasked, and a
 * search engine is now given the opening of the full one instead.
 *
 * A `simple` product and its single sellable variant are still edited together —
 * the API writes them in one transaction, so price and opening stock sit
 * alongside the name rather than behind a second screen nobody would think to
 * open.
 *
 * Field errors come from the API's `details` map rather than being re-derived in
 * the browser: the API is the only place the rules actually live, and a second
 * copy here would eventually disagree with it.
 */

interface FieldProps {
  /** Needs `parentId`: the form asks for a category and a subcategory separately. */
  categories: Pick<CategoryRow, 'id' | 'name' | 'parentId'>[];
  brands: Pick<BrandRow, 'id' | 'name'>[];
  currency: string;
  /**
   * The shop's stored default measure picker (`preferences.measureOptions`).
   *
   * Handed down rather than fetched here so the form stays a pure client
   * component with no request of its own — and so a product that names no list
   * of its own can *show* the one actually in force rather than the word
   * "default".
   */
  storeMeasureOptions?: { label: string; measure: number }[];
  /** Absent when creating. */
  product?: ProductDetail;
}

type FieldErrors = Record<string, string>;

/** Dense controls: the page and the panel both fit without scrolling past a fold. */
const CONTROL = 'h-9';
const TIGHT = 'space-y-1.5';

/** One row of the create form's variant table, before it becomes a variant. */
interface VariantDraft {
  /** Stable across re-renders and reorders; never sent. */
  key: string;
  /** attributeId → attributeValueId, which is what the API resolves the pair from. */
  values: Record<string, string>;
  /** "Black / M". Derived from the chosen values when there are any. */
  title: string;
  sku: string;
  price: string;
  salePrice: string;
  stockQuantity: string;
  imageUrl: string;
}

let draftCounter = 0;
const emptyDraft = (): VariantDraft => ({
  key: `v${(draftCounter += 1)}`,
  values: {},
  title: '',
  sku: '',
  price: '',
  salePrice: '',
  stockQuantity: '0',
  imageUrl: '',
});

/**
 * The scalar half of the form, read straight out of `FormData` — which is why
 * every control here is a plain one. A Radix `Select` trigger is a button and
 * contributes no value to it.
 *
 * The list-shaped half (gallery, variants) is held in React state and passed in,
 * because a repeating group cannot be expressed as one named input.
 */
function payloadFrom(form: FormData) {
  const text = (key: string) => {
    const value = String(form.get(key) ?? '').trim();
    return value === '' ? null : value;
  };

  return {
    name: String(form.get('name') ?? '').trim(),
    status: String(form.get('status') ?? 'draft') as ProductStatus,
    /*
     * The subcategory when one was chosen, otherwise the category. A product is
     * filed under exactly one node of the tree; the two selects are a way of
     * finding that node, not two separate facts about the product.
     */
    categoryId: text('subcategoryId') ?? text('categoryId'),
    brandId: text('brandId'),
    description: text('description'),
    /*
     * Omitted rather than sent empty: the create endpoint makes one from the
     * name when there is none. The edit form's box is `required`, so an empty
     * one never reaches here from there.
     */
    sku: text('sku') ?? undefined,
    price: String(form.get('price') ?? '').trim(),
    salePrice: text('salePrice'),
    costPrice: text('costPrice'),
    barcode: text('barcode'),
    imageUrl: text('imageUrl'),
    videoUrl: text('videoUrl'),
    trackInventory: form.get('trackInventory') === 'on',
    /*
     * How a quantity is read on this product. Both endpoints take it, and both
     * forms render the control, so it belongs here rather than in the edit-only
     * half — and switching it *off* has to be sent as such, since an omitted
     * field means "leave it alone" and a stale rate would keep printing on the
     * card.
     *
     * The four fields under it are only sent while the mode is on. The API
     * clears the columns itself when it is off, so sending them would be sending
     * values the owner cannot currently see.
     */
    ...measureFrom(form),
  };
}

/**
 * The measure block, read back off the form.
 *
 * `measureOptions` is a JSON string in a hidden input rather than a set of
 * numbered fields, because it is a list the owner reorders and deletes from —
 * `options[2][measure]` naming would leave a hole in the sequence on every
 * removal. An empty string is the deliberate null: "use the shop's default
 * list", which is a different answer from an empty list.
 */
function measureFrom(form: FormData) {
  if (String(form.get('sellBy') ?? 'unit') !== 'measure') return { sellBy: 'unit' as const };

  const number = (key: string) => {
    const value = String(form.get(key) ?? '').trim();
    return value === '' ? null : Number(value);
  };

  const raw = String(form.get('measureOptions') ?? '').trim();
  let options: { label: string; measure: number }[] | null = null;
  if (raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      options =
        Array.isArray(parsed) && parsed.length > 0
          ? (parsed as { label: string; measure: number }[])
          : null;
    } catch {
      // A malformed list is treated as none rather than failing the save: the
      // shop's default picker is a working product, an unsaved one is not.
      options = null;
    }
  }

  return {
    sellBy: 'measure' as const,
    measureUnit: String(form.get('measureUnit') ?? 'g'),
    pricingMeasure: number('pricingMeasure') ?? 1000,
    pricingLabel: String(form.get('pricingLabel') ?? '').trim() || null,
    minMeasure: number('minMeasure'),
    measureOptions: options,
  };
}

/** The API's per-field messages, flattened to the one the form shows. */
function fieldErrorsFrom(caught: unknown): FieldErrors {
  if (!(caught instanceof ApiError) || !caught.details) return {};
  return Object.fromEntries(Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? '']));
}

/** A titled block of fields. The grid is the caller's, because the width is. */
function Section({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-baseline justify-between gap-3 border-b border-border bg-muted/40 px-3 py-1.5">
        <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {hint ? <p className="truncate text-[10.5px] text-muted-foreground">{hint}</p> : null}
      </div>
      <div className={cn('grid gap-3 p-3', className)}>{children}</div>
    </section>
  );
}

function FlagToggle({
  id,
  label,
  defaultChecked,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onCheckedChange?: (next: boolean) => void;
}) {
  return (
    <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-background px-3">
      <Label htmlFor={id} className="text-[12px] font-normal">
        {label}
      </Label>
      <Switch
        id={id}
        name={id}
        defaultChecked={defaultChecked}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

/**
 * Category and subcategory, as two selects over one tree.
 *
 * The panel's tree is two deep, and asking for both separately is what makes the
 * second list short enough to read. Only the deeper of the two is submitted —
 * see `payloadFrom` — because `products.category_id` names one node.
 */
function CategoryPicker({
  categories,
  product,
  fieldErrors,
}: {
  categories: FieldProps['categories'];
  product?: ProductDetail;
  fieldErrors: FieldErrors;
}) {
  const t = useT();
  const parents = React.useMemo(
    () => categories.filter((row) => !row.parentId).sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  // A stored product names its node, which may be either level — so the top
  // select is seeded from that node's parent when it has one.
  const stored = categories.find((row) => row.id === product?.categoryId);
  const [parentId, setParentId] = React.useState(stored?.parentId ?? stored?.id ?? '');
  const [childId, setChildId] = React.useState(stored?.parentId ? stored.id : '');

  const children = React.useMemo(
    () =>
      categories
        .filter((row) => row.parentId === parentId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [categories, parentId],
  );

  return (
    <>
      <Field label={t('Category')} htmlFor="categoryId" error={fieldErrors.categoryId} className={TIGHT}>
        <select
          id="categoryId"
          name="categoryId"
          value={parentId}
          onChange={(event) => {
            setParentId(event.target.value);
            // The old child belongs to the old parent; keeping it would file the
            // product under a branch its category no longer contains.
            setChildId('');
          }}
          className={cn(SELECT_CLASS, CONTROL)}
        >
          <option value="">{t('No category')}</option>
          {parents.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={t('Subcategory')}
        htmlFor="subcategoryId"
        hint={parentId && children.length === 0 ? t('This category has no subcategories.') : undefined}
        className={TIGHT}
      >
        <select
          id="subcategoryId"
          name="subcategoryId"
          value={childId}
          onChange={(event) => setChildId(event.target.value)}
          disabled={children.length === 0}
          className={cn(SELECT_CLASS, CONTROL)}
        >
          <option value="">{parentId ? t('Whole category') : t('Choose a category first')}</option>
          {children.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

/**
 * The extra pictures, beside the main one.
 *
 * Held in state rather than as named inputs because it is a repeating group, and
 * sent as a list the API writes as the product's gallery. The main image is a
 * separate field on purpose: it is the one a listing, a basket line and the
 * checkout summary all read, and burying it in a gallery would leave which
 * picture that is up to sort order.
 */
function GalleryPicker({
  images,
  onChange,
}: {
  images: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((url, index) => (
          <div key={`${url}-${index}`} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="size-14 rounded-md border bg-muted object-cover" />
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute -top-2.5 -right-2.5 size-6 rounded-full"
              onClick={() => onChange(images.filter((_, at) => at !== index))}
              aria-label={t('Remove image')}
            >
              <X aria-hidden />
            </Button>
          </div>
        ))}
      </div>

      {images.length < 12 ? (
        <ImageUpload
          // Remounted on every add so the picker comes back empty rather than
          // holding the picture it just handed over.
          key={images.length}
          name="galleryDraft"
          purpose="products"
          label={t('Add another image')}
          compact
          onChange={(url) => {
            if (url) onChange([...images, url]);
          }}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{t('Twelve is the limit — that is a product page, not an album.')}</p>
      )}
    </div>
  );
}

/** "Black / M", in the order the attributes are sorted in — never in click order. */
function labelFor(values: Record<string, string>, options: AttributeRow[]): string {
  return options
    .map((attribute) => attribute.values.find((value) => value.id === values[attribute.id])?.value)
    .filter(Boolean)
    .join(' / ');
}

/**
 * The variant table, when a product has variants.
 *
 * Off by default and off for most products: a shop selling one of a thing has no
 * use for a table with one row in it, and turning this on when it is not needed
 * is how a simple product ends up with a variant nobody can name.
 *
 * The option attributes are fetched only once this is switched on. They are a
 * whole extra request and the overwhelming majority of products never ask for
 * one, so paying for it on every open of the panel would slow the common case
 * down for the rare one.
 */
function VariantBuilder({
  rows,
  onChange,
  currency,
  error,
}: {
  rows: VariantDraft[];
  onChange: (next: VariantDraft[]) => void;
  currency: string;
  error?: string;
}) {
  const t = useT();
  const [attributes, setAttributes] = React.useState<AttributeRow[] | null>(null);
  const [loadError, setLoadError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;

    api
      .get<AttributeRow[]>('/api/v1/admin/attributes')
      .then((data) => {
        if (!cancelled) setAttributes(data);
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(errorMessage(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Only the attributes that *make* a variant. A descriptive one like Material
  // narrows a listing; choosing it here would create variants that differ by
  // something the storefront has no control to pick between.
  const options = (attributes ?? []).filter((row) => row.isVariantAttribute && row.values.length > 0);

  const update = (key: string, patch: Partial<VariantDraft>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-3">
      {loadError ? <Alert variant="warning">{loadError}</Alert> : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {/*
        Two different problems wearing the same symptom, and telling them apart
        is the difference between a two-minute fix and a puzzled owner: a shop
        with no attributes needs to create one, while a shop whose Size and
        Colour exist but are marked descriptive needs to flip one switch. The
        variants below still work either way — they are simply untitled options.
      */}
      {attributes !== null && options.length === 0 ? (
        <Alert variant="warning">
          {attributes.length === 0
            ? t('No attributes are set up yet — add Size, Colour or similar under Attributes, then come back to pick them here.')
            : t('None of your attributes is marked as an option that picks a variant. Turn that on under Attributes to choose Size or Colour per row; until then these variants are told apart by their name and SKU alone.')}
        </Alert>
      ) : null}

      {rows.map((row, index) => (
        <div key={row.key} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t('Variant {number}', { number: index + 1 })}
            </p>
            {rows.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
                aria-label={t('Remove variant {number}', { number: index + 1 })}
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </div>

          {options.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((attribute) => (
                <Field key={attribute.id} label={attribute.name} className={TIGHT}>
                  <select
                    value={row.values[attribute.id] ?? ''}
                    onChange={(event) => {
                      const next = { ...row.values };
                      if (event.target.value) next[attribute.id] = event.target.value;
                      else delete next[attribute.id];
                      // The name follows the options, because that is what the
                      // name *is* — a shopper picking Black and M is choosing
                      // "Black / M", and a stale label typed before the last
                      // choice would name a variant that no longer exists.
                      update(row.key, { values: next, title: labelFor(next, options) });
                    }}
                    className={cn(SELECT_CLASS, CONTROL)}
                  >
                    <option value="">{t('Any')}</option>
                    {attribute.values.map((value) => (
                      <option key={value.id} value={value.id}>
                        {value.value}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <Field
              label={t('Name')}
              hint={options.length === 0 ? t('What tells this one apart — “Small”, “Black”.') : undefined}
              className={cn(TIGHT, 'sm:col-span-2')}
            >
              <Input
                value={row.title}
                onChange={(event) => update(row.key, { title: event.target.value })}
                maxLength={200}
                placeholder={t('Black / M')}
                className={CONTROL}
              />
            </Field>

            <Field label={t('SKU')} required className={TIGHT}>
              <Input
                value={row.sku}
                onChange={(event) => update(row.key, { sku: event.target.value })}
                maxLength={64}
                placeholder={t('Unique across the store')}
                className={CONTROL}
              />
            </Field>

            <Field label={t('Price ({currency})', { currency })} required className={TIGHT}>
              <Input
                value={row.price}
                onChange={(event) => update(row.key, { price: event.target.value })}
                inputMode="decimal"
                placeholder="19.99"
                className={CONTROL}
              />
            </Field>

            <Field label={t('Sale price ({currency})', { currency })} className={TIGHT}>
              <Input
                value={row.salePrice}
                onChange={(event) => update(row.key, { salePrice: event.target.value })}
                inputMode="decimal"
                placeholder={t('Empty when not on sale')}
                className={CONTROL}
              />
            </Field>

            <Field label={t('Stock quantity')} className={TIGHT}>
              <Input
                type="number"
                min={0}
                value={row.stockQuantity}
                onChange={(event) => update(row.key, { stockQuantity: event.target.value })}
                className={cn(CONTROL, 'tabular-nums')}
              />
            </Field>

            <Field label={t('Image')} className={cn(TIGHT, 'sm:col-span-2')}>
              <ImageUpload
                name={`variantImage-${row.key}`}
                purpose="products"
                defaultValue={row.imageUrl}
                compact
                onChange={(url) => update(row.key, { imageUrl: url })}
              />
            </Field>
          </div>
        </div>
      ))}

      {rows.length < 50 ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, emptyDraft()])}>
          <Plus /> {t('Add variant')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The fields the create panel keeps under Advanced options.
 *
 * A save the API refuses over one of these opens the block: an error on a field
 * the reader cannot see is a Create button that appears to do nothing. Matched
 * as a prefix as well, because a variant's errors come back as `variants.0.sku`.
 */
const ADVANCED_FIELDS = [
  'videoUrl',
  'costPrice',
  'sellBy',
  'measureUnit',
  'pricingMeasure',
  'pricingLabel',
  'minMeasure',
  'measureOptions',
  'sku',
  'barcode',
  'trackInventory',
  'variants',
];

const isAdvancedField = (key: string) =>
  ADVANCED_FIELDS.some((field) => key === field || key.startsWith(`${field}.`));

/**
 * Every field, laid out for the width it has: the panel is two columns of
 * sections with two controls to a row inside them, the page has a narrow
 * sidebar and stacks the ones in it.
 *
 * Each field is built once and placed by the layout, because the two frames
 * group them differently — the page by subject, the panel by whether most
 * products need them at all.
 */
function ProductFields({
  layout,
  categories,
  brands,
  currency,
  storeMeasureOptions,
  product,
  fieldErrors,
  gallery,
  onGalleryChange,
  variants,
  onVariantsChange,
}: FieldProps & {
  layout: 'page' | 'panel';
  fieldErrors: FieldErrors;
  /** Create only — the gallery has its own tab once the product exists. */
  gallery: string[];
  onGalleryChange: (next: string[]) => void;
  /** Create only, and null while the owner has not asked for variants. */
  variants: VariantDraft[] | null;
  onVariantsChange: (next: VariantDraft[] | null) => void;
}) {
  const t = useT();
  const panel = layout === 'panel';
  const variant = product?.defaultVariant;

  // Held rather than read from `FormData` because the stock fields below are
  // disabled by it — a count that cannot refuse a sale is a count nobody needs
  // to fill in to get the product on the shop.
  const [trackStock, setTrackStock] = React.useState(product?.trackInventory ?? true);
  const hasVariants = variants !== null;

  /*
   * Mirrored from the price box so the measure preview can price each size as it
   * is typed. The input stays uncontrolled — `defaultValue` plus this — because
   * the form is read from `FormData` on submit and making it controlled would put
   * a re-render of the whole form behind every keystroke in it.
   */
  const [priceDraft, setPriceDraft] = React.useState(product?.defaultVariant?.price ?? '');

  /*
   * The create panel's Advanced options, closed on every open of the panel.
   *
   * Closing hides the block rather than unmounting it. What was typed there is
   * still the owner's answer — a cost price does not stop being true because the
   * section it was typed in was folded away — so it stays in the DOM, stays in
   * `FormData`, and is sent.
   */
  const [advanced, setAdvanced] = React.useState(false);

  // Whether the price is currently a rate. Only the panel reads it: there the
  // price is up front and the switch that changes its meaning is folded away.
  const [measuring, setMeasuring] = React.useState(product?.sellBy === 'measure');

  const [seenErrors, setSeenErrors] = React.useState(fieldErrors);
  if (fieldErrors !== seenErrors) {
    setSeenErrors(fieldErrors);
    if (Object.keys(fieldErrors).some(isAdvancedField)) setAdvanced(true);
  }

  /*
   * The browser's own validation has the same blind spot as the API's errors:
   * a malformed video address in a folded block fails the submit with nothing on
   * screen, because a hidden control cannot show its bubble. So an `invalid`
   * from inside the block opens it and asks the control to report again once it
   * can be seen. Once per submit — every invalid control fires in turn, and the
   * first is the one worth pointing at.
   */
  const revealing = React.useRef(false);
  function revealInvalid(event: React.FormEvent<HTMLDivElement>) {
    if (advanced || revealing.current) return;
    revealing.current = true;
    const control = event.target as HTMLInputElement;
    flushSync(() => setAdvanced(true));
    window.setTimeout(() => {
      revealing.current = false;
      control.reportValidity();
    }, 0);
  }

  const nameField = (
    <Field label={t('Name')} htmlFor="name" required error={fieldErrors.name} className={cn(TIGHT, 'sm:col-span-2')}>
      <Input
        id="name"
        name="name"
        defaultValue={product?.name ?? ''}
        required
        maxLength={200}
        autoFocus={panel}
        className={CONTROL}
      />
    </Field>
  );

  const descriptionField = (
    <Field
      label={t('Full description')}
      htmlFor="description"
      error={fieldErrors.description}
      className={cn(TIGHT, 'sm:col-span-2')}
    >
      <Textarea
        id="description"
        name="description"
        rows={panel ? 3 : 5}
        defaultValue={product?.description ?? ''}
        placeholder={t('What it is, in full. Shown on the product page.')}
        className="min-h-0 resize-y"
      />
    </Field>
  );

  const classification = (
    <Section title={t('Classification')} className={panel ? 'sm:grid-cols-2' : 'grid-cols-1'}>
      <Field label={t('Status')} htmlFor="status" error={fieldErrors.status} className={TIGHT}>
        {/* A plain select: the form is read with FormData, and the Radix
            trigger is a button that contributes no value to it. */}
        <select
          id="status"
          name="status"
          defaultValue={product?.status ?? 'draft'}
          className={cn(SELECT_CLASS, CONTROL)}
        >
          <option value="draft">{t('Draft — not live')}</option>
          <option value="active">{t('Published — on sale')}</option>
          <option value="inactive">{t('Archived — hidden')}</option>
        </select>
      </Field>

      <CategoryPicker categories={categories} product={product} fieldErrors={fieldErrors} />

      <Field label={t('Brand')} htmlFor="brandId" error={fieldErrors.brandId} className={TIGHT}>
        <select
          id="brandId"
          name="brandId"
          defaultValue={product?.brandId ?? ''}
          className={cn(SELECT_CLASS, CONTROL)}
        >
          <option value="">{t('No brand')}</option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </Field>
    </Section>
  );

  const mainImageField = (
    <Field
      label={t('Main image')}
      htmlFor="imageUrl"
      hint={t('The one every listing and basket line shows.')}
      error={fieldErrors.imageUrl}
      className={TIGHT}
    >
      <ImageUpload name="imageUrl" purpose="products" defaultValue={variant?.imageUrl ?? ''} compact />
    </Field>
  );

  const videoField = (
    <Field
      label={t('Video')}
      htmlFor="videoUrl"
      hint={t('Optional. A link to a clip, kept beside the gallery.')}
      error={fieldErrors.videoUrl}
      className={TIGHT}
    >
      <Input
        id="videoUrl"
        name="videoUrl"
        type="url"
        defaultValue={product?.videoUrl ?? ''}
        // i18n-ignore — an address format, not language
        placeholder="https://…"
        className={CONTROL}
      />
    </Field>
  );

  const priceField = (
    <Field
      label={t('Regular price ({currency})', { currency })}
      htmlFor="price"
      required
      // On the page the measure block sits right under this box and says so
      // itself; in the panel it is folded away, and a price that has quietly
      // become "per kilo" is the one misreading that re-prices a whole aisle.
      hint={panel && measuring ? t('Sold by weight: this is the rate, set under Advanced options.') : undefined}
      error={fieldErrors.price}
      className={TIGHT}
    >
      <Input
        id="price"
        name="price"
        inputMode="decimal"
        placeholder="19.99"
        defaultValue={variant?.price ?? ''}
        onChange={(event) => setPriceDraft(event.target.value)}
        required
        className={CONTROL}
      />
    </Field>
  );

  const salePriceField = (
    <Field label={t('Sale price ({currency})', { currency })} htmlFor="salePrice" error={fieldErrors.salePrice} className={TIGHT}>
      <Input
        id="salePrice"
        name="salePrice"
        inputMode="decimal"
        defaultValue={variant?.salePrice ?? ''}
        placeholder={t('Empty when not on sale')}
        className={CONTROL}
      />
    </Field>
  );

  const costPriceField = (
    <Field
      label={t('Cost price ({currency})', { currency })}
      htmlFor="costPrice"
      hint={
        hasVariants
          ? t('What one costs you, applied to every variant. Never shown to customers.')
          : t('What you paid. Never shown to customers; it is what profit is measured against.')
      }
      error={fieldErrors.costPrice}
      className={cn(TIGHT, 'sm:col-span-2')}
    >
      <Input
        id="costPrice"
        name="costPrice"
        inputMode="decimal"
        defaultValue={variant?.costPrice ?? ''}
        className={CONTROL}
      />
    </Field>
  );

  /*
   * With the pricing rather than in a section of its own, because it is a
   * statement *about* the price: the number stops being "what one costs" and
   * becomes a rate the moment this is switched on, and a shopkeeper reading them
   * apart would not know which they had typed. The panel folds it away with the
   * rest of the optional pricing, which is why the price box there repeats it.
   */
  const measureField = (
    <div className="sm:col-span-2">
      <MeasureSelling
        product={product}
        storeDefaults={storeMeasureOptions}
        price={priceDraft}
        currency={currency}
        fieldErrors={fieldErrors}
        onEnabledChange={setMeasuring}
      />
    </div>
  );

  /*
   * Required on the edit form, optional while creating: a new product that names
   * none is given one by the API, but an existing SKU is what order lines and
   * the inventory ledger already print, so clearing it is not "let it be
   * generated" — the box refuses to be empty.
   */
  const skuField = (
    <Field
      label={t('SKU')}
      htmlFor="sku"
      required={!panel}
      hint={panel ? t('Empty makes one from the name.') : undefined}
      error={fieldErrors.sku}
      className={TIGHT}
    >
      <Input
        id="sku"
        name="sku"
        defaultValue={variant?.sku ?? ''}
        required={!panel}
        maxLength={64}
        placeholder={t('Unique across the store')}
        className={CONTROL}
      />
    </Field>
  );

  const barcodeField = (
    <Field label={t('Barcode')} htmlFor="barcode" error={fieldErrors.barcode} className={TIGHT}>
      <Input
        id="barcode"
        name="barcode"
        defaultValue={variant?.barcode ?? ''}
        maxLength={64}
        placeholder={t('Optional')}
        className={CONTROL}
      />
    </Field>
  );

  const trackStockField = (
    <Field
      label=""
      hint={
        trackStock
          ? t('Stock decides what may be sold — the shop refuses an order it cannot fill.')
          : t('Sales are never refused on stock. Counts are still kept, they just do not stop a sale.')
      }
      className={cn(TIGHT, 'sm:col-span-2')}
    >
      <FlagToggle id="trackInventory" label={t('Track stock')} checked={trackStock} onCheckedChange={setTrackStock} />
    </Field>
  );

  if (panel) {
    /*
     * Two tiers. Up front, what every product needs before it can be sold: a
     * name, a description, its pictures, where it is filed, a price, a count and
     * the level it counts as low at. Behind Advanced options, what only some
     * products need — a video, a sale with dates, a cost price, a SKU of the
     * shop's own, a barcode, switching stock tracking off, selling by weight,
     * variants. A shop adding its fortieth T-shirt should not scroll past a
     * greengrocer's weighing controls to reach Create.
     *
     * Each tier is two columns of sections rather than stacked ones, split down
     * the reading order: what the product is on the left, where it goes and how
     * it is sold on the right.
     */
    const basics = (
      <Section title={t('Basic information')} className="sm:grid-cols-2">
        {nameField}
        {descriptionField}
      </Section>
    );

    const media = (
      <Section title={t('Media')} className="sm:grid-cols-2">
        {mainImageField}
        <Field label={t('Additional images')} hint={t('More pictures for the product page.')} className={TIGHT}>
          <GalleryPicker images={gallery} onChange={onGalleryChange} />
        </Field>
      </Section>
    );

    const pricing = (
      <Section title={t('Pricing')} className="sm:grid-cols-2">
        {hasVariants ? (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {t('Each variant carries its own price, SKU and stock — set them under Variants, in Advanced options.')}
          </p>
        ) : (
          <>
            {priceField}
            {salePriceField}
          </>
        )}
      </Section>
    );

    /*
     * The low stock alert stays up front even with variants on: it is asked once
     * and written to every variant's stock row, not asked again per variant, and a
     * shop that never sets it finds out it wanted one when it has already sold
     * out.
     */
    const inventory = (
      <Section title={t('Inventory')} className="sm:grid-cols-2">
        {hasVariants ? null : (
          <Field
            label={t('Stock quantity')}
            htmlFor="stockQuantity"
            hint={t('The opening count. Every change after this goes through Adjust stock, so it lands in the ledger.')}
            error={fieldErrors.stockQuantity}
            className={TIGHT}
          >
            <Input
              id="stockQuantity"
              name="stockQuantity"
              type="number"
              min={0}
              defaultValue="0"
              disabled={!trackStock}
              className={cn(CONTROL, 'tabular-nums')}
            />
          </Field>
        )}

        <Field
          label={t('Low stock alert at')}
          htmlFor="lowStockThreshold"
          hint={
            hasVariants
              ? t('At or below this a variant is flagged low.')
              : t('At or below this the product is flagged low.')
          }
          error={fieldErrors.lowStockThreshold}
          className={TIGHT}
        >
          <Input
            id="lowStockThreshold"
            name="lowStockThreshold"
            type="number"
            min={0}
            defaultValue="5"
            disabled={!trackStock}
            className={cn(CONTROL, 'tabular-nums')}
          />
        </Field>
      </Section>
    );

    const morePricing = (
      <Section title={t('More pricing')} className="sm:grid-cols-2">
        {costPriceField}
        {hasVariants ? null : measureField}
      </Section>
    );

    const moreMedia = (
      <Section title={t('More media')} className="grid-cols-1">
        {videoField}
      </Section>
    );

    const moreInventory = (
      <Section title={t('More inventory')} className="sm:grid-cols-2">
        {hasVariants ? null : (
          <>
            {skuField}
            {barcodeField}
          </>
        )}
        {trackStockField}
      </Section>
    );

    const variantSection = (
      <Section title={t('Variants')} hint={hasVariants ? undefined : t('Only if it comes in options')}>
        <FlagToggle
          id="hasVariants"
          label={t('This product has variants')}
          checked={hasVariants}
          onCheckedChange={(next) => onVariantsChange(next ? [emptyDraft()] : null)}
        />

        {hasVariants ? (
          <VariantBuilder
            rows={variants}
            onChange={onVariantsChange}
            currency={currency}
            error={fieldErrors.variants}
          />
        ) : null}
      </Section>
    );

    return (
      <div className="space-y-3">
        <div className="grid items-start gap-3 md:grid-cols-2">
          <div className="min-w-0 space-y-3">
            {basics}
            {media}
          </div>
          <div className="min-w-0 space-y-3">
            {classification}
            {pricing}
            {inventory}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setAdvanced((open) => !open)}
          aria-expanded={advanced}
          aria-controls="product-advanced-options"
          className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border-strong bg-card px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-medium">{t('Advanced options')}</span>
            <span className="block truncate text-[10.5px] text-muted-foreground">
              {t('Video, sale dates, cost price, SKU, barcode, stock tracking, selling by weight, variants')}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {advanced ? t('Hide') : t('Show')}
            <ChevronDown className={cn('size-4 transition-transform', advanced && 'rotate-180')} aria-hidden />
          </span>
        </button>

        <div
          id="product-advanced-options"
          hidden={!advanced}
          onInvalidCapture={revealInvalid}
          className="grid items-start gap-3 md:grid-cols-2"
        >
          <div className="min-w-0 space-y-3">
            {morePricing}
          </div>
          <div className="min-w-0 space-y-3">
            {moreMedia}
            {moreInventory}
            {variantSection}
          </div>
        </div>
      </div>
    );
  }

  const basics = (
    <Section title={t('Basic information')} className="sm:grid-cols-2">
      {nameField}
      {descriptionField}

      {/*
        The storefront address, on the edit form only.

        Not offered while creating, because there is nothing to keep stable yet —
        the API derives it from the name, which is what a new product wants. Here
        it matters the other way round: a **rename never moves the slug**, so a
        product whose name has been corrected keeps the address every link to it
        already uses, and this field is the only way to move it on purpose.
      */}
      <Field
        label={t('Storefront address')}
        htmlFor="slug"
        error={fieldErrors.slug}
        hint={t('Changing this breaks every existing link to the product.')}
        className={cn(TIGHT, 'sm:col-span-2')}
      >
        <div className="flex items-center gap-1.5">
          {/* i18n-ignore — the storefront's route, not language */}
          <span className="shrink-0 font-mono text-xs text-muted-foreground">/product/</span>
          <Input
            id="slug"
            name="slug"
            defaultValue={product?.slug ?? ''}
            maxLength={220}
            className={cn(CONTROL, 'font-mono')}
          />
        </div>
      </Field>
    </Section>
  );

  /*
   * How many of it one order may take, on the edit form only.
   *
   * Both are columns checkout enforces, and neither can be answered while the
   * product is still being typed in — a minimum is a decision about how the
   * thing is sold, which is made once it is on the shelf.
   */
  const limits = (
    <Section title={t('Order limits')} className="sm:grid-cols-2">
      <Field
        label={t('Minimum per order')}
        htmlFor="minOrderQuantity"
        hint={t('Below this the basket refuses.')}
        error={fieldErrors.minOrderQuantity}
        className={TIGHT}
      >
        <Input
          id="minOrderQuantity"
          name="minOrderQuantity"
          type="number"
          min={1}
          max={10_000}
          defaultValue={product?.minOrderQuantity ?? 1}
          className={cn(CONTROL, 'tabular-nums')}
        />
      </Field>

      <Field
        label={t('Maximum per order')}
        htmlFor="maxOrderQuantity"
        hint={t('Leave empty for no limit.')}
        error={fieldErrors.maxOrderQuantity}
        className={TIGHT}
      >
        <Input
          id="maxOrderQuantity"
          name="maxOrderQuantity"
          type="number"
          min={1}
          max={10_000}
          defaultValue={product?.maxOrderQuantity ?? ''}
          placeholder={t('No limit')}
          className={cn(CONTROL, 'tabular-nums')}
        />
      </Field>
    </Section>
  );

  /*
   * What a search engine and a shared link show, on the edit form only.
   *
   * Brands and categories have had these since they were built and products
   * never did, which left the one row type that actually gets searched for with
   * no way to say anything but its name. Empty falls back to the name and the
   * opening of the description, so leaving them alone is a real answer rather
   * than a gap.
   */
  const seo = (
    <Section title={t('Search engines')} className="grid-cols-1">
      <Field
        label={t('SEO title')}
        htmlFor="seoTitle"
        hint={t('Empty uses the product name.')}
        error={fieldErrors.seoTitle}
        className={TIGHT}
      >
        <Input
          id="seoTitle"
          name="seoTitle"
          defaultValue={product?.seoTitle ?? ''}
          maxLength={160}
          className={CONTROL}
        />
      </Field>

      <Field
        label={t('SEO description')}
        htmlFor="seoDescription"
        hint={t('Empty uses the start of the full description.')}
        error={fieldErrors.seoDescription}
        className={TIGHT}
      >
        <Textarea
          id="seoDescription"
          name="seoDescription"
          rows={3}
          defaultValue={product?.seoDescription ?? ''}
          maxLength={300}
          className="min-h-0 resize-y"
        />
      </Field>
    </Section>
  );

  const media = (
    <Section title={t('Media')} className="grid-cols-1">
      {mainImageField}
      {videoField}
    </Section>
  );

  const pricing = (
    <Section title={t('Pricing')} className="sm:grid-cols-2">
      {priceField}
      {salePriceField}
      {costPriceField}
      {measureField}
    </Section>
  );

  const inventory = (
    <Section title={t('Inventory')} className="sm:grid-cols-2">
      {skuField}
      {barcodeField}
      {trackStockField}
    </Section>
  );

  /*
   * Merchandising, on the edit form only. None of it can be decided before the
   * product exists — a shop does not know its new arrival is featured while it
   * is still typing the name — and every one of them is a one-tap change on a
   * product that is already there.
   */
  const flags = (
    <Section title={t('Flags')} className="grid-cols-1 gap-2">
      <FlagToggle id="isFeatured" label={t('Featured')} defaultChecked={product?.isFeatured ?? false} />
      <FlagToggle id="isNewArrival" label={t('New arrival')} defaultChecked={product?.isNewArrival ?? false} />
      <FlagToggle id="isReturnable" label={t('Returnable')} defaultChecked={product?.isReturnable ?? true} />
    </Section>
  );

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        {basics}
        {pricing}
        {inventory}
        {seo}
      </div>
      <div className="space-y-3">
        {classification}
        {media}
        {flags}
        {limits}
      </div>
    </div>
  );
}

/**
 * The Details tab of the product editor. Creating happens in
 * `ProductCreatePanel` — this one always has a product to change.
 */
export function ProductForm({ categories, brands, currency, storeMeasureOptions, product }: FieldProps) {
  const router = useRouter();
  const t = useT();
  const editing = Boolean(product);

  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFieldErrors({});

    const form = new FormData(event.currentTarget);

    /*
     * The edit-only half, added here rather than in `payloadFrom` — that one is
     * shared with the create panel, and `POST /products` does not accept any of
     * these. Reading a control the create panel never rendered would send a null
     * for a field the owner was never asked about.
     *
     * `maxOrderQuantity` is deliberately nulled when empty: null is "no limit",
     * which is a different answer from zero and is what the column means.
     */
    const maxPerOrder = String(form.get('maxOrderQuantity') ?? '').trim();
    const optional = (key: string) => String(form.get(key) ?? '').trim() || null;

    const payload = {
      ...payloadFrom(form),
      slug: String(form.get('slug') ?? '').trim() || undefined,
      isFeatured: form.get('isFeatured') === 'on',
      isNewArrival: form.get('isNewArrival') === 'on',
      isReturnable: form.get('isReturnable') === 'on',
      minOrderQuantity: Number(form.get('minOrderQuantity') ?? 1) || 1,
      maxOrderQuantity: maxPerOrder === '' ? null : Number(maxPerOrder),
      seoTitle: optional('seoTitle'),
      seoDescription: optional('seoDescription'),
    };

    try {
      const saved = product
        ? await api.patch<ProductDetail>(`/api/v1/admin/products/${product.id}`, payload)
        : await api.post<ProductDetail>('/api/v1/admin/products', payload);

      toast.success(editing ? t('Product saved.') : t('Product created.'));
      router.push(`/products/${saved.id}?tab=details`);
      router.refresh();
    } catch (caught) {
      setFieldErrors(fieldErrorsFrom(caught));
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!product) return;
    setDeleting(true);
    setError('');

    try {
      // A product that has sold is withdrawn rather than deleted, and the API
      // says which happened — repeating its own words avoids promising a
      // deletion that did not take place.
      const result = await api.delete<{ deleted: boolean; message?: string } | undefined>(
        `/api/v1/admin/products/${product.id}`,
      );

      if (result && result.deleted === false) {
        toast.success(result.message ?? t('Product hidden from the store.'));
        router.refresh();
      } else {
        toast.success(t('Product deleted.'));
        router.push('/products');
        router.refresh();
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <ProductFields
        layout="page"
        categories={categories}
        brands={brands}
        currency={currency}
        storeMeasureOptions={storeMeasureOptions}
        product={product}
        fieldErrors={fieldErrors}
        gallery={[]}
        onGalleryChange={() => undefined}
        variants={null}
        onVariantsChange={() => undefined}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" loading={saving}>
            {editing ? t('Save changes') : t('Create product')}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/products">{t('Cancel')}</Link>
          </Button>
        </div>

        {product ? (
          <Button type="button" variant="destructive" size="sm" onClick={remove} loading={deleting}>
            <Trash2 /> {t('Delete')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Adding a product, in a panel beside the list — the same arrangement the brand,
 * category and quick-edit screens use, and for the same reason: the reader keeps
 * their filters, their scroll position and their place in the list.
 *
 * The widest of those panels, because a product is asked more than they are. The
 * essentials fit on one screen in two columns; the optional half opens under
 * them from the Advanced options button, closed again on every open.
 *
 * The scalar fields are Radix-unmounted with the panel, so every open starts
 * blank without anything here having to clear them. The two list-shaped ones are
 * React state and are cleared explicitly.
 */
export function ProductCreatePanel({
  open,
  onOpenChange,
  categories,
  brands,
  currency,
  storeMeasureOptions,
  onCreated,
}: Omit<FieldProps, 'product'> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the API has written it, with the row it wrote. */
  onCreated: (product: ProductDetail) => void;
}) {
  const t = useT();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [gallery, setGallery] = React.useState<string[]>([]);
  const [variants, setVariants] = React.useState<VariantDraft[] | null>(null);

  // Cleared on open rather than on close, so a message about what the API
  // refused stays on screen for as long as the panel that caused it.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError('');
      setFieldErrors({});
      setGallery([]);
      setVariants(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const scalars = payloadFrom(form);
    const number = (key: string, fallback: number) => {
      const raw = String(form.get(key) ?? '').trim();
      const value = Number(raw);
      return raw === '' || !Number.isFinite(value) ? fallback : value;
    };

    const payload = {
      ...scalars,
      galleryImages: gallery,
      lowStockThreshold: number('lowStockThreshold', 5),
      ...(variants && variants.length > 0
        ? {
            /*
             * `sku` and `price` describe the single variant a simple product is
             * sold as, and there is no such variant here — the API reads the
             * list instead and refuses these two only when it is absent.
             */
            sku: undefined,
            price: undefined,
            variants: variants.map((row) => ({
              sku: row.sku.trim(),
              title: row.title.trim() || null,
              price: row.price.trim(),
              salePrice: row.salePrice.trim() || null,
              /*
               * No `costPrice` here on purpose. The form asks for it once, above
               * the table, and the API applies that one to every variant that
               * does not name its own — copying it here as well would be a
               * second rule to keep in step with the first.
               */
              imageUrl: row.imageUrl.trim() || null,
              stockQuantity: Number(row.stockQuantity) || 0,
              attributeValueIds: Object.values(row.values).filter(Boolean),
            })),
          }
        : { stockQuantity: number('stockQuantity', 0) }),
    };

    try {
      const saved = await api.post<ProductDetail>('/api/v1/admin/products', payload);
      onOpenChange(false);
      onCreated(saved);
    } catch (caught) {
      setFieldErrors(fieldErrorsFrom(caught));
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Closing mid-write would leave the panel gone and the request in flight,
        // with nowhere to show what it said.
        if (!saving) onOpenChange(next);
      }}
    >
      <SheetContent size="lg">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          {/* `pr-12` again: it is the room the sheet's own close button needs, and
              the shorter `px-4` here would otherwise drop it. */}
          <SheetHeader className="px-4 py-3 pr-12">
            <SheetTitle>{t('Add Product')}</SheetTitle>
            <SheetDescription>
              {t(
                'The essentials to sell and stock it. Everything optional is under Advanced options; specifications and related products come after, on the product’s own screen.',
              )}
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="space-y-3 px-4 py-3">
            {error ? <Alert variant="danger">{error}</Alert> : null}

            <ProductFields
              layout="panel"
              categories={categories}
              brands={brands}
              currency={currency}
              storeMeasureOptions={storeMeasureOptions}
              fieldErrors={fieldErrors}
              gallery={gallery}
              onGalleryChange={setGallery}
              variants={variants}
              onVariantsChange={setVariants}
            />
          </SheetBody>

          <SheetFooter className="px-4 py-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('Cancel')}
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              {t('Create Product')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
