'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

export interface DialogRequest {
  title: string;
  text?: string;
  /** With a label the dialog asks for a value; without, it only confirms. */
  field?: string;
  value?: string;
  placeholder?: string;
  ok?: string;
  danger?: boolean;
}

interface Props {
  request: DialogRequest | null;
  /** The typed value ('' for a plain confirm), or null when cancelled. */
  onClose: (value: string | null) => void;
  /** Runs before closing; a thrown error is shown in the dialog. */
  onSubmit?: (value: string) => Promise<void>;
}

/** One native <dialog> for prompts and confirmations, like the old shell's. */
export default function Dialog({ request, onClose, onSubmit }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (request) {
      setValue(request.value ?? '');
      setError('');
      setBusy(false);
      if (!dlg.open) dlg.showModal();
      const input = dlg.querySelector('input');
      if (input) {
        input.focus();
        input.select();
      }
    } else if (dlg.open) {
      dlg.close();
    }
  }, [request]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!request) return;
    const v = value.trim();
    if (request.field && !v) {
      setError(`Please enter a ${request.field.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit?.(v);
      onClose(v);
    } catch (err) {
      setError((err as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog" onClose={() => { if (request) onClose(null); }} onCancel={(e) => { e.preventDefault(); onClose(null); }}>
      {request && (
        <form onSubmit={(e) => void submit(e)} className="dialog-form">
          <h2>{request.title}</h2>
          {request.text && <p className="muted">{request.text}</p>}
          {request.field && (
            <label className="field">
              <span>{request.field}</span>
              <input type="text" value={value} maxLength={120} autoComplete="off" placeholder={request.placeholder} onChange={(e) => setValue(e.target.value)} />
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={() => onClose(null)} disabled={busy}>Cancel</button>
            <button type="submit" className={request.danger ? 'btn danger' : 'btn primary'} disabled={busy}>{request.ok ?? 'OK'}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
