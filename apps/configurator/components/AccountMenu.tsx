'use client';

import { useEffect, useRef, useState } from 'react';
import type { User } from '@/lib/api';
import { friendly, resendVerification, signOutEverywhere } from '@/lib/auth';

interface Props {
  user: User;
  /** Called before the session is dropped (the editor saves first). */
  beforeSignOut?: () => Promise<void>;
  onSignedOut: () => void;
  onNotice: (text: string) => void;
}

export const initialOf = (u: User) => ((u.name || u.email || '?').trim()[0] || '?').toUpperCase();

/** The round account button with the menu under it: email, resend verification, sign out. */
export default function AccountMenu({ user, beforeSignOut, onSignedOut, onNotice }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const needsVerify = !user.emailVerified && (user.providers ?? ['password']).includes('password');

  const resend = async () => {
    setOpen(false);
    try {
      await resendVerification();
      onNotice(`Verification email sent to ${user.email}.`);
    } catch (e) {
      onNotice(friendly(e));
    }
  };

  const signOut = async () => {
    setOpen(false);
    setBusy(true);
    try {
      await beforeSignOut?.();
      await signOutEverywhere();
      onSignedOut();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account" ref={ref}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} title={user.email} aria-label="Account"
        onClick={() => setOpen((v) => !v)} disabled={busy}>
        {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initialOf(user)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-label">
            {user.name && <strong>{user.name}</strong>}
            <span>{user.email}</span>
          </div>
          {needsVerify && <button type="button" role="menuitem" onClick={() => void resend()}>Resend verification email</button>}
          <button type="button" role="menuitem" onClick={() => void signOut()}>Sign out</button>
        </div>
      )}
    </div>
  );
}
