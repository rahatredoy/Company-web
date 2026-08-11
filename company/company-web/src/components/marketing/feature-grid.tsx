import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionHeading } from './section-heading';
import { FeatureIcon } from './feature-icon';
import { FEATURES } from '@/lib/content';
import { cn } from '@/lib/utils';

const TINTS = [
  'bg-primary-soft text-accent-foreground',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-info-soft text-info',
  'bg-destructive-soft text-destructive',
  'bg-muted text-foreground',
];

export function FeatureGrid({
  limit,
  showCta = false,
  className,
}: {
  limit?: number;
  showCta?: boolean;
  className?: string;
}) {
  const items = limit ? FEATURES.slice(0, limit) : FEATURES;

  return (
    <section className={cn('py-20 sm:py-24', className)}>
      <div className="container-page space-y-12">
        <SectionHeading
          title={
            <>
              Everything You <span className="text-gradient">Need</span> to Succeed
            </>
          }
          description="Powerful features designed to help you build, manage and grow your e-commerce business."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((feature, index) => (
            <article
              key={feature.title}
              className="card-hover rounded-xl border border-border bg-card p-5"
            >
              <span
                className={cn(
                  'mb-4 grid size-10 place-items-center rounded-lg',
                  TINTS[index % TINTS.length],
                )}
              >
                <FeatureIcon name={feature.icon} className="size-5" />
              </span>
              <h3 className="text-[15px] font-semibold">{feature.title}</h3>
              <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{feature.description}</p>
            </article>
          ))}
        </div>

        {showCta ? (
          <div className="flex justify-center">
            <Button asChild size="lg">
              <Link href="/features">
                Explore All Features <ArrowRight />
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
