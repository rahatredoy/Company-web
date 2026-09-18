import type { Metadata } from 'next';
import { Database, KeyRound, Lock, ScrollText, ShieldCheck, Timer } from 'lucide-react';
import { PageHero } from '@/components/marketing/page-hero';
import { CtaSection } from '@/components/marketing/cta-section';
import { SECURITY_POINTS } from '@/lib/content';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'Isolated tenant databases, Argon2id password hashing, MFA-protected platform administration, verified payment webhooks and full audit logging.',
};

const ICONS = [Database, Lock, KeyRound, ShieldCheck, ScrollText, Timer];

export default function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="Security"
        title="Your store data stays yours"
        description="Security is built into the architecture, not bolted on. Every client gets an isolated database and every sensitive action is authenticated, rate limited and logged."
      />

      <section className="py-20 sm:py-24">
        <div className="container-page grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY_POINTS.map((point, index) => {
            const Icon = ICONS[index % ICONS.length]!;
            return (
              <article key={point.title} className="card-hover rounded-xl border border-border bg-card p-6">
                <span className="mb-4 grid size-10 place-items-center rounded-lg bg-primary-soft text-accent-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="text-[14px] font-semibold">{point.title}</h3>
                <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{point.description}</p>
              </article>
            );
          })}
        </div>

        <div className="container-page mt-10">
          <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
            <h2 className="text-lg font-semibold">How tenant isolation works</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              When your store is provisioned we create a dedicated PostgreSQL database for it. Your
              products, orders, customers and inventory are written only to that database. Our platform
              database holds nothing but your account, subscription and billing records — it has no
              access path to another client&apos;s commerce data, because that data never lives there.
            </p>
            <div className="scroll-x mt-5">
              <pre className="w-max rounded-lg border border-border bg-card p-4 font-mono text-xs leading-6 text-muted-foreground">
{`company_control_db    accounts · plans · subscriptions · invoices · domains
tenant_abc_fashion_db products · orders · customers · inventory
tenant_gadget_hub_db  products · orders · customers · inventory
tenant_bookstore_db   products · orders · customers · inventory`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      <CtaSection />
    </>
  );
}
