/**
 * The account API on this site: sessions and projects. Every call carries the
 * session cookie; every non-GET says it sends JSON (the server's CSRF check
 * requires it). Errors carry a readable sentence for the page to show.
 */
import type { HomeScan, RoomScan } from '@mozu/scan-sdk';
import type { Item } from './items';

export interface User {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
  picture?: string | null;
  providers?: string[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  rooms: number;
  source?: string | null;
  createdAt: string | number;
  updatedAt: string | number;
  rev: number;
  thumbnail?: string | null;
}

export interface Design {
  version: 3;
  items: Item[];
}

export interface ProjectRecord {
  project: ProjectMeta;
  scan: HomeScan | RoomScan;
  design: Design | null;
}

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const OFFLINE_MESSAGE = 'Could not reach MOZU. Check your connection and try again.';

export async function api<T = Record<string, unknown>>(
  method: string, path: string, body?: unknown, init: { keepalive?: boolean } = {},
): Promise<T> {
  const req: RequestInit = { method, credentials: 'same-origin', cache: 'no-store' };
  if (init.keepalive) req.keepalive = true;
  if (method !== 'GET') {
    // Always JSON on a write, even without a body: the server refuses anything else.
    req.headers = { 'content-type': 'application/json' };
    req.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(path, req);
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, 0);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(typeof json.error === 'string' ? json.error : `Request failed (HTTP ${res.status}).`, res.status, json);
  return json as T;
}

export const me = () => api<{ user: User }>('GET', '/api/auth/me').then((r) => r.user);
export const listProjects = () => api<{ projects: ProjectMeta[] }>('GET', '/api/projects').then((r) => r.projects ?? []);
export const getProject = (id: string) => api<ProjectRecord>('GET', `/api/projects/${encodeURIComponent(id)}`);
export const createProject = (body: { code: string; name?: string } | { scan: HomeScan | RoomScan; name?: string; source?: string }) =>
  api<{ project: ProjectMeta }>('POST', '/api/projects', body).then((r) => r.project);
export const renameProject = (id: string, name: string) =>
  api<{ project: ProjectMeta }>('PATCH', `/api/projects/${encodeURIComponent(id)}`, { name }).then((r) => r.project);
export const duplicateProject = (id: string, name?: string) =>
  api<{ project: ProjectMeta }>('POST', `/api/projects/${encodeURIComponent(id)}/duplicate`, name ? { name } : {}).then((r) => r.project);
export const deleteProject = (id: string) => api('DELETE', `/api/projects/${encodeURIComponent(id)}`);
export const putThumbnail = (id: string, dataUrl: string) => api('PUT', `/api/projects/${encodeURIComponent(id)}/thumbnail`, { dataUrl });
export const signOutSession = () => api('DELETE', '/api/auth/session');

/** The scan the phone uploaded under a 6-character code. */
export async function fetchScanByCode(input: string): Promise<{ code: string; scan: HomeScan | RoomScan }> {
  const wanted = input.trim().toUpperCase();
  let body: { code?: string; scan?: HomeScan | RoomScan };
  try {
    body = await api<{ code?: string; scan?: HomeScan | RoomScan }>('GET', `/api/scan-handoff?code=${encodeURIComponent(wanted)}`);
  } catch (e) {
    const err = e as ApiError;
    throw new ApiError(err.status === 0 ? 'Could not reach the scan service. Check the connection and try again.' : err.message, err.status, err.body);
  }
  if (!body.scan) throw new ApiError('The scan service could not find that code.', 404);
  return { code: body.code ?? wanted, scan: body.scan };
}

/** What the code input accepts: six letters or digits, in any case. */
export const isCode = (s: string) => /^[A-Za-z0-9]{6}$/.test(s.trim());
