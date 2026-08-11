import { getPublishedStoreConfig, getStoreConfig } from '@/lib/api/store';
import { isDesignSwitcherEnabled } from '@/lib/design/preview';
import { DesignSwitcher } from './design-switcher';

/**
 * Decides whether the design panel exists at all.
 *
 * A Server Component so the `off` case returns before the client component is
 * ever referenced — with the switcher disabled, its JavaScript is not in the
 * page, not merely hidden by CSS. That is the difference between a feature flag
 * and a display toggle, and it is why the default in production is `off`.
 */
export async function DesignSwitcherMount() {
  if (!isDesignSwitcherEnabled()) return null;

  const [active, published] = await Promise.all([getStoreConfig(), getPublishedStoreConfig()]);

  return (
    <DesignSwitcher
      activeTemplate={active.design.templateKey}
      activeTheme={active.design.colorThemeKey}
      publishedTemplate={published.design.templateKey}
      publishedTheme={published.design.colorThemeKey}
    />
  );
}
