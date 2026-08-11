import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand/logo';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <p className="text-6xl font-bold tracking-tight text-primary">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">This page could not be found</h1>
        <p className="text-sm text-muted-foreground">
          The link may be broken, or the page may have moved.
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button asChild>
            <Link href="/">Back to home</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/contact">Contact support</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
