import type { AgentEvent, ProjectSettings, RunStatus, TaskStatus } from '@squadboard/core';

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
  /** false for a fresh repository: tasks start only after the first commit. */
  hasCommits: boolean;
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
  /** Turkish for the common git failures. */
  gitError: string | null;
  /** git's own message behind gitError ("Ayrıntı"). */
  gitErrorDetail: string | null;
  createdAt: string;
  active: boolean;
  latestRun: RunView | null;
}

/** Mirrors AgentView in packages/server/src/team/team-service.ts. */
export interface AgentView {
  id: string;
  file: string;
  names: { tech: string; friendly: string };
  color: string;
  owns: string[];
  enabled: boolean;
  budgetUsd: number;
  description: string;
  tools: string[] | null;
  model: string | null;
  permissionMode: string | null;
  prompt: string;
  readOnly: boolean;
}

export interface TeamView {
  id: string;
  name: string;
  description: string | null;
  settings: ProjectSettings;
  agents: AgentView[];
}

export type TeamState =
  { status: 'missing' } | { status: 'invalid'; error: string } | { status: 'ok'; team: TeamView };

export interface TemplateView extends TeamView {
  files: string[];
}

/** Mirrors ProjectChecks in packages/server/src/routes/team.ts. */
export interface ProjectChecks {
  path: string;
  isRepo: boolean;
  mainBranch: string;
  hasCommits: boolean;
  changes: number | null;
  claude: { ok: boolean; version: string | null };
}

export interface InstallTeam {
  templateId: string;
  agents: string[];
  settings: Partial<ProjectSettings>;
  overwrite: boolean;
}

export interface InstallResult {
  written: string[];
  unchanged: string[];
  state: TeamState;
}

export interface AgentPatch {
  enabled?: boolean;
  names?: { tech?: string; friendly?: string };
  prompt?: string;
  model?: string | null;
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

/** `message` is the server's sentence for the user; `detail` the raw cause (e.g. git output). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail: string | null = null,
    /** Files that already exist with other content (team install, 409). */
    readonly conflicts: string[] = [],
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export function createApi(token: string) {
  async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(path, init);
    } catch {
      throw new ApiError(0, 'Sunucuya ulaşılamıyor.');
    }
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
      conflicts?: string[];
    };
    if (!res.ok) {
      throw new ApiError(
        res.status,
        data.error ?? `HTTP ${res.status}`,
        data.detail ?? null,
        data.conflicts ?? [],
      );
    }
    return data as T;
  }

  return {
    /** Server liveness (no token needed). Throws when the server is unreachable. */
    health: () => request<{ status: string }>('GET', '/health'),
    listRuns: () => request<{ runs: RunView[] }>('GET', '/api/runs').then((r) => r.runs),
    listProjects: () =>
      request<{ projects: ProjectView[] }>('GET', '/api/projects').then((r) => r.projects),
    addProject: (path: string) => request<ProjectView>('POST', '/api/projects', { path }),
    deleteProject: (id: string) => request<unknown>('DELETE', `/api/projects/${id}`),
    listTemplates: () =>
      request<{ templates: TemplateView[] }>('GET', '/api/templates').then((r) => r.templates),
    getTeam: (projectId: string) => request<TeamState>('GET', `/api/projects/${projectId}/team`),
    getChecks: (projectId: string) =>
      request<ProjectChecks>('GET', `/api/projects/${projectId}/checks`),
    installTeam: (projectId: string, input: InstallTeam) =>
      request<InstallResult>('POST', `/api/projects/${projectId}/team/install`, input),
    updateTeamSettings: (projectId: string, settings: Partial<ProjectSettings>) =>
      request<TeamView>('PATCH', `/api/projects/${projectId}/team/settings`, settings),
    updateAgent: (projectId: string, agentId: string, patch: AgentPatch) =>
      request<TeamView>('PATCH', `/api/projects/${projectId}/team/agents/${agentId}`, patch),
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
