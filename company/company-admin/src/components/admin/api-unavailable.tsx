import { Alert } from '@/components/ui/alert';

/**
 * Shown instead of a misleading "no results" state when the company API did not
 * respond. An empty table and an unreachable backend must never look the same.
 */
export function ApiUnavailable({ resource = 'this list' }: { resource?: string }) {
  return (
    <Alert variant="warning" title="Could not reach the company API">
      {resource} is empty because the API did not respond — not because there is nothing to show.
      Check that it is running, then refresh.
    </Alert>
  );
}
