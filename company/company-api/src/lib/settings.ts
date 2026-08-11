import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { systemSettings } from '../db/schema/index';
import { config } from '../config/index';
import { DEFAULT_TRIAL_DAYS, DEFAULT_TRIAL_REMINDER_DAYS, SETTING_KEYS } from './constants';
import { redis } from './redis';
import { logger } from './logger';

export interface GeneralSettings {
  platformName: string;
  logoUrl: string | null;
  supportEmail: string;
  supportPhone: string | null;
  defaultCurrency: string;
  timezone: string;
}

export interface TrialSettings {
  trialDays: number;
  reminderDays: number[];
}

export interface EmailSettings {
  senderName: string;
  senderEmail: string;
}

export interface MessagingSettings {
  smsProvider: string | null;
  whatsappProvider: string | null;
}

export interface SettingsShape {
  general: GeneralSettings;
  trial: TrialSettings;
  email: EmailSettings;
  messaging: MessagingSettings;
}

const DEFAULTS: SettingsShape = {
  general: {
    platformName: config.mail.fromName,
    logoUrl: null,
    supportEmail: config.mail.fromEmail,
    supportPhone: null,
    defaultCurrency: config.payment.currency,
    timezone: 'UTC',
  },
  trial: {
    trialDays: DEFAULT_TRIAL_DAYS,
    reminderDays: DEFAULT_TRIAL_REMINDER_DAYS,
  },
  email: {
    senderName: config.mail.fromName,
    senderEmail: config.mail.fromEmail,
  },
  messaging: {
    smsProvider: null,
    whatsappProvider: null,
  },
};

type SettingKey = keyof SettingsShape;

const CACHE_KEY = 'settings:v1';
const CACHE_TTL_SECONDS = 60;

async function readAll(): Promise<SettingsShape> {
  const cached = await redis.get(CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      return { ...DEFAULTS, ...(JSON.parse(cached) as Partial<SettingsShape>) };
    } catch {
      // fall through to the database
    }
  }

  const rows = await db.select().from(systemSettings);
  const merged = { ...DEFAULTS } as SettingsShape;

  for (const row of rows) {
    const key = row.key as SettingKey;
    if (key in merged) {
      merged[key] = { ...merged[key], ...(row.value as object) } as never;
    }
  }

  await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(merged)).catch(() => undefined);
  return merged;
}

export async function getSettings(): Promise<SettingsShape> {
  try {
    return await readAll();
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'failed to read settings, using defaults');
    return DEFAULTS;
  }
}

export async function getTrialSettings(): Promise<TrialSettings> {
  return (await getSettings()).trial;
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
  return (await getSettings()).general;
}

export async function updateSettings(patch: Partial<SettingsShape>): Promise<SettingsShape> {
  const current = await getSettings();

  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    const settingKey = key as SettingKey;
    const merged = { ...current[settingKey], ...(value as object) };

    const existing = await db
      .select({ id: systemSettings.id })
      .from(systemSettings)
      .where(eq(systemSettings.key, settingKey))
      .limit(1);

    if (existing[0]) {
      await db
        .update(systemSettings)
        .set({ value: merged, updatedAt: new Date() })
        .where(eq(systemSettings.id, existing[0].id));
    } else {
      await db.insert(systemSettings).values({ key: settingKey, value: merged });
    }
  }

  await redis.del(CACHE_KEY).catch(() => undefined);
  return getSettings();
}

export { SETTING_KEYS };
