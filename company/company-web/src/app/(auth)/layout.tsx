import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main id="main" className="relative isolate flex-1 overflow-hidden bg-surface">
        <div className="glow-primary pointer-events-none absolute inset-x-0 top-0 h-64 opacity-70" aria-hidden />
        <div className="container-page relative flex justify-center py-14 sm:py-20">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            {children}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
