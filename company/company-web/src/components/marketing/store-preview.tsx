import { cn } from '@/lib/utils';

/**
 * Decorative product mock. Everything is drawn with CSS/SVG — the strict CSP
 * blocks external images, and this keeps the hero weightless.
 */
function BrowserChrome({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-white/10 bg-white/5 px-3 py-2">
      <span className="size-2.5 rounded-full bg-[#ff5f57]" />
      <span className="size-2.5 rounded-full bg-[#febc2e]" />
      <span className="size-2.5 rounded-full bg-[#28c840]" />
      <span className="ml-3 truncate rounded-md bg-black/25 px-2 py-0.5 text-[10px] text-white/60">{label}</span>
    </div>
  );
}

function MiniStat({ label, value, trend, color }: { label: string; value: string; trend: string; color: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
      <p className="text-[9px] text-white/50">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
      <div className="mt-1.5 flex items-center gap-1">
        <span className="text-[9px] text-emerald-400">{trend}</span>
        <svg viewBox="0 0 60 16" className="h-3 flex-1" preserveAspectRatio="none" aria-hidden>
          <path
            d="M0 12 L10 9 L20 11 L30 6 L40 8 L50 3 L60 5"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

export function StorePreview({ className }: { className?: string }) {
  return (
    <div className={cn('relative', className)}>
      {/* Storefront window */}
      <div className="overflow-hidden rounded-xl border border-white/12 bg-[#131316] shadow-[0_40px_80px_-40px_rgba(0,0,0,0.85)]">
        {/* Generic demo store — not a real customer, so it names nobody. */}
        <BrowserChrome label="your-store.company.com" />

        <div className="flex items-center justify-between border-b border-white/8 px-4 py-2.5">
          <span className="text-[11px] font-semibold text-white">Your Store</span>
          <div className="hidden gap-3 text-[10px] text-white/45 sm:flex">
            <span>Home</span>
            <span>Shop</span>
            <span>Collections</span>
            <span>About</span>
            <span>Contact</span>
          </div>
          <div className="flex gap-2 text-white/45">
            <span className="size-3 rounded-full border border-current" />
            <span className="size-3 rounded-sm border border-current" />
          </div>
        </div>

        <div className="relative isolate overflow-hidden px-5 py-8 sm:px-7 sm:py-10">
          <div
            className="absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(120% 90% at 85% 20%, rgba(124,92,252,0.35) 0%, transparent 60%), linear-gradient(160deg, #17171b 0%, #0c0c0f 60%)',
            }}
          />
          <div className="max-w-[62%] space-y-2.5">
            <p className="text-lg leading-tight font-bold text-white sm:text-2xl">
              Summer Sale
              <br />
              Up to 50% Off
            </p>
            <p className="text-[10px] text-white/55 sm:text-[11px]">
              Discover amazing products at unbeatable prices.
            </p>
            <span className="inline-flex rounded-md bg-[#6d4aff] px-3 py-1.5 text-[10px] font-semibold text-white">
              Shop Now
            </span>
          </div>

          {/* stylised product silhouette */}
          <div
            className="pointer-events-none absolute right-4 bottom-0 h-36 w-28 rounded-t-[999px] opacity-90 sm:h-44 sm:w-32"
            style={{ background: 'linear-gradient(180deg, #f7c56b 0%, #e08a4b 55%, #b45f36 100%)' }}
            aria-hidden
          />
        </div>

        <div className="grid grid-cols-4 gap-2 border-t border-white/8 px-4 py-3">
          {[
            ['Free Shipping', 'On orders over $50'],
            ['Money Back', '30 days guarantee'],
            ['Support 24/7', 'We are here to help'],
            ['Secure Payment', '100% protected'],
          ].map(([title, sub]) => (
            <div key={title} className="space-y-0.5">
              <p className="text-[9px] font-semibold text-white/85">{title}</p>
              <p className="text-[8px] text-white/40">{sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Admin panel on a phone */}
      <div className="absolute -right-2 -bottom-8 w-40 rounded-[1.4rem] border border-white/12 bg-[#09090b] p-2 shadow-[0_30px_60px_-24px_rgba(0,0,0,0.9)] sm:-right-8 sm:w-48">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[9px] text-white/45">9:41</span>
          <span className="text-[9px] text-white/45">▮▮▮</span>
        </div>
        <div className="rounded-2xl bg-white/4 p-2.5">
          <p className="mb-2 text-[10px] font-semibold text-white">Dashboard</p>
          <div className="space-y-2">
            <MiniStat label="Total Sales" value="$24,590" trend="+8.2%" color="#8b5cf6" />
            <MiniStat label="Orders" value="320" trend="+4.1%" color="#22c55e" />
            <MiniStat label="Customers" value="2,145" trend="+2.8%" color="#3b82f6" />
          </div>
        </div>
      </div>
    </div>
  );
}
