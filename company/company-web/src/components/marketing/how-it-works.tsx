import { CreditCard, Rocket, Store, UserPlus, type LucideIcon } from 'lucide-react';
import { SectionHeading } from './section-heading';
import { HOW_IT_WORKS_SHORT } from '@/lib/content';

const STEP_ICONS: LucideIcon[] = [UserPlus, Store, CreditCard, Rocket];

export function HowItWorks() {
  return (
    <section className="py-20 sm:py-24">
      <div className="container-page space-y-14">
        <SectionHeading
          title="How It Works"
          description="Get your store up and running in 4 simple steps."
        />

        <ol className="relative grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {/* connector line, desktop only */}
          <span
            className="pointer-events-none absolute top-8 right-[12.5%] left-[12.5%] hidden border-t border-dashed border-border lg:block"
            aria-hidden
          />

          {HOW_IT_WORKS_SHORT.map((item, index) => {
            const Icon = STEP_ICONS[index] ?? UserPlus;
            return (
              <li key={item.step} className="relative flex flex-col items-center text-center">
                <span className="relative z-10 grid size-16 place-items-center rounded-full border border-border bg-card text-primary shadow-[var(--shadow-soft)]">
                  <Icon className="size-6" aria-hidden />
                  <span className="absolute -top-1 -right-1 grid size-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                    {item.step}
                  </span>
                </span>
                <h3 className="mt-4 text-[15px] font-semibold">{item.title}</h3>
                <p className="mt-1.5 max-w-52 text-sm text-pretty text-muted-foreground">{item.description}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
