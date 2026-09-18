import 'server-only';
import type { Language } from '../languages';
import type { Messages } from './index';
import bn from './bn';

/** English is the key itself, so it has no dictionary to load. */
export const DICTIONARIES: Record<Language, Messages | null> = {
  en: null,
  bn,
};
