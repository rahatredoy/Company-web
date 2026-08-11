'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, errorCode } from '@/lib/api';
import type { Permission, SessionAdmin, SessionResponse, SessionStore } from '@/lib/types';
import { can } from '@/lib/types';

interface SessionContextValue {
  admin: SessionAdmin;
  store: SessionStore;
  can: (permission: Permission) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

/**
 * Holds the signed-in admin for the whole panel.
 *
 * Seeded from the server render so there is no authenticated-or-not flicker,
 * and refreshed after anything that changes what the admin may do — a
 * permission change must not require a full reload to take effect in the UI.
 */
export function SessionProvider({
  initial,
  children,
}: {
  initial: { admin: SessionAdmin; store: SessionStore };
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = React.useState(initial);

  const refresh = React.useCallback(async () => {
    try {
      const session = await api.get<SessionResponse>('/api/v1/admin/auth/session');
      if (session.authenticated) setState({ admin: session.admin, store: session.store });
      else router.replace('/sign-in');
    } catch (error) {
      if (errorCode(error) === 'SESSION_EXPIRED' || errorCode(error) === 'UNAUTHORIZED') {
        router.replace('/sign-in');
      }
    }
  }, [router]);

  const signOut = React.useCallback(async () => {
    await api.post('/api/v1/admin/auth/logout').catch(() => undefined);
    // A hard navigation, so no stale server-rendered page survives the sign-out.
    window.location.href = '/sign-in';
  }, []);

  const value = React.useMemo<SessionContextValue>(
    () => ({
      admin: state.admin,
      store: state.store,
      can: (permission) => can(state.admin, permission),
      refresh,
      signOut,
    }),
    [state, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = React.useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider.');
  return value;
}
