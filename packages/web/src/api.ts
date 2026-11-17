import type { AgentEvent, RunStatus, TaskStatus } from '@squadboard/core';

/**
 * The session token comes from the URL fragment (`#token=…`) that `squadboard` printed.
 * Fragments are never sent to the server or in Referer headers. It is only kept in memory
 * (and in the address bar, so a reload still works); never in localStorage.
 */
export function readToken(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return params.get('token');
}

/** Mirrors RunView in packages/server/src/routes/runs.ts. */
export interface RunView {
  id: string;
  taskId: string;
  prompt: string;
  cwd: string;
  status: RunStatus;
  taskStatus: TaskStatus;
  sessionId: string | null;
  costUsd: number | null;
  numTurns: number | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
}

export interface StreamedEvent {
  seq: number;
  event: AgentEvent;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApi(token: string) {
  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(path, init);
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  return {
    listRuns: () => request<{ runs: RunView[] }>('GET', '/api/runs').then((r) => r.runs),
    createRun: (input: { prompt: string; cwd: string }) =>
      request<RunView>('POST', '/api/runs', input),
    stopRun: (id: string) => request<RunView>('POST', `/api/runs/${id}/stop`),
    /** EventSource cannot send headers, so the token goes in the query (GET only on the server). */
    eventsUrl: (id: string) => `/api/runs/${id}/events?token=${encodeURIComponent(token)}`,
  };
}

export type Api = ReturnType<typeof createApi>;
