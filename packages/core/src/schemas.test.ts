import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_SETTINGS, Decision, Project, Review, Run, Task } from './schemas.js';

const now = '2026-11-17T12:00:00.000Z';

describe('schemas', () => {
  it('accepts valid domain objects', () => {
    expect(
      Project.parse({
        id: 'p1',
        path: '/repo',
        mainBranch: 'main',
        testCommand: null,
        settings: DEFAULT_PROJECT_SETTINGS,
        createdAt: now,
      }).settings.concurrency,
    ).toBe(3);
    expect(
      Task.parse({
        id: 'api',
        requestId: 'r1',
        title: 'Auth API',
        agent: 'backend',
        dependsOn: ['db'],
        expectedFiles: ['src/api/auth.ts'],
        status: 'blocked',
        stage: 1,
        branch: 'team/api',
        worktreePath: null,
      }).status,
    ).toBe('blocked');
    expect(
      Run.safeParse({
        id: 'run1',
        taskId: 'api',
        sessionId: null,
        cwd: '/repo/.ekip/worktrees/api',
        status: 'running',
        startedAt: now,
        endedAt: null,
        costUsd: null,
        numTurns: null,
      }).success,
    ).toBe(true);
    expect(
      Decision.safeParse({
        id: 'd1',
        requestId: 'r1',
        taskId: null,
        source: 'planner',
        question: 'Which DB?',
        options: ['SQLite', 'Postgres'],
        choice: null,
        createdAt: now,
        answeredAt: null,
      }).success,
    ).toBe(true);
    expect(
      Review.safeParse({
        id: 'rv1',
        taskId: 'api',
        summary: 'Adds login endpoint.',
        risk: 'low',
        checks: [{ title: 'Tests', note: 'pass', status: 'pass' }],
        files: ['src/api/auth.ts'],
        verdict: null,
        createdAt: now,
      }).success,
    ).toBe(true);
  });

  it('rejects unknown statuses, bad risk and bad timestamps', () => {
    expect(Run.shape.status.safeParse('paused').success).toBe(false);
    expect(Review.shape.risk.safeParse('critical').success).toBe(false);
    expect(Decision.shape.createdAt.safeParse('yesterday').success).toBe(false);
  });
});

describe('core dependencies', () => {
  it('has no runtime dependency other than zod (no Node-only or UI packages)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['zod']);
  });
});
