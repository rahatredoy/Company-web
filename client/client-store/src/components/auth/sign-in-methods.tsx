'use client';

import * as React from 'react';
import type { StoreConfig } from '@/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GoogleButton } from '@/components/auth/google-button';
import { LoginForm } from '@/components/auth/login-form';
import { PhoneAuthForm } from '@/components/auth/phone-auth-form';
import { RegisterForm } from '@/components/auth/register-form';
import { useT } from '@/lib/i18n';

/**
 * The ways into a shop, on one screen.
 *
 * Three of them, and they are not three variations of the same thing: a phone
 * number and a code is the fastest way in and the only one that needs nothing
 * remembered; Google is one tap for anybody already signed in on the device; an
 * email and a password is what the accounts that already exist were made with.
 *
 * **Google sits above the tabs, not inside them.** It is not a third way of
 * filling in a form, it is a way of not filling one in — putting it in a tab
 * would hide the quickest route behind a click and make it look like more work
 * than it is.
 *
 * Which tab opens first differs by page on purpose. Somebody at `/login` has an
 * account already and, on this platform, most of the existing ones were made
 * with an address — so Email opens. Somebody at `/register` has nothing yet, and
 * the phone flow is both shorter and the one this market expects, so Phone
 * opens. Neither is hidden; the other is one tap away.
 *
 * Every method is drawn only when the API says it is available, and the API is
 * what refuses the ones that are not — a tab that leads to a 503 is worse than
 * an absent tab.
 */
export function SignInMethods({
  next,
  auth,
  mode,
}: {
  next?: string;
  auth: StoreConfig['auth'];
  mode: 'login' | 'register';
}) {
  const t = useT();
  const methods = [auth.phone, auth.password].filter(Boolean).length;
  const defaultMethod = mode === 'login' && auth.password ? 'email' : 'phone';

  return (
    <div className="space-y-6">
      {auth.google ? (
        <>
          <GoogleButton
            next={next}
            label={mode === 'login' ? t('Continue with Google') : t('Sign up with Google')}
          />

          {methods > 0 ? (
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase tracking-wide text-subtle">{t('or')}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}
        </>
      ) : null}

      {/*
        One method left means the tab bar is a row of one, which is a control
        that cannot do anything — so it is dropped and the form stands alone.
      */}
      {methods < 2 ? (
        auth.phone ? (
          <PhoneAuthForm next={next} />
        ) : (
          <EmailForm mode={mode} next={next} />
        )
      ) : (
        <Tabs defaultValue={defaultMethod}>
          <TabsList look="pill" className="w-full">
            <TabsTrigger look="pill" value="phone" className="flex-1">
              {t('Phone')}
            </TabsTrigger>
            <TabsTrigger look="pill" value="email" className="flex-1">
              {t('Email')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="phone" className="pt-6">
            <PhoneAuthForm next={next} />
          </TabsContent>

          <TabsContent value="email" className="pt-6">
            <EmailForm mode={mode} next={next} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function EmailForm({ mode, next }: { mode: 'login' | 'register'; next?: string }) {
  return mode === 'login' ? <LoginForm next={next} /> : <RegisterForm next={next} />;
}
