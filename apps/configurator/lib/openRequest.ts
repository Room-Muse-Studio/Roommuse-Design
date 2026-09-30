/**
 * What the editor's address asks it to open.
 *
 *   /editor?project=ID          a project from the account (autosaved)
 *   /editor?code=B7K4M2         a scan sent from the phone, by its code (guest)
 *   /editor?sample=twobedroom   a sample (guest)
 *   /editor?poly=…&h=…[&scan=…] the phone's "Open in MOZU on this device" link (guest)
 *   /editor?restore=1           the guest's work parked while signing in
 *   /editor                     the default sample (guest)
 */
export type OpenRequest =
  | { kind: 'project'; id: string }
  | { kind: 'code'; code: string }
  | { kind: 'sample'; name: string }
  | { kind: 'link'; params: URLSearchParams }
  | { kind: 'restore' }
  | { kind: 'default' };

export const DEFAULT_SAMPLE = 'twobedroom';

/** Query keys the phone's links carry; a page with any of them skips the sign-in wall. */
export const LINK_PARAMS = ['code', 'scan', 'poly', 'h', 'src'];

export const isScanLink = (params: URLSearchParams) => LINK_PARAMS.some((k) => params.has(k));

export function parseOpenRequest(params: URLSearchParams): OpenRequest {
  const project = params.get('project');
  if (project) return { kind: 'project', id: project };
  const code = params.get('code');
  if (code) return { kind: 'code', code: code.trim().toUpperCase() };
  if (params.get('scan') || params.get('poly')) return { kind: 'link', params };
  const sample = params.get('sample');
  if (sample) return { kind: 'sample', name: sample };
  if (params.get('restore')) return { kind: 'restore' };
  return { kind: 'default' };
}
