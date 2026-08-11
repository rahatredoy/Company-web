'use client';

import * as React from 'react';
import { Check, ChevronLeft, ChevronRight, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TRUST_BADGES, VALUE_STATEMENTS } from '@/lib/content';

export function SecurityTestimonial() {
  const [index, setIndex] = React.useState(0);
  const active = VALUE_STATEMENTS[index] ?? VALUE_STATEMENTS[0]!;

  const move = (delta: number) =>
    setIndex((current) => (current + delta + VALUE_STATEMENTS.length) % VALUE_STATEMENTS.length);

  return (
    <section className="pb-20 sm:pb-24">
      <div className="container-page grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-soft text-accent-foreground">
              <ShieldCheck className="size-6" aria-hidden />
            </span>
            <div className="space-y-3">
              <h3 className="text-xl font-bold tracking-tight">
                Secure, <span className="text-gradient">Reliable</span> and Always Fast
              </h3>
              <p className="text-sm text-pretty text-muted-foreground">
                We take care of security, performance and updates so you can focus on growing your
                business. Every store runs on its own isolated database.
              </p>
              <ul className="grid gap-2 pt-1 sm:grid-cols-2">
                {TRUST_BADGES.map((badge) => (
                  <li key={badge} className="flex items-center gap-2 text-sm">
                    <Check className="size-4 shrink-0 text-success" aria-hidden />
                    {badge}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-6 sm:p-8">
          <Sparkles className="size-7 text-primary/40" aria-hidden />
          <div className="mt-4 space-y-2">
            <h3 className="text-lg font-semibold tracking-tight">{active.title}</h3>
            <p className="text-sm text-pretty text-muted-foreground">{active.body}</p>
          </div>
          <div className="mt-6 flex items-center justify-between gap-4">
            <div className="flex gap-1.5" aria-hidden>
              {VALUE_STATEMENTS.map((statement, i) => (
                <span
                  key={statement.title}
                  className={
                    i === index ? 'h-1.5 w-6 rounded-full bg-primary' : 'h-1.5 w-1.5 rounded-full bg-border-strong'
                  }
                />
              ))}
            </div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="icon-sm" onClick={() => move(-1)} aria-label="Previous">
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-sm" onClick={() => move(1)} aria-label="Next">
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
