import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitSync, makeTestRepo, type TestRepo } from '../../test/git-repo.js';
import { fakeClaude, FIXTURES } from '../../test/helpers.js';
import { openDatabase, type DbHandle } from '../db/index.js';
import { Runner } from '../runner/runner.js';
import { DEFAULT_AGENT_OPTIONS, ServiceError, TaskService } from '../tasks/task-service.js';
import { TeamService } from './team-service.js';

const team = new TeamService();
let t: TestRepo | undefined;

afterEach(() => {
  if (t) rmSync(t.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  t = undefined;
});

function repo() {
  t = makeTestRepo();
  return t.repo;
}

function catchError(fn: () => unknown): ServiceError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError);
    return err as ServiceError;
  }
  throw new Error('expected a ServiceError');
}

const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');

describe('templates', () => {
  it('ships fullstack-web and minimal, both valid, with read-only planner and reviewer', () => {
    const templates = team.listTemplates();
    expect(templates.map((x) => x.id).sort()).toEqual(['fullstack-web', 'minimal']);
    const full = templates.find((x) => x.id === 'fullstack-web');
    expect(full?.agents.map((a) => a.id)).toEqual([
      'planner',
      'frontend',
      'backend',
      'database',
      'test',
      'reviewer',
    ]);
    expect(full?.agents.map((a) => [a.names.tech, a.names.friendly])).toEqual([
      ['Planlayıcı', 'Kaptan'],
      ['Ön Yüz', 'Pixel'],
      ['Arka Yüz', 'Motor'],
      ['Veritabanı', 'Kutu'],
      ['Test', 'Dedektif'],
      ['İnceleyici', 'Usta'],
    ]);
    for (const tpl of templates) {
      const reviewer = tpl.agents.find((a) => a.id === 'reviewer');
      expect(reviewer).toMatchObject({ readOnly: true, tools: ['Read', 'Glob', 'Grep'] });
    }
  });
});

describe('install', () => {
  it('writes .team/team.json and .claude/agents/*, never commits them', () => {
    const root = repo();
    const head = gitSync(root, 'rev-parse', 'HEAD');
    const result = team.install(root, { templateId: 'minimal' });
    expect(result.written).toEqual([
      '.team/team.json',
      '.claude/agents/planner.md',
      '.claude/agents/developer.md',
      '.claude/agents/reviewer.md',
    ]);
    expect(gitSync(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(
      gitSync(root, 'status', '--porcelain', '--untracked-files=all').split('\n').sort(),
    ).toEqual([
      '?? .claude/agents/developer.md',
      '?? .claude/agents/planner.md',
      '?? .claude/agents/reviewer.md',
      '?? .team/team.json',
    ]);
    const state = team.read(root);
    expect(state.status === 'ok' && state.team.agents.map((a) => a.id)).toEqual([
      'planner',
      'developer',
      'reviewer',
    ]);
  });

  it('is idempotent and asks before overwriting a changed file', () => {
    const root = repo();
    team.install(root, { templateId: 'minimal' });
    expect(team.install(root, { templateId: 'minimal' })).toEqual({
      written: [],
      unchanged: [
        '.team/team.json',
        '.claude/agents/planner.md',
        '.claude/agents/developer.md',
        '.claude/agents/reviewer.md',
      ],
    });

    const path = join(root, '.claude/agents/developer.md');
    writeFileSync(path, read(root, '.claude/agents/developer.md').replace('Geliştirici', 'Usta'));
    const edited = read(root, '.claude/agents/developer.md');
    const err = catchError(() => team.install(root, { templateId: 'minimal' }));
    expect(err.status).toBe(409);
    expect(err.extra).toEqual({ conflicts: ['.claude/agents/developer.md'] });
    expect(read(root, '.claude/agents/developer.md')).toBe(edited); // nothing written

    expect(team.install(root, { templateId: 'minimal', overwrite: true }).written).toEqual([
      '.claude/agents/developer.md',
    ]);
    expect(read(root, '.claude/agents/developer.md')).not.toBe(edited);
  });

  it('stores the chosen members and settings', () => {
    const root = repo();
    team.install(root, {
      templateId: 'fullstack-web',
      agents: ['planner', 'backend', 'reviewer'],
      settings: { concurrency: 2, requireReview: false },
    });
    const state = team.read(root);
    if (state.status !== 'ok') throw new Error(state.status);
    expect(state.team.settings).toEqual({
      concurrency: 2,
      worktrees: true,
      requirePlanApproval: true,
      requireReview: false,
    });
    expect(state.team.agents.filter((a) => a.enabled).map((a) => a.id)).toEqual([
      'planner',
      'backend',
      'reviewer',
    ]);
  });

  it('rejects unknown templates and agents', () => {
    const root = repo();
    expect(catchError(() => team.install(root, { templateId: 'nope' })).status).toBe(404);
    expect(catchError(() => team.install(root, { templateId: '../x' })).status).toBe(404);
    const err = catchError(() => team.install(root, { templateId: 'minimal', agents: ['ghost'] }));
    expect(err.message).toMatch(/ghost/);
    expect(catchError(() => team.install(root, { templateId: 'minimal', agents: [] })).status).toBe(
      400,
    );
  });
});

describe('reading a hand-edited team', () => {
  it('is missing without .team/team.json', () => {
    expect(team.read(repo())).toEqual({ status: 'missing' });
  });

  it('explains invalid JSON, schema errors and broken agent files in Turkish', () => {
    const root = repo();
    team.install(root, { templateId: 'minimal' });
    const json = read(root, '.team/team.json');

    writeFileSync(join(root, '.team/team.json'), json.replace('"#9ED8E8"', '"turkuaz"'));
    expect(team.read(root)).toEqual({
      status: 'invalid',
      error: '.team/team.json geçersiz: agents[0].color: color "#RRGGBB" biçiminde bir renk olmalı',
    });

    writeFileSync(join(root, '.team/team.json'), json.slice(0, -10));
    expect(team.read(root)).toMatchObject({
      status: 'invalid',
      error: expect.stringMatching(/geçerli bir JSON değil/),
    });

    writeFileSync(join(root, '.team/team.json'), json);
    rmSync(join(root, '.claude/agents/reviewer.md'));
    expect(team.read(root)).toMatchObject({
      status: 'invalid',
      error: expect.stringMatching(/^\.claude\/agents\/reviewer\.md bulunamadı/),
    });

    writeFileSync(
      join(root, '.claude/agents/reviewer.md'),
      '---\nname: other\ndescription: d\n---\nT',
    );
    expect(team.read(root)).toMatchObject({
      status: 'invalid',
      error: expect.stringMatching(/name alanı "other".*"reviewer"/),
    });
  });

  it('picks up a hand-edited prompt on the next read', () => {
    const root = repo();
    team.install(root, { templateId: 'minimal' });
    const path = join(root, '.claude/agents/developer.md');
    writeFileSync(
      path,
      read(root, '.claude/agents/developer.md').replace(
        /\n---\n[\s\S]*$/,
        '\n---\nYeni talimat.\n',
      ),
    );
    const config = team.runConfig(root, 'developer');
    expect(config.status === 'ok' && config.options.systemPrompt).toBe('Yeni talimat.');
  });
});

describe('editing from the Ekip page', () => {
  it('saves switch and names to team.json, prompt and model to the agent file', () => {
    const root = repo();
    team.install(root, { templateId: 'fullstack-web' });
    team.updateAgent(root, 'backend', {
      enabled: false,
      names: { tech: 'Sunucu' },
      prompt: 'Sunucu ve API kodu yaz. Testsiz uç nokta bırakma.',
      model: 'opus',
    });
    const state = team.read(root);
    if (state.status !== 'ok') throw new Error(state.status);
    expect(state.team.agents.find((a) => a.id === 'backend')).toMatchObject({
      enabled: false,
      names: { tech: 'Sunucu', friendly: 'Motor' },
      prompt: 'Sunucu ve API kodu yaz. Testsiz uç nokta bırakma.',
      model: 'opus',
    });
    expect(read(root, '.claude/agents/backend.md')).toMatch(
      /^---\nname: backend\n[\s\S]*model: opus\n---\n/,
    );

    team.updateSettings(root, { concurrency: 5 });
    const after = team.read(root);
    expect(after.status === 'ok' && after.team.settings.concurrency).toBe(5);
  });

  it('keeps at least one agent on and rejects invalid values', () => {
    const root = repo();
    team.install(root, { templateId: 'minimal' });
    team.updateAgent(root, 'planner', { enabled: false });
    team.updateAgent(root, 'developer', { enabled: false });
    expect(
      catchError(() => team.updateAgent(root, 'reviewer', { enabled: false })).message,
    ).toMatch(/en az bir ajan/);
    expect(catchError(() => team.updateAgent(root, 'ghost', { enabled: true })).status).toBe(404);
    expect(catchError(() => team.updateSettings(root, { concurrency: 99 })).message).toMatch(
      /concurrency/,
    );
  });
});

describe('agent settings reach the CLI', () => {
  let db: DbHandle | undefined;
  afterEach(() => {
    db?.close();
    db = undefined;
  });

  async function argsOfRun(root: string, agent: string, dir: string) {
    db = openDatabase(join(dir, 'test.db'));
    const argsFile = join(dir, 'args.json');
    const runner = new Runner({
      db: db.db,
      claude: fakeClaude,
      env: {
        ...process.env,
        FAKE_CLAUDE_FIXTURE: join(FIXTURES, '03-stream-verbose.jsonl'),
        FAKE_CLAUDE_HOME: join(dir, 'fake-home'),
        FAKE_CLAUDE_ARGS_FILE: argsFile,
      },
    });
    const service = new TaskService({
      db: db.db,
      runner,
      worktreesDir: join(dir, 'worktrees'),
      team,
    });
    const project = await service.addProject(root);
    const task = await service.createTask(project.id, { title: 'İş', prompt: 'x', agent });
    await (
      await service.startTask(task.id)
    ).done;
    await service.drain();
    const { argv } = JSON.parse(readFileSync(argsFile, 'utf8')) as { argv: string[] };
    const flag = (name: string) => argv[argv.indexOf(name) + 1];
    return { argv, flag };
  }

  it('uses the agent file: read-only tools for the reviewer, model, budget and prompt', async () => {
    const root = repo();
    const dir = t?.dir ?? '';
    // Committed like a user would; the definition is read from the user's checkout anyway.
    team.install(root, { templateId: 'fullstack-web' });
    team.updateAgent(root, 'reviewer', { model: 'haiku' });
    const { argv, flag } = await argsOfRun(root, 'reviewer', dir);
    expect(flag('--tools')).toBe('Read,Glob,Grep');
    expect(flag('--allowedTools')).toBe('Read,Glob,Grep');
    expect(flag('--model')).toBe('haiku');
    expect(flag('--max-budget-usd')).toBe('0.5');
    expect(flag('--append-system-prompt')).toMatch(/^Sen bu projenin İnceleyici ajanısın/);
    expect(argv).not.toContain('Edit');
  });

  it('falls back to the default agent without a team or for an unknown agent', async () => {
    const root = repo();
    const { flag, argv } = await argsOfRun(root, 'backend', t?.dir ?? '');
    expect(flag('--tools')).toBe((DEFAULT_AGENT_OPTIONS.tools ?? []).join(','));
    expect(flag('--max-budget-usd')).toBe('1');
    expect(argv).not.toContain('--append-system-prompt');
    expect(argv).not.toContain('--model');
  });

  it('refuses to start a task whose agent is switched off', async () => {
    const root = repo();
    const dir = t?.dir ?? '';
    team.install(root, { templateId: 'fullstack-web' });
    team.updateAgent(root, 'test', { enabled: false });
    db = openDatabase(join(dir, 'test.db'));
    const runner = new Runner({ db: db.db, claude: fakeClaude, env: process.env });
    const service = new TaskService({ db: db.db, runner, worktreesDir: join(dir, 'wt'), team });
    const project = await service.addProject(root);
    const task = await service.createTask(project.id, { title: 'İş', prompt: 'x', agent: 'test' });
    await expect(service.startTask(task.id)).rejects.toThrow(/Test ekipte kapalı/);
  });
});
