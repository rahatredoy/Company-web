import Link from 'next/link';
import { ArrowRight, Check, Database, Lock, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StorePreview } from './store-preview';
import { HERO_HIGHLIGHTS } from '@/lib/content';
import { publicEnv } from '@/lib/env';

export function Hero({ trialDays = 7 }: { trialDays?: number }) {
  return (
    <section className="relative isolate overflow-hidden bg-[#09090b] text-white">
      <div className="glow-primary pointer-events-none absolute inset-x-0 top-0 h-[32rem]" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.045]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(70% 60% at 50% 0%, #000 40%, transparent 100%)',
        }}
        aria-hidden
      />

      <div className="container-page relative grid items-center gap-14 py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-28">
        <div className="animate-fade-up space-y-7">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/75">
            <span className="size-1.5 rounded-full bg-[#7c5cfc]" aria-hidden />
            All-in-One E-commerce SaaS Platform
          </span>

          <h1 className="text-4xl leading-[1.08] font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Launch Your
            <br />
            E-commerce Store
            <br />
            <span className="text-gradient">in Minutes</span>
          </h1>

          <p className="max-w-xl text-base text-pretty text-white/65 sm:text-lg">
            Everything you need to build, run and grow your online business. No coding. No server.
            Just your business.
          </p>

          <ul className="grid max-w-lg grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {HERO_HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-white/80">
                <Check className="size-4 shrink-0 text-emerald-400" aria-hidden />
                {item}
              </li>
            ))}
          </ul>

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

          {/* Concrete capabilities rather than an invented customer count or
              star rating — nothing here claims social proof we cannot back up. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
            {[
              { icon: Database, label: 'Dedicated database per store' },
              { icon: Rocket, label: 'Provisioned automatically' },
              { icon: Lock, label: 'SSL and backups included' },
            ].map((item) => (
              <span key={item.label} className="flex items-center gap-2 text-xs text-white/60">
                <item.icon className="size-4 text-[#7c5cfc]" aria-hidden />
                {item.label}
              </span>
            ))}
          </div>

          <p className="text-xs text-white/45">
            {trialDays}-day free trial · Free {publicEnv.rootDomain} subdomain · Cancel anytime
          </p>
        </div>

        <div className="relative pb-10 lg:pb-0">
          <StorePreview />
        </div>
      </div>
    </section>
  );
}
