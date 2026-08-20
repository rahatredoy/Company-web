'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Baby,
  Book,
  Car,
  Check,
  Dumbbell,
  ExternalLink,
  Flower2,
  Gamepad2,
  HeartPulse,
  Laptop,
  Music,
  PawPrint,
  Printer,
  Shirt,
  ShoppingBasket,
  Sofa,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ImageUpload } from '@/components/admin/image-upload';
import { SELECT_CLASS } from './category-tree';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';

export interface DesignPayload {
  templateKey: string;
  colorThemeKey: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  announcement: {
    enabled: boolean;
    messages: { text: string; linkUrl: string | null; linkLabel: string | null }[];
  };
  tagline: string | null;
  /**
   * Category slug → glyph key. Slug-keyed because that is how the storefront
   * looks it up, which is also why an entry survives a rename only as far as
   * the slug does — moving a category's slug leaves its glyph behind.
   */
  categoryIcons: Record<string, string>;
  /** The closed set of glyphs the storefront knows how to draw. */
  categoryIconKeys: string[];
  templates: string[];
  themes: string[];
}

/** One top-level category, offered a glyph by the card below. */
export interface CategoryChoice {
  id: string;
  name: string;
  slug: string;
  /** False for a category the storefront's rail will not list at all. */
  inMenu: boolean;
}

/**
 * Swatches, so a colour can be recognised without applying it first.
 *
 * Hardcoded here rather than read from the storefront's theme files, because
 * these are two separate deployments and this panel cannot import that app's
 * CSS. A key with no swatch falls back to grey rather than breaking the row —
 * the same tolerance the storefront's own `normaliseThemeKey` shows.
 */
const THEME_SWATCH: Record<string, string> = {
  royal_blue: '#2f5bea',
  emerald_green: '#0f9d58',
  luxury_black: '#111111',
  rose_pink: '#e8517f',
  modern_purple: '#7c4dff',
  sunset_orange: '#f2740d',
  midnight_navy: '#16233f',
  olive_premium: '#6b7a2f',
};

/**
 * The same sixteen glyphs `client-store`'s `category-sidebar.tsx` draws, copied
 * rather than shared because the two are separate deployments — the same reason
 * `THEME_SWATCH` above is copied.
 *
 * The picker is filled from the API's `categoryIconKeys`, never from this map,
 * so a glyph added on the storefront side and not here still saves and still
 * draws in the shop; it only loses its preview. An unmapped key therefore
 * previews nothing rather than something wrong — a picker showing a t-shirt
 * beside Automotive would be worse than one showing no icon at all.
 */
const CATEGORY_GLYPHS: Record<string, LucideIcon> = {
  electronics: Laptop,
  fashion: Shirt,
  home: Sofa,
  beauty: Sparkles,
  sports: Dumbbell,
  toys: Gamepad2,
  tools: Wrench,
  automotive: Car,
  books: Book,
  health: HeartPulse,
  pets: PawPrint,
  garden: Flower2,
  grocery: ShoppingBasket,
  music: Music,
  baby: Baby,
  office: Printer,
};

/** How many announcement lines the strip will rotate through. */
const ANNOUNCEMENT_SLOTS = [0, 1, 2];

/**
 * Choosing how the shop looks.
 *
 * A template decides layout and a theme decides only colour — a theme redefines
 * CSS custom properties and nothing else, so changing it cannot alter a layout
 * and cannot touch product data. They are two choices here rather than one list
 * of forty-eight "designs" for that reason.
 *
 * Nothing is previewed live: this panel and the storefront are separate
 * deployments, so a faithful preview would mean shipping the storefront's CSS
 * into the admin bundle and keeping the two in step for ever. The honest
 * arrangement is a name, a swatch, and a link that opens the real thing.
 */
export function DesignPicker({
  design,
  categories,
  storefrontUrl,
  canManage,
}: {
  design: DesignPayload;
  /** `null` when this admin may not read categories — not the same as none. */
  categories: CategoryChoice[] | null;
  storefrontUrl: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [template, setTemplate] = React.useState(design.templateKey);
  const [theme, setTheme] = React.useState(design.colorThemeKey);
  /*
   * Seeded from what is stored rather than from the categories on screen, so a
   * save carries the entries this card is not showing as well. A category
   * hidden from the menu, or one whose slug has since moved, keeps its glyph
   * instead of being pruned by whoever next saves the design.
   */
  const [icons, setIcons] = React.useState<Record<string, string>>(design.categoryIcons ?? {});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const moved = template !== design.templateKey || theme !== design.colorThemeKey;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim() || null;

    // An empty line is a dropped line, not an empty message on the strip.
    const messages = ANNOUNCEMENT_SLOTS.map((index) => ({
      text: String(data.get(`announce-${index}`) ?? '').trim(),
      linkUrl: String(data.get(`announce-link-${index}`) ?? '').trim() || null,
      linkLabel: null,
    })).filter((message) => message.text.length > 0);

    setSaving(true);
    setError('');

    try {
      await api.put('/api/v1/admin/website/design', {
        templateKey: template,
        colorThemeKey: theme,
        logoUrl: text('logoUrl'),
        faviconUrl: text('faviconUrl'),
        tagline: text('tagline'),
        announcement: { enabled: data.get('announcementEnabled') === 'on', messages },
        categoryIcons: icons,
      });

      toast.success('Your storefront has been updated.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Layout</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {design.templates.map((key) => (
              <button
                key={key}
                type="button"
                disabled={!canManage}
                aria-pressed={template === key}
                onClick={() => setTemplate(key)}
                className={cn(
                  'relative rounded-lg border-2 p-4 text-left transition-colors',
                  template === key
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-foreground/20',
                  !canManage && 'cursor-not-allowed opacity-60',
                )}
              >
                {template === key ? (
                  <Check className="absolute right-3 top-3 size-4 text-primary" aria-hidden />
                ) : null}
                <span className="block font-medium">{titleCase(key)}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {key === design.templateKey ? 'Currently live' : 'Not published'}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Colour</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {design.themes.map((key) => (
              <button
                key={key}
                type="button"
                disabled={!canManage}
                aria-pressed={theme === key}
                onClick={() => setTheme(key)}
                className={cn(
                  'flex items-center gap-2 rounded-full border-2 py-1.5 pl-1.5 pr-3.5 text-sm transition-colors',
                  theme === key ? 'border-primary' : 'border-border hover:border-foreground/20',
                  !canManage && 'cursor-not-allowed opacity-60',
                )}
              >
                <span
                  className="size-6 rounded-full border"
                  style={{ backgroundColor: THEME_SWATCH[key] ?? '#9ca3af' }}
                  aria-hidden
                />
                {titleCase(key)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Colour never changes your layout, and layout never changes your products.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Logo" htmlFor="logoUrl">
            <ImageUpload
              name="logoUrl"
              purpose="website"
              defaultValue={design.logoUrl ?? ''}
              disabled={!canManage}
              label="Upload a logo"
            />
          </Field>
          <Field label="Favicon" htmlFor="faviconUrl">
            <ImageUpload
              name="faviconUrl"
              purpose="website"
              defaultValue={design.faviconUrl ?? ''}
              disabled={!canManage}
              label="Upload a favicon"
            />
          </Field>
          <Field label="Footer tagline" htmlFor="tagline">
            <Textarea
              id="tagline"
              name="tagline"
              rows={2}
              maxLength={200}
              defaultValue={design.tagline ?? ''}
              disabled={!canManage}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Announcement strip</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 text-sm">
            <Switch
              name="announcementEnabled"
              defaultChecked={design.announcement.enabled}
              disabled={!canManage}
            />
            Show the strip at the top of every page
          </label>
          <p className="text-xs text-muted-foreground">
            More than one line rotates. Leave a line empty to drop it.
          </p>

          {ANNOUNCEMENT_SLOTS.map((index) => (
            <div key={index} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field label={`Line ${index + 1}`} htmlFor={`announce-${index}`}>
                <Input
                  id={`announce-${index}`}
                  name={`announce-${index}`}
                  maxLength={200}
                  defaultValue={design.announcement.messages[index]?.text ?? ''}
                  disabled={!canManage}
                />
              </Field>
              <Field label="Links to" htmlFor={`announce-link-${index}`}>
                <Input
                  id={`announce-link-${index}`}
                  name={`announce-link-${index}`}
                  maxLength={2000}
                  placeholder="/sale"
                  defaultValue={design.announcement.messages[index]?.linkUrl ?? ''}
                  disabled={!canManage}
                />
              </Field>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Category icons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            The small mark beside a category in your storefront&rsquo;s category list. Only
            top-level categories carry one. Leave a category on <em>No icon</em> and it
            shows its name alone.
          </p>

          {categories === null ? (
            <Alert variant="warning">
              Your account cannot read categories, so they could not be listed here. Any
              icons already chosen are kept.
            </Alert>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have no top-level categories yet. Add one under Categories and it will
              appear here.
            </p>
          ) : (
            <ul className="space-y-2">
              {categories.map((category) => {
                const chosen = icons[category.slug] ?? '';
                const Glyph = chosen ? (CATEGORY_GLYPHS[chosen] ?? null) : null;

                return (
                  <li
                    key={category.id}
                    className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]"
                  >
                    <span className="flex min-w-0 items-center gap-2.5 text-sm">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                        {Glyph ? (
                          <Glyph className="size-4 text-muted-foreground" aria-hidden />
                        ) : (
                          <span className="text-xs text-muted-foreground" aria-hidden>
                            &mdash;
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 truncate">{category.name}</span>
                      {category.inMenu ? null : <Badge variant="outline">Not in menu</Badge>}
                    </span>

                    <select
                      aria-label={`Icon for ${category.name}`}
                      value={chosen}
                      disabled={!canManage}
                      onChange={(event) => {
                        const key = event.target.value;
                        setIcons((current) => {
                          const next = { ...current };
                          // An empty choice drops the entry: storing '' would
                          // fail the API's enum and reject the whole save.
                          if (key) next[category.slug] = key;
                          else delete next[category.slug];
                          return next;
                        });
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="">No icon</option>
                      {design.categoryIconKeys.map((key) => (
                        <option key={key} value={key}>
                          {titleCase(key)}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={saving}>
            {moved ? 'Publish this design' : 'Save changes'}
          </Button>
          <Button asChild variant="secondary">
            <a href={storefrontUrl} target="_blank" rel="noreferrer">
              View storefront <ExternalLink aria-hidden />
            </a>
          </Button>
          {moved ? (
            <span className="text-sm text-muted-foreground">
              Your storefront does not change until you publish.
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
