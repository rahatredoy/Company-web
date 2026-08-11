import { ImageResponse } from 'next/og';
import { publicEnv } from '@/lib/env';

export const alt = `${publicEnv.platformName} — launch your e-commerce store in minutes`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Generated rather than shipped as a binary, so the card always matches the
 * configured platform name.
 *
 * Two Satori constraints drive the markup: every element with more than one
 * child needs an explicit `display`, and only plain latin text is safe (any
 * decorative glyph triggers a font download that fails on an offline build).
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(140deg, #09090b 0%, #14101f 55%, #1b1240 100%)',
          padding: 72,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#6d4aff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
              fontWeight: 700,
              color: '#ffffff',
            }}
          >
            {publicEnv.platformName.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ fontSize: 30, color: '#fafafa', fontWeight: 600 }}>{publicEnv.platformName}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', fontSize: 68, color: '#fafafa', fontWeight: 700 }}>
            Launch your e-commerce
          </div>
          <div style={{ display: 'flex', fontSize: 68, color: '#fafafa', fontWeight: 700 }}>
            store in minutes
          </div>
          <div style={{ display: 'flex', fontSize: 28, color: '#a1a1aa', maxWidth: 900 }}>
            Storefront, admin panel and a dedicated database, provisioned automatically.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 28, fontSize: 22, color: '#c4b5fd' }}>
          <div style={{ display: 'flex' }}>Dedicated database</div>
          <div style={{ display: 'flex' }}>Custom domain</div>
          <div style={{ display: 'flex' }}>7-day free trial</div>
        </div>
      </div>
    ),
    size,
  );
}
