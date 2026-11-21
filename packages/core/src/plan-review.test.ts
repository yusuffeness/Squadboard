import { describe, expect, it } from 'vitest';
import { schedulePlan, validatePlan } from './plan.js';
import {
  describeConflict,
  ownershipWarnings,
  patternCovered,
  planJsonSchema,
  reassignPlanTask,
  removePlanTask,
  taskPromptWithAnswers,
  unansweredDecisions,
} from './plan-review.js';
import { Plan, type PlanInput } from './schemas.js';

const t = (id: string, agent: string, dependsOn: string[] = [], expectedFiles: string[] = []) => ({
  id,
  title: `T ${id}`,
  agent,
  dependsOn,
  expectedFiles,
  prompt: `do ${id}`,
});

describe('planJsonSchema', () => {
  it('limits agents to the given ids and requires a prompt per task', () => {
    const schema = planJsonSchema(['frontend', 'backend']) as {
      required: string[];
      properties: {
        tasks: { items: { required: string[]; properties: { agent: { enum: string[] } } } };
      };
    };
    expect(schema.required).toEqual(['tasks', 'openDecisions']);
    expect(schema.properties.tasks.items.properties.agent.enum).toEqual(['frontend', 'backend']);
    expect(schema.properties.tasks.items.required).toContain('prompt');
  });
});

describe('ownership', () => {
  it('decides whether an expected file lies inside an owned area', () => {
    expect(patternCovered('src/api/auth.ts', 'src/api/**')).toBe(true);
    expect(patternCovered('src/api/*', 'src/api/**')).toBe(true);
    expect(patternCovered('src/api/**', 'src/api/**')).toBe(true);
    expect(patternCovered('src/pages/login.tsx', 'src/api/**')).toBe(false);
    expect(patternCovered('src/**', 'src/api/**')).toBe(false);
    expect(patternCovered('anything/x.ts', '**')).toBe(true);
    expect(patternCovered('tests/a.test.ts', '**/*.test.*')).toBe(true);
    // A glob against a non-directory glob: unsure, so not covered.
    expect(patternCovered('src/*.test.ts', '**/*.test.*')).toBe(false);
  });

  it('warns about tasks writing outside their agent’s owns, skips agents without owns', () => {
    const warnings = ownershipWarnings(
      [
        t('api', 'backend', [], ['src/api/auth.ts', 'src/pages/x.tsx']),
        t('ui', 'frontend', [], ['src/pages/login.tsx']),
        t('misc', 'general', [], ['anywhere.md']),
      ],
      [
        { id: 'backend', owns: ['src/api/**'] },
        { id: 'frontend', owns: ['src/pages/**'] },
        { id: 'general', owns: [] },
      ],
    );
    expect(warnings).toEqual([{ taskId: 'api', agent: 'backend', files: ['src/pages/x.tsx'] }]);
  });
});

describe('plan edits', () => {
  const plan = Plan.parse({
    tasks: [t('db', 'database'), t('api', 'backend', ['db']), t('ui', 'frontend', ['api'])],
    openDecisions: [
      { id: 'orm', question: 'ORM?', options: ['a', 'b'], taskIds: ['db'] },
      { id: 'style', question: 'Stil?', options: ['a', 'b'], taskIds: [] },
      { id: 'auth', question: 'Auth?', options: ['a', 'b'], taskIds: ['db', 'api'] },
    ],
  } satisfies PlanInput);

  it('removing a task keeps the order around it and drops decisions only about it', () => {
    const next = removePlanTask(plan, 'api');
    expect(next.tasks.map((x) => [x.id, x.dependsOn])).toEqual([
      ['db', []],
      ['ui', ['db']],
    ]);
    expect(validatePlan(next).ok).toBe(true);
    const withoutDb = removePlanTask(plan, 'db');
    expect(withoutDb.openDecisions.map((d) => [d.id, d.taskIds])).toEqual([
      ['style', []],
      ['auth', ['api']],
    ]);
  });

  it('reassigns a task to another agent', () => {
    expect(reassignPlanTask(plan, 'ui', 'backend').tasks[2]?.agent).toBe('backend');
  });

  it('adds the answers that concern a task to its prompt', () => {
    const answers = { orm: 'Drizzle', style: 'Sade', auth: '' };
    expect(unansweredDecisions(plan.openDecisions, answers).map((d) => d.id)).toEqual(['auth']);
    const db = plan.tasks[0];
    const ui = plan.tasks[2];
    if (!db || !ui) throw new Error('missing');
    const dbPrompt = taskPromptWithAnswers(db, plan.openDecisions, answers);
    expect(dbPrompt).toContain('do db');
    expect(dbPrompt).toContain('ORM? → Drizzle');
    expect(dbPrompt).toContain('Stil? → Sade');
    expect(dbPrompt).not.toContain('Auth?');
    expect(taskPromptWithAnswers(ui, plan.openDecisions, answers)).not.toContain('ORM?');
  });
});

it('describes a serialised conflict in Turkish', () => {
  const scheduled = schedulePlan({
    tasks: [t('a', 'backend', [], ['src/x.ts']), t('b', 'frontend', [], ['src/x.ts'])],
  });
  const conflict = scheduled.conflicts[0];
  if (!conflict) throw new Error('expected a conflict');
  expect(describeConflict(conflict, (id) => id.toUpperCase())).toBe(
    '“B”, “A” ile aynı dosyalara dokunduğu için ondan sonra çalışacak (src/x.ts).',
  );
});
