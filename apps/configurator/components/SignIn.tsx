'use client';

import { useState, type FormEvent } from 'react';
import type { User } from '@/lib/api';
import { createAccount, friendly, sendPasswordReset, signInWithGoogle, signInWithPassword } from '@/lib/auth';
import { Logo } from './Icons';

interface Props {
  onSignedIn: (user: User) => void;
  onGuest: () => void;
}

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.1C12.3 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
    <path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.5 10.7l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

/** The sign-in card: email + password (sign in or create), Google, or carry on as a guest. */
export default function SignIn({ onSignedIn, onGuest }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<User>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      onSignedIn(await work());
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const em = email.trim();
    if (!em || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    void run(() => (mode === 'signup' ? createAccount(em, password) : signInWithPassword(em, password)));
  };

  const forgot = async () => {
    const em = email.trim();
    setError('');
    setNotice('');
    if (!em) {
      setError('Type your email above first, then click “Forgot password?”.');
      return;
    }
    try {
      await sendPasswordReset(em);
      setNotice(`Password reset email sent to ${em}. Check your inbox (and spam).`);
    } catch (e) {
      setError(friendly(e));
    }
  };

  return (
    <main className="centered">
      <div className="card login-card">
        <div className="brand">
          <Logo size={44} />
          <h1>MOZU Design</h1>
          <p className="muted">Scan a room, design the kitchen, keep every project in one place.</p>
        </div>

        <div className="auth-tabs" role="tablist">
          {(['signin', 'signup'] as const).map((m) => (
            <button key={m} type="button" role="tab" className={mode === m ? 'tab active' : 'tab'} aria-selected={mode === m}
              onClick={() => { setMode(m); setError(''); setNotice(''); }}>
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} noValidate className="login-form">
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" name="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8}
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="form-notice" role="status">{notice}</p>}
          <button type="submit" className="btn primary wide" disabled={busy}>{mode === 'signup' ? 'Create account' : 'Sign in'}</button>
          {mode === 'signin' && <button type="button" className="link center" onClick={() => void forgot()} disabled={busy}>Forgot password?</button>}
        </form>

        <div className="divider"><span>or</span></div>

        <button type="button" className="btn google wide" onClick={() => void run(signInWithGoogle)} disabled={busy}>
          <GoogleMark /> Continue with Google
        </button>

        <p className="muted small center">
          <button type="button" className="link" onClick={onGuest}>Try without an account</button>
          {' '}· your work stays on this device
        </p>
      </div>
    </main>
  );
}
