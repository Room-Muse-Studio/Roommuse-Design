'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { HomeScan, RoomScan } from '@mozu/scan-sdk';
import { createProject, fetchScanByCode, isCode, type ProjectMeta } from '@/lib/api';
import { loadHome } from '@/lib/home';
import { defaultProjectName, sourceOf, type Origin } from '@/lib/status';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Gallery: the project is created in the account. */
  onCreated?: (project: ProjectMeta) => void;
  /** Guest editor: the scan is only opened here. */
  onOpen?: (text: string, origin: Origin) => void;
}

type Way = 'code' | 'sample' | 'file';

/** "New project" (or a guest's "Open"): a scan from the phone's code, a sample, or a file. */
export default function NewProjectDialog({ open, onClose, onCreated, onOpen }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [way, setWay] = useState<Way>('code');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [samples, setSamples] = useState<string[]>([]);
  const [sample, setSample] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const creating = !!onCreated;

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open) {
      setError('');
      setBusy(false);
      if (!dlg.open) dlg.showModal();
      if (!samples.length) {
        fetch('/samples/index.json', { cache: 'no-store' })
          .then((r) => r.json())
          .then((body: { samples: string[] }) => {
            setSamples(body.samples);
            setSample((s) => s || body.samples[0] || '');
          })
          .catch(() => setSamples([]));
      }
    } else if (dlg.open) dlg.close();
  }, [open]);

  /** The scan text and where it came from, by the chosen way. */
  const fetchScan = async (): Promise<{ text: string; origin: Origin }> => {
    if (way === 'code') {
      const c = code.trim().toUpperCase();
      if (!isCode(c)) throw new Error('Type the 6-character code shown in the MOZU Scanner app.');
      const found = await fetchScanByCode(c);
      return { text: JSON.stringify(found.scan), origin: { kind: 'code', code: found.code } };
    }
    if (way === 'sample') {
      if (!sample) throw new Error('Pick a sample.');
      const res = await fetch(`/samples/${encodeURIComponent(sample)}.roomscan.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not load the sample "${sample}" (HTTP ${res.status}).`);
      return { text: await res.text(), origin: { kind: 'sample', name: sample } };
    }
    if (!file) throw new Error('Choose a scan file.');
    return { text: await file.text(), origin: { kind: 'file', name: file.name } };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const chosen = name.trim();
      if (creating && way === 'code') {
        const c = code.trim().toUpperCase();
        if (!isCode(c)) throw new Error('Type the 6-character code shown in the MOZU Scanner app.');
        onCreated!(await createProject({ code: c, ...(chosen ? { name: chosen } : { suggestedName: `Scan ${c}` }) }));
      } else {
        const { text, origin } = await fetchScan();
        const home = loadHome(text); // validates: a bad file throws a readable message
        if (creating) {
          const scan = JSON.parse(text) as HomeScan | RoomScan;
          const naming = chosen ? { name: chosen } : { suggestedName: defaultProjectName(origin, home.rooms.map((r) => r.name)) };
          onCreated!(await createProject({ scan, ...naming, source: sourceOf(origin) }));
        } else onOpen?.(text, origin);
      }
      setCode('');
      setName('');
      setFile(null);
    } catch (err) {
      setError((err as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <form onSubmit={(e) => void submit(e)} className="dialog-form">
          <h2>{creating ? 'New project' : 'Open a scan'}</h2>
          <p className="muted">
            {creating ? 'Start from a room scanned with the MOZU Scanner app, a sample, or a scan file.'
              : 'A room scanned with the MOZU Scanner app, a sample, or a scan file. As a guest, nothing is saved.'}
          </p>

          <div className="way-tabs" role="tablist">
            {([['code', 'Code from the phone'], ['sample', 'Sample'], ['file', 'File']] as const).map(([w, label]) => (
              <button key={w} type="button" role="tab" aria-selected={way === w} className={way === w ? 'on' : ''} onClick={() => { setWay(w); setError(''); }}>{label}</button>
            ))}
          </div>

          {way === 'code' && (
            <label className="field">
              <span>6-character code</span>
              <input className="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="B7K4M2" maxLength={6}
                autoComplete="off" spellCheck={false} autoFocus aria-invalid={code.length > 0 && !isCode(code)} />
              <small className="muted">Shown in the app after a scan is sent. Codes last 24 hours{creating ? '; the project keeps the scan for good.' : '.'}</small>
            </label>
          )}
          {way === 'sample' && (
            <label className="field">
              <span>Sample</span>
              <select value={sample} onChange={(e) => setSample(e.target.value)}>
                {samples.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
          {way === 'file' && (
            <label className="field">
              <span>Scan file (.roomscan.json)</span>
              <input type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}

          {creating && (
            <label className="field">
              <span>Name <em className="muted">(optional)</em></span>
              <input type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sennett Residence — Unit 12-04" autoComplete="off" />
            </label>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? (creating ? 'Creating…' : 'Opening…') : creating ? 'Create' : 'Open'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
