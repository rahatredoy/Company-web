import Link from 'next/link';
import { ArrowUpRight, Check, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export interface GettingStartedTask {
  key: string;
  label: string;
  description: string;
  done: boolean;
  href?: string;
  external?: boolean;
  /** Optional: not counted towards completion. */
  optional?: boolean;
}

/**
 * Only steps this platform can actually observe are ticked. Anything that
 * happens inside the store admin panel is linked, not claimed — a checklist that
 * marks work it cannot see is worse than no checklist.
 */
export function GettingStarted({ tasks }: { tasks: GettingStartedTask[] }) {
  const counted = tasks.filter((task) => !task.optional);
  const done = counted.filter((task) => task.done).length;
  const percent = counted.length === 0 ? 0 : Math.round((done / counted.length) * 100);

  if (done === counted.length) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Getting started</CardTitle>
        <span className="text-sm text-muted-foreground">
          {done} of {counted.length} completed
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={percent} />

        <ul className="space-y-1">
          {tasks.map((task) => {
            const inner = (
              <>
                <span
                  className={cn(
                    'mt-0.5 grid size-5.5 shrink-0 place-items-center rounded-full border',
                    task.done ? 'border-success bg-success-soft text-success' : 'border-border',
                  )}
                  aria-hidden
                >
                  {task.done ? <Check className="size-3.5" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-sm font-medium',
                      task.done && 'text-muted-foreground line-through decoration-muted-foreground/40',
                    )}
                  >
                    {task.label}
                    {task.optional ? (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Optional
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{task.description}</span>
                </span>
                {!task.done && task.href ? (
                  task.external ? (
                    <ExternalLink className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )
                ) : null}
              </>
            );

            const className =
              'flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none';

            return (
              <li key={task.key}>
                {task.done || !task.href ? (
                  <div className="flex items-start gap-3 px-2 py-2">{inner}</div>
                ) : task.external ? (
                  <a href={task.href} target="_blank" rel="noreferrer noopener" className={className}>
                    {inner}
                  </a>
                ) : (
                  <Link href={task.href} className={className}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
