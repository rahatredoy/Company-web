'use client';

import { useT } from '@/lib/i18n';

/**
 * The last resort.
 *
 * Replaces the root layout, so it renders its own `<html>` and `<body>` and
 * cannot rely on the store's theme, fonts or chrome — by the time this shows,
 * the thing that would have provided them is what failed. Every style here is
 * therefore inline and literal, which is the one place in this app where a
 * hard-coded colour is correct.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Outside the root layout, so outside the provider too: this is always English.
  const t = useT();

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: '#f8fafc',
          color: '#0f172a',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>{t('Something went wrong')}</h1>
          <p style={{ marginTop: '0.75rem', color: '#475569', lineHeight: 1.6 }}>
            {t('This store could not be loaded. Please refresh the page and try again.')}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.75rem',
              minHeight: '2.75rem',
              padding: '0 1.5rem',
              border: 0,
              borderRadius: '0.5rem',
              background: '#0f172a',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('Try again')}
          </button>
          {error.digest ? (
            <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: '#94a3b8' }}>
              {t('Reference {code}', { code: error.digest })}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
