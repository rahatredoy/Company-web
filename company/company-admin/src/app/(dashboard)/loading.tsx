import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Route-level fallback so navigation never leaves a blank shell. */
export default function DashboardLoading() {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <Skeleton className="h-10 w-full" />

      <Card>
        <CardContent className="space-y-3 p-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </CardContent>
      </Card>
    </>
  );
}
