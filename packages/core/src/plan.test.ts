import { describe, expect, it } from 'vitest';
import {
  PlanValidationError,
  computeStages,
  findCycle,
  globToRegExp,
  patternsOverlap,
  schedulePlan,
  validatePlan,
} from './plan.js';
import type { PlanInput, PlanTask } from './schemas.js';

const task = (
  id: string,
  dependsOn: string[] = [],
  expectedFiles: string[] = [],
  agent = 'backend',
): PlanTask => ({ id, title: `Task ${id}`, agent, dependsOn, expectedFiles });

// Example from docs/ARCHITECTURE.md
const authPlan: PlanInput = {
  tasks: [
    task('db', [], ['db/migrations/*'], 'database'),
    task('api', ['db'], ['src/api/auth.ts', 'src/types/user.ts']),
    task('ui', ['api'], ['src/pages/login.tsx'], 'frontend'),
  ],
};

describe('validatePlan', () => {
  it('accepts the architecture example and defaults openDecisions to []', () => {
    const result = validatePlan(authPlan, { agents: ['database', 'backend', 'frontend'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.openDecisions).toEqual([]);
  });

  it('reports schema errors with a path', () => {
    const result = validatePlan({ tasks: [{ id: 'a', title: 'A', agent: 'x', dependsOn: [] }] });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: 'schema', path: 'tasks.0.expectedFiles' }],
    });
    expect(validatePlan({ tasks: [] }).ok).toBe(false);
  });

  it('reports duplicate ids, unknown/self dependencies and unknown agents', () => {
    const result = validatePlan(
      { tasks: [task('a', ['a']), task('a'), task('b', ['ghost'], [], 'designer')] },
      { agents: ['backend'] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          { code: 'duplicate_task_id', taskId: 'a' },
          { code: 'self_dependency', taskId: 'a' },
          { code: 'unknown_dependency', taskId: 'b', dependsOn: 'ghost' },
          { code: 'unknown_agent', taskId: 'b', agent: 'designer' },
        ]),
      );
    }
  });

  it('detects a dependency cycle and names it', () => {
    const result = validatePlan({ tasks: [task('a', ['c']), task('b', ['a']), task('c', ['b'])] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue?.code).toBe('cycle');
      if (issue?.code === 'cycle') {
        expect(issue.cycle[0]).toBe(issue.cycle.at(-1));
        expect(new Set(issue.cycle)).toEqual(new Set(['a', 'b', 'c']));
      }
    }
  });

  it('validates Planner open decisions', () => {
    const decision = {
      id: 'd1',
      question: 'Which DB?',
      options: ['SQLite', 'Postgres'],
      taskIds: ['db'],
    };
    expect(validatePlan({ ...authPlan, openDecisions: [decision] }).ok).toBe(true);
    const bad = validatePlan({
      ...authPlan,
      openDecisions: [decision, { ...decision, taskIds: ['nope'] }],
    });
    expect(bad).toMatchObject({
      ok: false,
      issues: [
        { code: 'duplicate_decision_id', decisionId: 'd1' },
        { code: 'unknown_decision_task', decisionId: 'd1', taskId: 'nope' },
      ],
    });
    expect(
      validatePlan({ ...authPlan, openDecisions: [{ ...decision, options: ['only one'] }] }).ok,
    ).toBe(false);
  });
});

describe('findCycle / computeStages', () => {
  it('finds no cycle in a DAG', () => {
    expect(findCycle([task('a'), task('b', ['a']), task('c', ['a', 'b'])])).toBeNull();
  });

  it('layers tasks topologically, keeping plan order inside a stage', () => {
    const stages = computeStages([
      task('ui', ['api']),
      task('db'),
      task('docs'),
      task('api', ['db']),
      task('e2e', ['ui', 'api']),
    ]);
    expect(stages).toEqual([['db', 'docs'], ['api'], ['ui'], ['e2e']]);
  });

  it('throws PlanValidationError on a cycle', () => {
    expect(() => computeStages([task('a', ['b']), task('b', ['a'])])).toThrow(PlanValidationError);
  });
});

describe('patternsOverlap / globToRegExp', () => {
  it.each([
    ['src/a.ts', 'src/a.ts', true],
    ['./src/a.ts', 'src\\a.ts', true],
    ['src/a.ts', 'src/b.ts', false],
    ['db/migrations/*', 'db/migrations/001.sql', true],
    ['db/migrations/*', 'db/migrations/sub/001.sql', false],
    ['src/**', 'src/api/deep/x.ts', true],
    ['src/**/*.ts', 'src/x.ts', true],
    ['src/api/**', 'src/web/x.ts', false],
    ['src/api/**', 'src/api/*.ts', true], // both globs: compare literal prefixes
    ['src/api/**', 'src/web/**', false],
    ['file?.ts', 'file1.ts', true],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(patternsOverlap(a, b)).toBe(expected);
    expect(patternsOverlap(b, a)).toBe(expected);
  });

  it('escapes regex characters', () => {
    expect(globToRegExp('a.(b).ts').test('a.(b).ts')).toBe(true);
    expect(globToRegExp('a.(b).ts').test('aX(b)Xts')).toBe(false);
  });
});

describe('schedulePlan', () => {
  it('keeps independent tasks parallel', () => {
    const { stages, conflicts } = schedulePlan({
      tasks: [task('a', [], ['src/a.ts']), task('b', [], ['src/b.ts'])],
    });
    expect(stages).toEqual([['a', 'b']]);
    expect(conflicts).toEqual([]);
  });

  it('serialises same-stage tasks with overlapping files, earlier one first', () => {
    const { plan, stages, conflicts } = schedulePlan({
      tasks: [
        task('api', [], ['src/types/user.ts', 'src/api/auth.ts']),
        task('ui', [], ['src/pages/login.tsx']),
        task('types', [], ['src/types/*.ts']),
      ],
    });
    expect(stages).toEqual([['api', 'ui'], ['types']]);
    expect(conflicts).toEqual([
      { first: 'api', then: 'types', files: [['src/types/user.ts', 'src/types/*.ts']] },
    ]);
    expect(plan.tasks.find((t) => t.id === 'types')?.dependsOn).toEqual(['api']);
  });

  it('resolves chains of conflicts across stages', () => {
    const { stages, conflicts } = schedulePlan({
      tasks: [
        task('a', [], ['shared.ts']),
        task('b', [], ['shared.ts']),
        task('c', [], ['shared.ts']),
      ],
    });
    expect(stages).toEqual([['a'], ['b'], ['c']]);
    expect(conflicts.map((c) => [c.first, c.then])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
  });

  it('does not touch tasks already ordered by dependencies', () => {
    const { conflicts } = schedulePlan({
      tasks: [task('a', [], ['x.ts']), task('b', ['a'], ['x.ts'])],
    });
    expect(conflicts).toEqual([]);
  });

  it('does not mutate the input plan', () => {
    const input: PlanInput = { tasks: [task('a', [], ['x.ts']), task('b', [], ['x.ts'])] };
    schedulePlan(input);
    expect(input.tasks[1]?.dependsOn).toEqual([]);
  });

  it('throws on an invalid plan', () => {
    expect(() => schedulePlan({ tasks: [task('a', ['b']), task('b', ['a'])] })).toThrow(
      /dependency cycle/,
    );
  });
});
