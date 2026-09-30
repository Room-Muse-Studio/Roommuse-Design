'use client';

import { useEffect, useState } from 'react';
import type { User } from '@/lib/api';
import type { SyncState } from '@/lib/status';
import AccountMenu from './AccountMenu';
import { Logo, Sym } from './Icons';

interface Props {
  /** Null for a guest. */
  projectName: string | null;
  onRename?: (name: string) => Promise<void>;
  subtitle: string;
  status: { state: SyncState; text: string };
  user: User | null | undefined;
  guest: boolean;
  onBack: () => void;
  onSaveToProjects: () => void;
  onSignIn: () => void;
  beforeSignOut?: () => Promise<void>;
  onSignedOut: () => void;
  onNotice: (text: string) => void;
}

/** The 64 px bar over the editor: logo, project name, save status, actions and the account. */
export default function TopBar(p: Props) {
  const [name, setName] = useState(p.projectName ?? '');
  useEffect(() => setName(p.projectName ?? ''), [p.projectName]);
  const commit = async () => {
    const next = name.trim();
    if (!p.onRename || p.projectName === null) return;
    if (!next || next === p.projectName) {
      setName(p.projectName);
      return;
    }
    try {
      await p.onRename(next);
    } catch (e) {
      setName(p.projectName);
      p.onNotice((e as Error).message);
    }
  };

  return (
    <header className="topbar">
      <a className="logo-link" href="/" title="MOZU Design" aria-label="MOZU Design"><Logo /></a>
      {p.user && (
        <button type="button" className="btn ghost back" onClick={p.onBack}>‹ My projects</button>
      )}
      <i className="vdiv" />
      <div className="project">
        <div className="project-name">
          {p.projectName !== null ? (
            <>
              <input className="name-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void commit()}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(p.projectName ?? ''); (e.target as HTMLInputElement).blur(); } }}
                maxLength={120} aria-label="Project name" spellCheck={false} />
              <Sym name="edit" className="edit-ic" />
            </>
          ) : (
            <span className="name-static">Untitled · not saved</span>
          )}
        </div>
        <p className="project-sub">{p.subtitle}</p>
      </div>
      <div className="topbar-right">
        {p.status.text && <span className={`status-pill ${p.status.state}`} role="status">{p.status.text}</span>}
        {p.guest ? (
          <button type="button" className="btn primary" onClick={p.onSaveToProjects}><Sym name="save" /> Save to my projects</button>
        ) : (
          <button type="button" className="btn ghost" disabled title="Sharing is coming soon"><Sym name="ios_share" /> Share</button>
        )}
        <button type="button" className="btn ghost" disabled title="Export is coming soon"><Sym name="description" /> Export</button>
        {p.user ? (
          <AccountMenu user={p.user} beforeSignOut={p.beforeSignOut} onSignedOut={p.onSignedOut} onNotice={p.onNotice} />
        ) : p.user === null ? (
          <button type="button" className="btn ghost" onClick={p.onSignIn}>Sign in</button>
        ) : null}
      </div>
    </header>
  );
}
