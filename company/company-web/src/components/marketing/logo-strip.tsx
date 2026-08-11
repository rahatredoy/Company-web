import { FeatureIcon } from './feature-icon';
import { PLATFORM_GUARANTEES } from '@/lib/content';

/**
 * Sits where a customer logo wall normally would. It states what every store
 * actually gets rather than implying customers we cannot name.
 */
export function LogoStrip() {
  return (
    <section className="border-y border-border bg-surface py-8">
      <div className="container-page flex flex-col items-center gap-6 lg:flex-row lg:gap-10">
        <p className="text-xs font-medium tracking-wide text-muted-foreground whitespace-nowrap">
          Included with every store
        </p>
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 lg:justify-start">
          {PLATFORM_GUARANTEES.map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="grid size-7 place-items-center rounded-md bg-muted-foreground/10" aria-hidden>
                <FeatureIcon name={item.icon} className="size-3.5" />
              </span>
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
