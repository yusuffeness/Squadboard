import type {
  AgentEvent,
  PlanDecision,
  ProjectSettings,
  RunStatus,
  TaskStatus,
} from '@squadboard/core';

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
  /** Why a ready task was not started (e.g. its dependencies' branches conflict). */
  blockedReason: string | null;
  /** Stopped because Squadboard shut down ("Kesildi"). */
  interrupted: boolean;
  /** The plan this task came from; null for a hand-made task. */
  planId: string | null;
  stage: number;
  createdAt: string;
  active: boolean;
  latestRun: RunView | null;
  /** What a waiting task needs from the user (empty unless `waiting_decision`). */
  pending: PendingView;
}

/** Mirrors the views in packages/server/src/decisions/decision-service.ts. */
export interface QuestionView {
  id: string;
  question: string;
  /** Empty: answer in free text. */
  options: string[];
  multiSelect: boolean;
  /** The agent tried to ask but the question could not be read; `question` is what it wrote. */
  problem: string | null;
}

export interface PermissionView {
  id: string;
  tool: string;
  command: string | null;
  path: string | null;
  /** What "Hep izin ver" writes to .team/team.json. */
  rule: string;
}

export interface PendingView {
  questions: QuestionView[];
  permissions: PermissionView[];
  /** How many times this task's agent has asked (1 = first time). */
  round: number;
}

/** once = "Bir kez", task = "İzin ver" (this task), always = "Hep izin ver" (this project). */
export type PermissionAction = 'once' | 'task' | 'always' | 'denied';

export interface AnswerInput {
  answers?: Record<string, string>;
  /** "Ajanın kararına bırak". */
  delegate?: boolean;
  note?: string;
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
  /** Allow rules of every run (`--allowedTools`): from team.json or derived from the project. */
  permissions: { allow: string[]; fromFile: boolean };
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

/** Mirrors the types in packages/server/src/plans/plan-service.ts. */
export type PlanStatus =
  'planning' | 'awaiting_approval' | 'running' | 'interrupted' | 'done' | 'failed' | 'cancelled';

export interface PlanStep {
  id: string;
  label: string;
  detail: string | null;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  endedAt: string | null;
}

export interface PlanTaskView {
  id: string;
  title: string;
  agent: string;
  prompt: string;
  dependsOn: string[];
  runsAfter: string[];
  expectedFiles: string[];
  stage: number;
  outsideOwns: string[];
  agentUnavailable: boolean;
}

export interface PlanContent {
  tasks: PlanTaskView[];
  openDecisions: PlanDecision[];
  stages: string[][];
  notes: string[];
  warnings: string[];
  summary: { agents: number; files: number; maxCostUsd: number };
  assignableAgents: string[];
}

export interface PlanView {
  id: string;
  projectId: string;
  text: string;
  status: PlanStatus;
  error: string | null;
  errorDetail: string | null;
  steps: PlanStep[];
  plannerCostUsd: number | null;
  createdAt: string;
  approvedAt: string | null;
  requirePlanApproval: boolean;
  plan: PlanContent | null;
  progress: { total: number; finished: number; failed: number; interrupted: number } | null;
}

export type PlanEdit = { removeTask: string } | { taskId: string; agent: string };

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
    answerTask: (id: string, input: AnswerInput) =>
      request<TaskView>('POST', `/api/tasks/${id}/answer`, input),
    respondPermission: (taskId: string, permissionId: string, action: PermissionAction) =>
      request<TaskView>('POST', `/api/tasks/${taskId}/permissions/${permissionId}`, { action }),
    cleanupTask: (id: string, deleteBranch: boolean) =>
      request<TaskView>('POST', `/api/tasks/${id}/cleanup`, { deleteBranch }),
    stopRun: (id: string) => request<RunView>('POST', `/api/runs/${id}/stop`),
    listPlans: (projectId: string) =>
      request<{ plans: PlanView[] }>('GET', `/api/projects/${projectId}/plans`).then(
        (r) => r.plans,
      ),
    getPlan: (id: string) => request<PlanView>('GET', `/api/plans/${id}`),
    startPlan: (projectId: string, text: string) =>
      request<PlanView>('POST', `/api/projects/${projectId}/plans`, { text }),
    editPlan: (id: string, edit: PlanEdit) => request<PlanView>('PATCH', `/api/plans/${id}`, edit),
    approvePlan: (id: string, answers: Record<string, string>) =>
      request<PlanView>('POST', `/api/plans/${id}/approve`, { answers }),
    cancelPlan: (id: string) => request<PlanView>('POST', `/api/plans/${id}/cancel`),
    resumePlan: (id: string) => request<PlanView>('POST', `/api/plans/${id}/resume`),
    /** "Something changed in this project" stream (EventSource, token in the query). */
    projectEventsUrl: (projectId: string) =>
      `/api/projects/${projectId}/events?token=${encodeURIComponent(token)}`,
    /** EventSource cannot send headers, so the token goes in the query (GET only on the server). */
    eventsUrl: (id: string) => `/api/runs/${id}/events?token=${encodeURIComponent(token)}`,
  };
}

export type Api = ReturnType<typeof createApi>;
