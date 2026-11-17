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

/** Mirrors ProjectView in packages/server/src/routes/projects.ts. */
export interface ProjectView {
  id: string;
  path: string;
  mainBranch: string;
  /** false: the user has uncommitted changes, which agents do not see. */
  clean: boolean | null;
  taskCount: number;
  createdAt: string;
}

/** Mirrors TaskView in packages/server/src/routes/projects.ts. */
export interface TaskView {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  agent: string;
  status: TaskStatus;
  dependsOn: string[];
  expectedFiles: string[];
  branch: string | null;
  worktreePath: string | null;
  baseRef: string | null;
  changedFiles: string[];
  unexpectedFiles: string[];
  gitError: string | null;
  createdAt: string;
  active: boolean;
  latestRun: RunView | null;
}

export interface NewTask {
  title: string;
  prompt: string;
  agent: string;
  expectedFiles: string[];
  dependsOn: string | null;
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
    listProjects: () =>
      request<{ projects: ProjectView[] }>('GET', '/api/projects').then((r) => r.projects),
    addProject: (path: string) => request<ProjectView>('POST', '/api/projects', { path }),
    listTasks: (projectId: string) =>
      request<{ tasks: TaskView[] }>('GET', `/api/projects/${projectId}/tasks`).then(
        (r) => r.tasks,
      ),
    createTask: (projectId: string, task: NewTask) =>
      request<TaskView>('POST', `/api/projects/${projectId}/tasks`, task),
    startTask: (id: string) => request<TaskView>('POST', `/api/tasks/${id}/start`),
    stopTask: (id: string) => request<TaskView>('POST', `/api/tasks/${id}/stop`),
    cleanupTask: (id: string, deleteBranch: boolean) =>
      request<TaskView>('POST', `/api/tasks/${id}/cleanup`, { deleteBranch }),
    stopRun: (id: string) => request<RunView>('POST', `/api/runs/${id}/stop`),
    /** EventSource cannot send headers, so the token goes in the query (GET only on the server). */
    eventsUrl: (id: string) => `/api/runs/${id}/events?token=${encodeURIComponent(token)}`,
  };
}

export type Api = ReturnType<typeof createApi>;
