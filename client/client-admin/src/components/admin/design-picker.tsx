'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { titleCase } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ImageUpload } from '@/components/admin/image-upload';
import { SETTINGS_CONTROL, SettingsSection } from './settings-section';

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
  templates: string[];
  themes: string[];
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

/** How many announcement lines the strip will rotate through. */
const ANNOUNCEMENT_SLOTS = [0, 1, 2];

/**
 * What `PUT /website/design` is sent, read out of the Settings form.
 *
 * Only the keys these sections draw. Category icons, footer columns, social
 * profiles and the mobile bar are left out on purpose, and the API keeps what is
 * stored for every key it is not sent — so saving the store's name can never
 * empty the footer or strip the category rail of its glyphs.
 */
export function designPayloadFrom(data: FormData, design: DesignPayload) {
  const text = (name: string) => String(data.get(name) ?? '').trim() || null;

  // An empty line is a dropped line, not an empty message on the strip.
  const messages = ANNOUNCEMENT_SLOTS.map((index) => ({
    text: String(data.get(`announce-${index}`) ?? '').trim(),
    linkUrl: text(`announce-link-${index}`),
    // Not edited here; carried so a save does not strip a label set elsewhere.
    linkLabel: design.announcement.messages[index]?.linkLabel ?? null,
  })).filter((message) => message.text.length > 0);

  return {
    templateKey: String(data.get('templateKey') ?? design.templateKey),
    colorThemeKey: String(data.get('colorThemeKey') ?? design.colorThemeKey),
    logoUrl: text('logoUrl'),
    faviconUrl: text('faviconUrl'),
    tagline: text('tagline'),
    announcement: { enabled: data.get('announcementEnabled') === 'on', messages },
  };
}

/** A chip in the layout or colour row. */
function choiceClass(selected: boolean, disabled: boolean) {
  return cn(
    'flex h-9 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-sm transition-colors',
    selected ? 'border-primary bg-primary/5 font-medium' : 'border-border hover:border-foreground/20',
    disabled && 'cursor-not-allowed opacity-60',
  );
}

/**
 * How the shop looks: layout, colour, logo, favicon and footer tagline.
 *
 * A template decides layout and a theme decides only colour — a theme redefines
 * CSS custom properties and nothing else — so they are two rows of choices
 * rather than one list of every combination. Nothing is previewed live: this
 * panel and the storefront are separate deployments, and the sidebar's
 * storefront link opens the real thing.
 *
 * The two choices are held in state and handed to the form through hidden
 * inputs, so the Settings form reads the whole screen from one `FormData`.
 */
export function StorefrontSection({ design, disabled }: { design: DesignPayload; disabled: boolean }) {
  const t = useT();
  const [template, setTemplate] = React.useState(design.templateKey);
  const [theme, setTheme] = React.useState(design.colorThemeKey);

  return (
    <SettingsSection title={t('Storefront')}>
      <input type="hidden" name="templateKey" value={template} />
      <input type="hidden" name="colorThemeKey" value={theme} />

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t('Layout')}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {design.templates.map((key) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              aria-pressed={template === key}
              onClick={() => setTemplate(key)}
              className={cn(choiceClass(template === key, disabled), 'justify-between')}
            >
              {/* The design's own name ("Modern Shop"), kept as the platform names it in every language. */}
              <span className="truncate">{titleCase(key)}</span>
              {template === key ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t('Colour')}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {design.themes.map((key) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              aria-pressed={theme === key}
              onClick={() => setTheme(key)}
              className={choiceClass(theme === key, disabled)}
            >
              <span
                className="size-4 shrink-0 rounded-full border"
                style={{ backgroundColor: THEME_SWATCH[key] ?? '#9ca3af' }}
                aria-hidden
              />
              {/* The theme's own name ("Royal Blue"), a product name like the layout's. */}
              <span className="truncate">{titleCase(key)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Logo')} className="space-y-1.5">
          <ImageUpload
            name="logoUrl"
            purpose="website"
            defaultValue={design.logoUrl ?? ''}
            disabled={disabled}
            label={t('Upload logo')}
            compact
            pasteable={false}
          />
        </Field>
        <Field label={t('Favicon')} className="space-y-1.5">
          <ImageUpload
            name="faviconUrl"
            purpose="website"
            defaultValue={design.faviconUrl ?? ''}
            disabled={disabled}
            label={t('Upload favicon')}
            compact
            pasteable={false}
          />
        </Field>
      </div>

      <Field label={t('Footer tagline')} htmlFor="tagline" className="space-y-1.5">
        <Input
          id="tagline"
          name="tagline"
          maxLength={200}
          defaultValue={design.tagline ?? ''}
          disabled={disabled}
          className={SETTINGS_CONTROL}
        />
      </Field>
    </SettingsSection>
  );
}

/** The rotating strip across the top of every storefront page. */
export function AnnouncementSection({ design, disabled }: { design: DesignPayload; disabled: boolean }) {
  const t = useT();
  return (
    <SettingsSection
      title={t('Announcement strip')}
      action={
        <Switch
          name="announcementEnabled"
          defaultChecked={design.announcement.enabled}
          disabled={disabled}
          aria-label={t('Show the announcement strip')}
        />
      }
    >
      <div className="space-y-2">
        {ANNOUNCEMENT_SLOTS.map((index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Input
              name={`announce-${index}`}
              maxLength={200}
              placeholder={t('Message {number}', { number: index + 1 })}
              aria-label={t('Message {number}', { number: index + 1 })}
              defaultValue={design.announcement.messages[index]?.text ?? ''}
              disabled={disabled}
              className={SETTINGS_CONTROL}
            />
            <Input
              name={`announce-link-${index}`}
              maxLength={2000}
              placeholder={t('Link, e.g. /sale')}
              aria-label={t('Message {number} link', { number: index + 1 })}
              defaultValue={design.announcement.messages[index]?.linkUrl ?? ''}
              disabled={disabled}
              className={SETTINGS_CONTROL}
            />
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
