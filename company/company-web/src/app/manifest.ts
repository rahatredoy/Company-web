import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: publicEnv.platformName,
    short_name: publicEnv.platformName,
    description: 'Launch a professional online store with a dedicated database and admin panel.',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#6d4aff',
    icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
