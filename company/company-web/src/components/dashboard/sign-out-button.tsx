'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { api } from '@/lib/api';

export function SignOutButton({
  variant = 'outline',
  size = 'sm',
  className,
  withIcon = true,
}: {
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  withIcon?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  const signOut = async () => {
    setLoading(true);
    try {
      await api.post('/api/v1/public/logout');
    } catch {
      // Signing out locally must succeed even if the API call fails.
    } finally {
      router.push('/sign-in');
      router.refresh();
    }
  };

  return (
    <Button variant={variant} size={size} className={className} onClick={signOut} loading={loading}>
      {withIcon ? <LogOut /> : null}
      Sign out
    </Button>
  );
}
