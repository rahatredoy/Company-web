import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { SectionHeading } from './section-heading';
import { COLOR_THEMES, TEMPLATES } from '@/lib/content';
import { cn } from '@/lib/utils';

/** Abstract storefront thumbnail — no external images, works in both themes. */
function TemplateThumb({ accent }: { accent: string }) {
  return (
    <div className={cn('relative aspect-4/3 overflow-hidden rounded-lg bg-gradient-to-br', accent)}>
      <div className="absolute inset-x-0 top-0 flex items-center gap-1 bg-black/10 px-2 py-1.5">
        <span className="size-1.5 rounded-full bg-white/50" />
        <span className="size-1.5 rounded-full bg-white/35" />
        <span className="size-1.5 rounded-full bg-white/25" />
      </div>
      <div className="absolute inset-x-3 top-7 h-1.5 rounded-full bg-white/45" />
      <div className="absolute inset-x-3 top-10 h-1.5 w-2/3 rounded-full bg-white/25" />
      <div className="absolute inset-x-3 bottom-3 grid grid-cols-3 gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 rounded bg-white/30" />
        ))}
      </div>
    </div>
  );
}

export function TemplatesShowcase({ showAll = false }: { showAll?: boolean }) {
  return (
    <section className="border-t border-border bg-surface py-20 sm:py-24">
      <div className="container-page space-y-12">
        <SectionHeading
          title={
            <>
              Beautiful Storefront <span className="text-gradient">Templates</span>
            </>
          }
          description="Choose a professional template from your store admin panel and start selling right away. You can switch template or colour theme whenever you like."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {TEMPLATES.map((template) => (
            <article key={template.code} className="card-hover rounded-xl border border-border bg-card p-3">
              <TemplateThumb accent={template.accent} />
              <div className="px-1 pt-3 pb-1">
                <h3 className="text-sm font-semibold">{template.name}</h3>
                {showAll ? (
                  <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        {showAll ? (
          <div className="space-y-6 rounded-xl border border-border bg-card p-6 sm:p-8">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Eight colour themes, on any template</h3>
              <p className="text-sm text-muted-foreground">
                Pick the palette that fits your brand. Every template supports all eight.
              </p>
            </div>

            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {COLOR_THEMES.map((theme) => (
                <li key={theme.code} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span
                    className="size-6 shrink-0 rounded-full ring-1 ring-black/10"
                    style={{ background: theme.swatch }}
                    aria-hidden
                  />
                  <span className="text-sm font-medium">{theme.name}</span>
                </li>
              ))}
            </ul>

            <ul className="grid gap-2 border-t border-border pt-5 sm:grid-cols-2">
              {[
                'Switch template or theme at any time',
                'Your logo, favicon and brand colours',
                'Rearrange homepage sections',
                'Preview on desktop, tablet and mobile before publishing',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex justify-center">
            <Link
              href="/templates"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              View all templates <ArrowRight className="size-4" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
