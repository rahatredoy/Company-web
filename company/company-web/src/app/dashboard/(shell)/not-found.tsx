import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Keeps the account shell and sidebar around when a record id does not resolve. */
export default function AccountNotFound() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <SearchX className="size-6" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Not found</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            That item does not exist on your account, or it has been removed.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard">Back to overview</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
