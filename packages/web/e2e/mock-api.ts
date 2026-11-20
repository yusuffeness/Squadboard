import type { Page } from '@playwright/test';
import type {
  AgentView,
  ProjectChecks,
  ProjectView,
  RunView,
  TaskView,
  TeamState,
  TeamView,
  TemplateView,
} from '../src/api';

/** Shapes mirror packages/server routes; only what the UI reads matters. */
const now = new Date();
const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

export const PROJECT: ProjectView = {
  id: 'p1',
  path: 'C:\\Users\\sen\\kafe-siparis',
  mainBranch: 'main',
  clean: true,
  hasCommits: true,
  taskCount: 5,
  createdAt: iso(600),
};

function run(id: string, taskId: string, over: Partial<RunView> = {}): RunView {
  return {
    id,
    taskId,
    prompt: 'x',
    cwd: 'C:\\wt',
    status: 'succeeded',
    taskStatus: 'in_review',
    sessionId: 's',
    costUsd: 0.1,
    numTurns: 3,
    error: null,
    startedAt: iso(30),
    endedAt: iso(25),
    active: false,
    ...over,
  };
}

function task(id: string, over: Partial<TaskView>): TaskView {
  return {
    id,
    projectId: PROJECT.id,
    title: id,
    prompt: 'x',
    agent: 'general',
    status: 'planned',
    dependsOn: [],
    expectedFiles: [],
    branch: null,
    worktreePath: null,
    baseRef: null,
    changedFiles: [],
    unexpectedFiles: [],
    gitError: null,
    gitErrorDetail: null,
    createdAt: iso(60),
    active: false,
    latestRun: null,
    ...over,
  };
}

const RUNNING = run('r-running', 't-page', {
  status: 'running',
  taskStatus: 'running',
  costUsd: null,
  endedAt: null,
  active: true,
});

export const TASKS: TaskView[] = [
  task('t-page', {
    title: 'Sipariş sayfası',
    agent: 'frontend',
    status: 'running',
    active: true,
    branch: 'team/siparis-sayfasi-ab12',
    worktreePath: 'C:\\wt\\a',
    latestRun: RUNNING,
  }),
  task('t-tests', {
    title: 'Sipariş akışı testleri',
    agent: 'test',
    status: 'blocked',
    dependsOn: ['t-page'],
  }),
  task('t-table', {
    title: 'Sipariş tablosu',
    agent: 'database',
    status: 'waiting_decision',
    branch: 'team/siparis-tablosu-cd34',
    worktreePath: 'C:\\wt\\b',
    latestRun: run('r-table', 't-table', { taskStatus: 'waiting_decision', costUsd: 0.12 }),
  }),
  task('t-menu', {
    title: 'Menü kartları',
    agent: 'frontend',
    status: 'in_review',
    branch: 'team/menu-kartlari-ef56',
    worktreePath: 'C:\\wt\\c',
    changedFiles: ['src/Menu.tsx', 'src/Card.tsx', 'notes.txt'],
    unexpectedFiles: ['notes.txt'],
    latestRun: run('r-menu', 't-menu', { costUsd: 0.3 }),
  }),
  task('t-schema', {
    title: 'Ürün şeması',
    agent: 'database',
    status: 'done',
    branch: 'team/urun-semasi-gh78',
    latestRun: run('r-schema', 't-schema', { costUsd: null }),
  }),
];

/** 0.12 + 0.30 today; an older run must not count. */
export const RUNS: RunView[] = [
  RUNNING,
  ...TASKS.flatMap((t) => (t.latestRun && t.latestRun !== RUNNING ? [t.latestRun] : [])),
  run('r-old', 't-menu', {
    costUsd: 5,
    startedAt: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
  }),
];

const SSE_EVENTS = [
  {
    seq: 0,
    event: {
      kind: 'session_started',
      sessionId: 's',
      model: 'claude-test',
      cwd: 'C:\\wt\\a',
      tools: [],
    },
  },
  {
    seq: 1,
    event: { kind: 'tool_use', id: 'u1', name: 'Read', input: { file_path: 'src/pages/Menu.tsx' } },
  },
  { seq: 2, event: { kind: 'text', text: 'Sipariş sepeti için yeni bir bileşen yazıyorum.' } },
];

const agent = (
  id: string,
  tech: string,
  friendly: string,
  color: string,
  over: Partial<AgentView> = {},
): AgentView => ({
  id,
  file: `${id}.md`,
  names: { tech, friendly },
  color,
  owns: [],
  enabled: true,
  budgetUsd: 1,
  description: `${tech} işi yapar`,
  tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'],
  model: 'sonnet',
  permissionMode: null,
  prompt: `Sen bu projenin ${tech} ajanısın.`,
  readOnly: false,
  ...over,
});

const READ_ONLY = { tools: ['Read', 'Glob', 'Grep'], readOnly: true, budgetUsd: 0.5 };
const SETTINGS = {
  concurrency: 3,
  worktrees: true,
  requirePlanApproval: true,
  requireReview: true,
};

/** The full-stack template as the server lists it. */
export const TEMPLATE: TemplateView = {
  id: 'fullstack-web',
  name: 'Full-stack web uygulaması',
  description: 'Altı kişilik ekip.',
  settings: SETTINGS,
  files: ['.team/team.json'],
  agents: [
    agent('planner', 'Planlayıcı', 'Kaptan', '#9ED8E8', READ_ONLY),
    agent('frontend', 'Ön Yüz', 'Pixel', '#FFB38A'),
    agent('backend', 'Arka Yüz', 'Motor', '#8FB3FF'),
    agent('database', 'Veritabanı', 'Kutu', '#86D3AE'),
    agent('test', 'Test', 'Dedektif', '#C6A8F0'),
    agent('reviewer', 'İnceleyici', 'Usta', '#F5D27A', READ_ONLY),
  ],
};

export const MINIMAL: TemplateView = {
  id: 'minimal',
  name: 'Küçük ekip',
  description: 'Üç kişilik ekip.',
  settings: SETTINGS,
  files: ['.team/team.json'],
  agents: [
    agent('planner', 'Planlayıcı', 'Kaptan', '#9ED8E8', READ_ONLY),
    agent('developer', 'Geliştirici', 'Kalfa', '#FFB38A'),
    agent('reviewer', 'İnceleyici', 'Usta', '#F5D27A', READ_ONLY),
  ],
};

/** An installed team (from the template), as `GET /api/projects/:id/team` returns it. */
export function teamOf(template: TemplateView, over: Partial<TeamView> = {}): TeamState {
  const team: TeamView = {
    id: template.id,
    name: template.name,
    description: template.description,
    settings: template.settings,
    agents: template.agents,
  };
  return { status: 'ok', team: { ...structuredClone(team), ...over } };
}

export const CHECKS: ProjectChecks = {
  path: PROJECT.path,
  isRepo: true,
  mainBranch: 'main',
  hasCommits: true,
  changes: 0,
  claude: { ok: true, version: '2.1.150' },
};

export interface MockOptions {
  projects?: ProjectView[];
  tasks?: TaskView[];
  /** Default: the full-stack team is installed. */
  team?: TeamState;
  checks?: ProjectChecks;
  /** Files the install reports as existing with other content (409 until overwrite). */
  conflicts?: string[];
}

/** What the page sent, for assertions. */
export interface MockLog {
  installs: unknown[];
  agentPatches: { agentId: string; body: unknown }[];
  settingsPatches: unknown[];
  deleted: string[];
}

/** Answers every API call in the page. Unknown calls fail loudly so tests notice. */
export async function mockApi(page: Page, opts: MockOptions = {}): Promise<MockLog> {
  let projects = opts.projects ?? [PROJECT];
  const tasks = opts.tasks ?? TASKS;
  let team: TeamState = opts.team ?? teamOf(TEMPLATE);
  const log: MockLog = { installs: [], agentPatches: [], settingsPatches: [], deleted: [] };

  await page.route('**/health', (r) => r.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = (): Record<string, unknown> =>
      (request.postDataJSON() as Record<string, unknown> | null) ?? {};

    if (path === '/api/projects') return route.fulfill({ json: { projects } });
    const del = /^\/api\/projects\/([^/]+)$/.exec(path);
    if (del && method === 'DELETE') {
      log.deleted.push(del[1] ?? '');
      projects = projects.filter((p) => p.id !== del[1]);
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === '/api/templates')
      return route.fulfill({ json: { templates: [TEMPLATE, MINIMAL] } });
    if (/^\/api\/projects\/[^/]+\/team$/.test(path)) return route.fulfill({ json: team });
    if (/^\/api\/projects\/[^/]+\/checks$/.test(path)) {
      return route.fulfill({ json: opts.checks ?? CHECKS });
    }
    if (/\/team\/install$/.test(path)) {
      const input = body();
      log.installs.push(input);
      const conflicts = opts.conflicts ?? [];
      if (conflicts.length > 0 && input.overwrite !== true) {
        return route.fulfill({
          status: 409,
          json: { error: 'Bu dosyalar zaten var. Üzerine yazılsın mı?', conflicts },
        });
      }
      const template = input.templateId === 'minimal' ? MINIMAL : TEMPLATE;
      const on = (input.agents as string[] | undefined) ?? template.agents.map((a) => a.id);
      team = teamOf(template, {
        agents: template.agents.map((a) => ({ ...a, enabled: on.includes(a.id) })),
      });
      return route.fulfill({
        status: 201,
        json: {
          written: ['.team/team.json', '.claude/agents/planner.md'],
          unchanged: [],
          state: team,
        },
      });
    }
    const agentPatch = /\/team\/agents\/([^/]+)$/.exec(path);
    if (agentPatch && method === 'PATCH' && team.status === 'ok') {
      const patch = body() as {
        enabled?: boolean;
        names?: Partial<AgentView['names']>;
        prompt?: string;
        model?: string | null;
      };
      log.agentPatches.push({ agentId: agentPatch[1] ?? '', body: patch });
      team.team.agents = team.team.agents.map((a) =>
        a.id === agentPatch[1]
          ? {
              ...a,
              ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
              ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
              ...(patch.model !== undefined ? { model: patch.model } : {}),
              names: { ...a.names, ...patch.names },
            }
          : a,
      );
      return route.fulfill({ json: team.team });
    }
    if (/\/team\/settings$/.test(path) && method === 'PATCH' && team.status === 'ok') {
      log.settingsPatches.push(body());
      team.team.settings = { ...team.team.settings, ...body() };
      return route.fulfill({ json: team.team });
    }
    if (/^\/api\/projects\/[^/]+\/tasks$/.test(path)) return route.fulfill({ json: { tasks } });
    if (path === '/api/runs') return route.fulfill({ json: { runs: RUNS } });
    if (/^\/api\/runs\/[^/]+\/events$/.test(path)) {
      const body = SSE_EVENTS.map(
        (e) => `id: ${e.seq}\nevent: agent\ndata: ${JSON.stringify(e)}\n\n`,
      ).join('');
      // retry: keep EventSource from reconnecting during the test.
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: `retry: 600000\n\n${body}`,
      });
    }
    return route.fulfill({ status: 404, json: { error: `not mocked: ${method} ${path}` } });
  });
  return log;
}

export const BOARD_URL = '/#token=test-token';
