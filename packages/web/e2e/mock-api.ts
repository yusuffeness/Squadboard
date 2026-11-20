import type { Page } from '@playwright/test';
import type { ProjectView, RunView, TaskView } from '../src/api';

/** Shapes mirror packages/server routes; only what the UI reads matters. */
const now = new Date();
const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

export const PROJECT: ProjectView = {
  id: 'p1',
  path: 'C:\\Users\\sen\\kafe-siparis',
  mainBranch: 'main',
  clean: true,
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

export interface MockOptions {
  projects?: ProjectView[];
  tasks?: TaskView[];
}

/** Answers every API call in the page. Unknown calls fail loudly so tests notice. */
export async function mockApi(page: Page, opts: MockOptions = {}) {
  const projects = opts.projects ?? [PROJECT];
  const tasks = opts.tasks ?? TASKS;

  await page.route('**/health', (r) => r.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/projects') return route.fulfill({ json: { projects } });
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
    return route.fulfill({ status: 404, json: { error: `not mocked: ${path}` } });
  });
}

export const BOARD_URL = '/#token=test-token';
