import { apiFetch } from './api';
import type { Plan, PublicSettings } from './types';
import { publicEnv } from './env';

const DEFAULT_SETTINGS: PublicSettings = {
  platformName: publicEnv.platformName,
  supportEmail: publicEnv.supportEmail,
  supportPhone: null,
  defaultCurrency: 'USD',
  trialDays: 7,
};

/**
 * Marketing pages must still render if the API is briefly unreachable, so
 * these helpers degrade instead of throwing. Pricing is never hard-coded —
 * an empty list renders an explicit "unavailable" state.
 */
export async function getPublicPlans(): Promise<Plan[]> {
  try {
    const plans = await apiFetch<Plan[]>('/api/v1/public/plans', { next: { revalidate: 60 } });
    return Array.isArray(plans) ? plans : [];
  } catch {
    return [];
  }
}

export async function getPublicSettings(): Promise<PublicSettings> {
  try {
    const settings = await apiFetch<PublicSettings>('/api/v1/public/settings', {
      next: { revalidate: 300 },
    });
    return { ...DEFAULT_SETTINGS, ...settings };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
