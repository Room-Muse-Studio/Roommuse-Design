'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ApiError, deleteProject, duplicateProject, listProjects, renameProject, type ProjectMeta, type User,
} from '@/lib/api';
import { friendly, resendVerification } from '@/lib/auth';
import { cardMeta } from '@/lib/status';
import AccountMenu from './AccountMenu';
import Dialog, { type DialogRequest } from './Dialog';
import { Logo } from './Icons';
import NewProjectDialog from './NewProjectDialog';
import Toast from './Toast';

interface Props {
  user: User;
  onSignedOut: () => void;
}

const goToEditor = (id: string) => window.location.assign(`/editor?project=${encodeURIComponent(id)}`);

const Placeholder = () => (
  <svg viewBox="0 0 160 100" className="thumb-plan" aria-hidden="true">
    <path d="M20 14h120v72H20z" />
    <path d="M20 50h50M70 14v36" />
    <path className="door" d="M70 58v16" />
  </svg>
);

/** The "My projects" gallery: cards with a menu each, and the "New project" dialog. */
export default function ProjectsGallery({ user, onSignedOut }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const dialogWork = useRef<(value: string) => Promise<void>>(async () => {});
  const [menu, setMenu] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setProjects(await listProjects());
      setError('');
    } catch (e) {
      if ((e as ApiError).status === 401) return onSignedOut();
      setError((e as Error).message);
      setProjects((p) => p ?? []);
    }
  };
  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.card-menu, .card-menu-btn')) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const ask = (request: DialogRequest, work: (value: string) => Promise<void>) => {
    dialogWork.current = work;
    setDialog(request);
  };
  const failed = (e: unknown) => {
    if ((e as ApiError).status === 401) return onSignedOut();
    setError((e as Error).message);
  };

  const rename = (p: ProjectMeta) => ask(
    { title: 'Rename project', field: 'Name', value: p.name, ok: 'Rename' },
    async (name) => {
      if (name === p.name) return;
      const updated = await renameProject(p.id, name);
      setProjects((list) => list?.map((x) => (x.id === p.id ? { ...x, ...updated } : x)) ?? null);
    },
  );
  const duplicate = async (p: ProjectMeta) => {
    try {
      await duplicateProject(p.id);
      await refresh();
    } catch (e) {
      failed(e);
    }
  };
  const remove = (p: ProjectMeta) => ask(
    { title: `Delete “${p.name}”?`, text: 'This removes the project from your account. There is no undo.', ok: 'Delete', danger: true },
    async () => {
      await deleteProject(p.id);
      setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
    },
  );

  const resend = async () => {
    try {
      await resendVerification();
      setNotice(`Verification email sent to ${user.email}.`);
    } catch (e) {
      setNotice(friendly(e));
    }
  };

  const needsVerify = !user.emailVerified && (user.providers ?? ['password']).includes('password');
  const count = projects?.length ?? 0;

  return (
    <div className="gallery-page">
      <header className="gallery-bar">
        <a className="logo-link" href="/projects" aria-label="MOZU Design"><Logo size={36} /></a>
        <strong className="gallery-brand">MOZU Design</strong>
        <span className="grow" />
        <AccountMenu user={user} onSignedOut={onSignedOut} onNotice={setNotice} />
      </header>

      <main className="gallery">
        <div className="gallery-head">
          <div>
            <h1>My projects</h1>
            <p className="muted">{projects === null ? 'Loading…' : count ? `${count} ${count === 1 ? 'project' : 'projects'}` : ''}</p>
          </div>
          <div className="gallery-actions">
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ New project</button>
          </div>
        </div>

        {needsVerify && (
          <div className="banner warn" role="status">
            Please verify your email address — we sent a link to <b>{user.email}</b>.{' '}
            <button type="button" className="link" onClick={() => void resend()}>Resend</button>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}

        {projects && projects.length > 0 && (
          <div className="grid">
            {projects.map((p) => (
              <article key={p.id} className="project-card" tabIndex={0} role="button" aria-label={`Open ${p.name}`}
                onClick={(e) => { if (!(e.target as HTMLElement).closest('.card-menu, .card-menu-btn')) goToEditor(p.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) goToEditor(p.id); }}>
                <div className="thumb" aria-hidden="true">
                  {p.thumbnail ? <img src={p.thumbnail} alt="" /> : <Placeholder />}
                </div>
                <div className="card-body">
                  <div className="card-title" title={p.name}>{p.name}</div>
                  <div className="card-meta muted small">{cardMeta(p.updatedAt, p.rooms)}</div>
                </div>
                <button type="button" className="card-menu-btn" aria-label="Project menu" aria-haspopup="menu" aria-expanded={menu === p.id}
                  onClick={(e) => { e.stopPropagation(); setMenu(menu === p.id ? null : p.id); }}>⋯</button>
                {menu === p.id && (
                  <div className="menu card-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => goToEditor(p.id)}>Open</button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); rename(p); }}>Rename</button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); void duplicate(p); }}>Duplicate</button>
                    <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); remove(p); }}>Delete</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {projects && projects.length === 0 && (
          <div className="empty">
            <div className="empty-art" aria-hidden="true"><Placeholder /></div>
            <h2>No projects yet</h2>
            <p className="muted">Load a room scanned with the MOZU Scanner app, or start from a sample.</p>
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ New project</button>
          </div>
        )}
      </main>

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} onCreated={(p) => goToEditor(p.id)} />
      <Dialog request={dialog} onClose={() => setDialog(null)} onSubmit={async (v) => {
        try {
          await dialogWork.current(v);
        } catch (e) {
          if ((e as ApiError).status === 401) onSignedOut();
          throw e;
        }
      }} />
      <Toast message={notice} onDone={() => setNotice('')} />
    </div>
  );
}
