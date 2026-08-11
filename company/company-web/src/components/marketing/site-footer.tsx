import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { FOOTER_NAV } from '@/lib/content';
import { publicEnv } from '@/lib/env';

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface">
      <div className="container-page grid gap-10 py-14 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="max-w-xs space-y-4">
          <Logo />
          <p className="text-sm text-muted-foreground">
            Launch a professional online store with your own admin panel, dedicated database and custom
            domain — without managing a single server.
          </p>
          <p className="text-sm text-muted-foreground">
            <a className="hover:text-foreground" href={`mailto:${publicEnv.supportEmail}`}>
              {publicEnv.supportEmail}
            </a>
          </p>
        </div>

        {Object.entries(FOOTER_NAV).map(([group, links]) => (
          <div key={group} className="space-y-3">
            <p className="text-sm font-semibold">{group}</p>
            <ul className="space-y-2">
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-border">
        <div className="container-page flex flex-col items-center justify-between gap-3 py-5 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            © {year} {publicEnv.platformName}. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground">
            Every store runs on its own isolated database.
          </p>
        </div>
      </div>
    </footer>
  );
}
