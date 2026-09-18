import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Noto_Sans_Bengali } from 'next/font/google';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { publicEnv } from '@/lib/env';
import { I18nProvider } from '@/lib/i18n';
import { getLanguage, getT } from '@/lib/i18n/server';
import './globals.css';

const sans = Geist({ variable: '--font-sans', subsets: ['latin'], display: 'swap' });
const mono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'], display: 'swap' });
/*
 * Geist has no Bengali glyphs, so a Bangla panel would otherwise be set in
 * whatever the operating system falls back to — a different face on every
 * machine. Named after Geist in the stack (`globals.css`), so Latin text keeps
 * Geist, and not preloaded: the file is only fetched once Bengali text is
 * actually painted, which an English store never does.
 */
const bengali = Noto_Sans_Bengali({
  variable: '--font-bengali',
  subsets: ['bengali'],
  display: 'swap',
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: t('Store Admin'), template: `%s · ${t('Store Admin')}` },
    description: t('Run your store on {platform}.', { platform: publicEnv.platformName }),
    // The panel must never appear in a search index, whatever the store.
    robots: { index: false, follow: false, nocache: true },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#07111d' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The store's language, which the whole panel — signed in or not — is drawn in.
  const language = await getLanguage();

  return (
    <html lang={language} suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} ${bengali.variable} antialiased`}>
        <I18nProvider language={language}>
          <ThemeProvider>
            {children}
            <Toaster />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
