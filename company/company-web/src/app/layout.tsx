import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { publicEnv } from '@/lib/env';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const DESCRIPTION =
  'Everything you need to build, run and grow your online business. Get a professional storefront, admin panel and dedicated database — no coding, no servers.';

export const metadata: Metadata = {
  // Required for OpenGraph/canonical URLs to resolve to absolute addresses.
  metadataBase: new URL(publicEnv.siteUrl),
  title: {
    default: `${publicEnv.platformName} — Launch Your E-Commerce Store in Minutes`,
    template: `%s · ${publicEnv.platformName}`,
  },
  description: DESCRIPTION,
  applicationName: publicEnv.platformName,
  robots: { index: true, follow: true },
  icons: { icon: '/favicon.svg' },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: publicEnv.platformName,
    title: `${publicEnv.platformName} — Launch Your E-Commerce Store in Minutes`,
    description: DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${publicEnv.platformName} — Launch Your E-Commerce Store in Minutes`,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
            >
              Skip to content
            </a>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
