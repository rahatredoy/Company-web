import { cn } from '@/lib/utils';

export function InfoList({ className, ...props }: React.HTMLAttributes<HTMLDListElement>) {
  return <dl className={cn('divide-y divide-border', className)} {...props} />;
}

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium break-words sm:text-right">{value}</dd>
    </div>
  );
}
