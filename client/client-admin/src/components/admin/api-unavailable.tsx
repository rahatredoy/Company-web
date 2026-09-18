'use client';

import { Alert } from '@/components/ui/alert';
import { useT } from '@/lib/i18n';

/**
 * Shown instead of a misleading "no results" state when the company API did not
 * respond. An empty table and an unreachable backend must never look the same.
 *
 * A client component for its translator; its one prop is a plain string, so a
 * server component can still render it.
 */
export function ApiUnavailable({ resource }: { resource?: string }) {
  const t = useT();
  return (
    <Alert variant="warning" title={t('Could not reach the company API')}>
      {t(
        '{resource} is empty because the API did not respond — not because there is nothing to show. Check that it is running, then refresh.',
        { resource: resource ?? t('this list') },
      )}
    </Alert>
  );
}
