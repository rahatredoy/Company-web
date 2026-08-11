'use client';

import * as React from 'react';
import { Check, Palette, RotateCcw } from 'lucide-react';
import { COLOR_THEMES, THEMES, type ColorThemeKey } from '@/themes';
import { TEMPLATE_KEYS, TEMPLATE_META, type TemplateKey } from '@/templates/meta';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { clearDesignPreview, setDesignPreview } from '@/app/actions/design';
import { TemplateThumbnail } from './template-thumbnail';

/**
 * The on-site design panel: pick any of six templates and eight colour themes.
 *
 * What it changes is **this browser only**. The choice is a cookie; nothing here
 * can reach another visitor, which is what makes it safe to leave open to
 * everyone rather than hiding it behind an admin login. The banner says so
 * plainly, because a shopper who restyles a shop and then cannot get back to
 * how it looked has been handed a puzzle, not a feature.
 *
 * Each option is a form posting to a Server Action, so it works before
 * hydration and needs no client-side fetch. `useTransition` keeps the panel open
 * and shows which option is being applied while the server re-renders.
 */
export function DesignSwitcher({
  activeTemplate,
  activeTheme,
  publishedTemplate,
  publishedTheme,
}: {
  activeTemplate: TemplateKey;
  activeTheme: ColorThemeKey;
  publishedTemplate: TemplateKey;
  publishedTheme: ColorThemeKey;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const previewing = activeTemplate !== publishedTemplate || activeTheme !== publishedTheme;

  const apply = (field: 'template' | 'theme', value: string) => {
    const data = new FormData();
    data.set(field, value);
    startTransition(() => {
      void setDesignPreview(data);
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Change the store design"
        className={cn(
          'fixed bottom-5 right-5 z-40 grid size-12 place-items-center rounded-full',
          'bg-primary text-primary-foreground shadow-[var(--shadow-raised)]',
          'transition-transform hover:scale-105',
        )}
      >
        <Palette className="size-5" aria-hidden />
        {previewing ? (
          <span
            aria-hidden
            className="absolute right-0.5 top-0.5 size-3 rounded-full bg-accent ring-2 ring-surface"
          />
        ) : null}
      </SheetTrigger>

      <SheetContent side="right" className="w-[min(26rem,92vw)]">
        <SheetHeader>
          <SheetTitle>Store design</SheetTitle>
          <p className="mt-1 text-sm text-muted">
            Try any layout and colour. Only you see the change.
          </p>
        </SheetHeader>

        <SheetBody className={cn('space-y-8', pending && 'opacity-60 transition-opacity')}>
          {previewing ? (
            <Alert tone="info" title="You are previewing">
              Visitors still see{' '}
              <strong className="font-medium text-foreground">
                {TEMPLATE_META[publishedTemplate].name} · {THEMES[publishedTheme].name}
              </strong>
              .
            </Alert>
          ) : null}

          <section>
            <h3 className="mb-3 text-sm font-semibold">Layout</h3>
            <ul className="grid grid-cols-2 gap-3">
              {TEMPLATE_KEYS.map((key) => {
                const active = key === activeTemplate;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => apply('template', key)}
                      aria-pressed={active}
                      className={cn(
                        'group w-full rounded-(--radius-card) border p-2 text-left transition-colors',
                        active
                          ? 'border-primary ring-2 ring-primary/25'
                          : 'border-border hover:border-border-strong',
                      )}
                    >
                      <TemplateThumbnail templateKey={key} />

                      <span className="mt-2 flex items-start justify-between gap-1">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium">
                            {TEMPLATE_META[key].name}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-subtle">
                            {TEMPLATE_META[key].description}
                          </span>
                        </span>
                        {active ? (
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold">Colour</h3>
            <ul className="grid grid-cols-2 gap-2">
              {COLOR_THEMES.map((key) => {
                const theme = THEMES[key];
                const active = key === activeTheme;

                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => apply('theme', key)}
                      aria-pressed={active}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-(--radius-button) border px-2.5 py-2 text-left transition-colors',
                        active
                          ? 'border-primary ring-2 ring-primary/25'
                          : 'border-border hover:border-border-strong',
                      )}
                    >
                      {/*
                        Three swatches over the theme's own page colour. The
                        accessible name is the theme's name — colour alone must
                        never be the only way to tell these apart.
                      */}
                      <span
                        aria-hidden
                        className="flex shrink-0 items-center gap-0.5 rounded-full p-1"
                        style={{ backgroundColor: theme.tokens.background }}
                      >
                        <span className="size-3.5 rounded-full" style={{ backgroundColor: theme.tokens.primary }} />
                        <span className="size-3.5 rounded-full" style={{ backgroundColor: theme.tokens.secondary }} />
                        <span className="size-3.5 rounded-full" style={{ backgroundColor: theme.tokens.accent }} />
                      </span>

                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {theme.name}
                      </span>

                      {active ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </SheetBody>

        <SheetFooter className="flex items-center justify-between gap-3">
          <p className="text-xs text-subtle">
            {TEMPLATE_META[activeTemplate].name} · {THEMES[activeTheme].name}
          </p>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!previewing || pending}
            onClick={() => startTransition(() => void clearDesignPreview())}
          >
            <RotateCcw className="size-4" aria-hidden />
            Reset
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
