import { SectionHeading } from './section-heading';
import { FeatureIcon } from './feature-icon';
import { STOREFRONT_CUSTOMISATION } from '@/lib/content';

/** Abstract storefront preview — no external images, works in both themes. */
function DesignPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/60 px-3 py-2">
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/20" />
        <span className="size-2 rounded-full bg-muted-foreground/15" />
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div className="h-2.5 w-20 rounded-full bg-foreground/70" />
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-2 w-10 rounded-full bg-muted-foreground/25" />
            ))}
          </div>
        </div>

        <div className="relative h-28 overflow-hidden rounded-lg bg-gradient-to-br from-primary/25 to-primary/5 p-4">
          <div className="h-3 w-32 rounded-full bg-foreground/50" />
          <div className="mt-2 h-2 w-44 rounded-full bg-foreground/25" />
          <div className="mt-3 h-6 w-20 rounded-md bg-primary" />
        </div>

        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="aspect-square rounded-md bg-muted" />
              <div className="h-1.5 w-full rounded-full bg-muted-foreground/25" />
              <div className="h-1.5 w-2/3 rounded-full bg-muted-foreground/15" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Sits after the template gallery: once a template is chosen, this is what the
 * store owner can still change from their own admin panel.
 */
export function StorefrontDesign() {
  return (
    <section className="border-t border-border bg-surface py-20 sm:py-24">
      <div className="container-page space-y-12">
        <SectionHeading
          title={
            <>
              Then make it <span className="text-gradient">yours</span>
            </>
          }
          description="Whichever template you start from, your store admin panel controls the brand, the layout and the content."
        />

        <div className="grid items-center gap-10 lg:grid-cols-2">
          <DesignPreview />

          <ul className="grid gap-4 sm:grid-cols-2">
            {STOREFRONT_CUSTOMISATION.map((item) => (
              <li key={item.title} className="rounded-xl border border-border bg-card p-5">
                <span className="mb-3 grid size-9 place-items-center rounded-lg bg-primary-soft text-accent-foreground">
                  <FeatureIcon name={item.icon} className="size-4.5" />
                </span>
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{item.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
