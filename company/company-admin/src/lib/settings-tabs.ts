/**
 * Shared by the server page (to validate `?tab=`) and the client Tabs wrapper.
 * Kept out of the `'use client'` module because a server component cannot call
 * a function that lives in a client module — only render it or pass it props.
 */
export const SETTINGS_TABS = [
  'general',
  'trial',
  'payments',
  'email',
  'messaging',
  'domain',
  'security',
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function isSettingsTab(value: string | undefined): value is SettingsTab {
  return !!value && (SETTINGS_TABS as readonly string[]).includes(value);
}
