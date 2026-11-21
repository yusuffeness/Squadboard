import { globToRegExp, type FileConflict } from './plan.js';
import type { Plan, PlanDecision, PlanTask } from './schemas.js';

/**
 * Helpers around a Planner plan before it becomes tasks (docs/ARCHITECTURE.md → "Plan akışı,
 * bağımlılık ve çakışma yönetimi"): the JSON schema given to `--json-schema`, ownership warnings,
 * edits on the approval screen and the user's answers to `openDecisions`.
 */

/** What the Planner may assign work to: an open agent that can write files. */
export interface PlanAgent {
  id: string;
  /** Paths the agent is expected to touch (globs). Empty = no declared area. */
  owns: readonly string[];
}

/**
 * JSON schema for `claude -p --json-schema` (the CLI enforces it, notes §4). Agent ids are an
 * `enum`, so the Planner cannot pick an agent that is switched off or does not exist. The answer
 * is validated again with Zod (validatePlan) because the CLI's check is not ours.
 */
export function planJsonSchema(agentIds: readonly string[]): Record<string, unknown> {
  const idString = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['tasks', 'openDecisions'],
    properties: {
      tasks: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'agent', 'dependsOn', 'expectedFiles', 'prompt'],
          properties: {
            id: idString,
            title: { type: 'string', minLength: 1, maxLength: 120 },
            agent: { type: 'string', enum: [...agentIds] },
            dependsOn: { type: 'array', items: idString },
            expectedFiles: { type: 'array', items: { type: 'string', minLength: 1 } },
            prompt: { type: 'string', minLength: 1 },
          },
        },
      },
      openDecisions: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'question', 'options', 'taskIds'],
          properties: {
            id: idString,
            question: { type: 'string', minLength: 1 },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
              items: { type: 'string', minLength: 1 },
            },
            taskIds: { type: 'array', items: idString },
          },
        },
      },
    },
  };
}

// ---------- ownership ----------

function normalize(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

const isGlob = (p: string) => /[*?]/.test(p);

/**
 * Whether every file `pattern` can mean lies inside the area `owns` describes. A plain path is
 * tested against the glob. A glob is covered only when it is the same pattern, or when `owns` is
 * `<dir>/**` and the pattern stays under `<dir>/`. Unsure = not covered (a warning, not an error).
 */
export function patternCovered(pattern: string, owns: string): boolean {
  const p = normalize(pattern);
  const o = normalize(owns);
  if (p === o) return true;
  if (!isGlob(p)) return globToRegExp(o).test(p);
  if (o === '**') return true;
  if (!o.endsWith('/**') || isGlob(o.slice(0, -3))) return false;
  const dir = o.slice(0, -2);
  const literal = p.slice(0, p.search(/[*?]/));
  return literal.startsWith(dir);
}

export interface OwnershipWarning {
  taskId: string;
  agent: string;
  /** expectedFiles entries outside the agent's `owns`. */
  files: string[];
}

/** Tasks that will write outside their agent's `owns` (agents without `owns` are not checked). */
export function ownershipWarnings(
  tasks: readonly Pick<PlanTask, 'id' | 'agent' | 'expectedFiles'>[],
  agents: readonly PlanAgent[],
): OwnershipWarning[] {
  const warnings: OwnershipWarning[] = [];
  for (const task of tasks) {
    const owns = agents.find((a) => a.id === task.agent)?.owns ?? [];
    if (owns.length === 0) continue;
    const outside = task.expectedFiles.filter((f) => !owns.some((o) => patternCovered(f, o)));
    if (outside.length > 0) warnings.push({ taskId: task.id, agent: task.agent, files: outside });
  }
  return warnings;
}

// ---------- notes shown on the plan ----------

/** "“API” “Veri modeli” ile aynı dosyalara dokunduğu için ondan sonra çalışacak (src/db.ts)." */
export function describeConflict(
  conflict: FileConflict,
  titleOf: (taskId: string) => string,
): string {
  const files = [...new Set(conflict.files.flat())].slice(0, 3).join(', ');
  return `“${titleOf(conflict.then)}”, “${titleOf(conflict.first)}” ile aynı dosyalara dokunduğu için ondan sonra çalışacak (${files}).`;
}

// ---------- edits on the approval screen ----------

/**
 * Removes a task. Tasks that depended on it inherit its dependencies (so the order around it
 * stays), and decisions that only concerned it are dropped.
 */
export function removePlanTask(plan: Plan, taskId: string): Plan {
  const removed = plan.tasks.find((t) => t.id === taskId);
  if (!removed) return plan;
  const tasks = plan.tasks
    .filter((t) => t.id !== taskId)
    .map((t) =>
      t.dependsOn.includes(taskId)
        ? {
            ...t,
            dependsOn: [
              ...new Set([...t.dependsOn.filter((d) => d !== taskId), ...removed.dependsOn]),
            ],
          }
        : t,
    );
  const openDecisions = plan.openDecisions.flatMap((d) => {
    if (!d.taskIds.includes(taskId)) return [d];
    const taskIds = d.taskIds.filter((id) => id !== taskId);
    return taskIds.length === 0 ? [] : [{ ...d, taskIds }];
  });
  return { tasks, openDecisions };
}

export function reassignPlanTask(plan: Plan, taskId: string, agent: string): Plan {
  return { ...plan, tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, agent } : t)) };
}

// ---------- answers ----------

/** decision id → the option picked or the free text typed. */
export type DecisionAnswers = Record<string, string>;

/** Open decisions without a (non-blank) answer. */
export function unansweredDecisions(
  decisions: readonly PlanDecision[],
  answers: DecisionAnswers,
): PlanDecision[] {
  return decisions.filter((d) => !(answers[d.id] ?? '').trim());
}

/** Decisions that concern a task: listed for it, or for the whole plan (empty taskIds). */
export function decisionsFor(decisions: readonly PlanDecision[], taskId: string): PlanDecision[] {
  return decisions.filter((d) => d.taskIds.length === 0 || d.taskIds.includes(taskId));
}

/**
 * The agent's prompt: the Planner's instructions plus the user's answers to the decisions that
 * concern this task, so the agent does not guess them.
 */
export function taskPromptWithAnswers(
  task: Pick<PlanTask, 'id' | 'title' | 'prompt'>,
  decisions: readonly PlanDecision[],
  answers: DecisionAnswers,
): string {
  const base = task.prompt.trim() || task.title;
  const lines = decisionsFor(decisions, task.id)
    .map((d) => ({ d, answer: (answers[d.id] ?? '').trim() }))
    .filter(({ answer }) => answer !== '')
    .map(({ d, answer }) => `- ${d.question} → ${answer}`);
  if (lines.length === 0) return base;
  return `${base}\n\nKullanıcının bu iş için verdiği kararlar (bunlara uy, yeniden sorma):\n${lines.join('\n')}`;
}
