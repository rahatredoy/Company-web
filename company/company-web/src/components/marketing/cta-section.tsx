import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CtaSection() {
  return (
    <section className="relative isolate overflow-hidden bg-[#09090b] text-white">
      <div className="glow-primary pointer-events-none absolute inset-0" aria-hidden />
      <div className="container-page relative flex flex-col items-start justify-between gap-8 py-16 lg:flex-row lg:items-center">
        <div className="max-w-xl space-y-3">
          <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Ready to Launch Your E-commerce Store?
          </h2>
          <p className="text-white/65">
            Join thousands of entrepreneurs who are already growing their business with us. Start on the
            free trial today — nothing is charged, and you can cancel any time.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/register">
              Start Free Trial <ArrowRight />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-white/20 text-white hover:border-white/35 hover:bg-white/10"
          >
            <Link href="/pricing">View Pricing</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
