import type { ApiError, PageContentResponse, RecallResponse, StatusResponse, VaultModel } from '../../shared/model.ts';

export class ApiFailure extends Error {
  code: string | undefined;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body ?? {}) as Partial<ApiError>;
    throw new ApiFailure(err.error ?? `HTTP ${res.status}`, res.status, err.code);
  }
  return body as T;
}

function post<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export const api = {
  status: () => request<StatusResponse>('/api/status'),
  model: () => request<VaultModel>('/api/model'),
  page: (id: string) => request<PageContentResponse>(`/api/page?id=${encodeURIComponent(id)}`),
  selectVault: (path: string) => post<StatusResponse>('/api/vault', { path }),
  pickVault: () => post<{ cancelled: boolean; status: StatusResponse }>('/api/vault/pick', {}),
  recall: (query: string, top = 8) => post<RecallResponse>('/api/recall', { query, top }),
  open: (id: string, reveal = false) => post<{ ok: true }>('/api/open', { id, reveal }),
};

/** Server-sent model versions; reconnects on its own (EventSource retry). */
export function subscribeModelVersions(onVersion: (version: number) => void): () => void {
  const source = new EventSource('/api/events');
  source.addEventListener('model', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as { version?: unknown };
      if (typeof data.version === 'number') onVersion(data.version);
    } catch {
      /* ignore malformed frames */
    }
  });
  return () => source.close();
}
