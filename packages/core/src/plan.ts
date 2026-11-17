import { Plan, type PlanInput, type PlanTask } from './schemas.js';

/**
 * Plan validation and scheduling (docs/ARCHITECTURE.md → "Plan akışı, bağımlılık ve çakışma yönetimi").
 *
 * - validatePlan: shape (Zod), unique ids, known dependencies/agents, no cycles.
 * - computeStages: topological layering; tasks in one stage may run in parallel.
 * - schedulePlan: also serialises same-stage tasks whose expectedFiles overlap.
 */

export type PlanIssue =
  | { code: 'schema'; message: string; path: string }
  | { code: 'duplicate_task_id'; taskId: string }
  | { code: 'unknown_dependency'; taskId: string; dependsOn: string }
  | { code: 'self_dependency'; taskId: string }
  | { code: 'unknown_agent'; taskId: string; agent: string }
  | { code: 'cycle'; cycle: string[] }
  | { code: 'duplicate_decision_id'; decisionId: string }
  | { code: 'unknown_decision_task'; decisionId: string; taskId: string };

export type PlanValidation = { ok: true; plan: Plan } | { ok: false; issues: PlanIssue[] };

export class PlanValidationError extends Error {
  constructor(readonly issues: PlanIssue[]) {
    super(`Invalid plan: ${issues.map(describeIssue).join('; ')}`);
    this.name = 'PlanValidationError';
  }
}

export function describeIssue(issue: PlanIssue): string {
  switch (issue.code) {
    case 'schema':
      return `${issue.path || 'plan'}: ${issue.message}`;
    case 'duplicate_task_id':
      return `duplicate task id "${issue.taskId}"`;
    case 'unknown_dependency':
      return `task "${issue.taskId}" depends on unknown task "${issue.dependsOn}"`;
    case 'self_dependency':
      return `task "${issue.taskId}" depends on itself`;
    case 'unknown_agent':
      return `task "${issue.taskId}" uses unknown agent "${issue.agent}"`;
    case 'cycle':
      return `dependency cycle: ${issue.cycle.join(' → ')}`;
    case 'duplicate_decision_id':
      return `duplicate decision id "${issue.decisionId}"`;
    case 'unknown_decision_task':
      return `decision "${issue.decisionId}" refers to unknown task "${issue.taskId}"`;
  }
}

export interface ValidatePlanOptions {
  /** Agent ids available in the team. When given, every task's agent must be one of them. */
  agents?: readonly string[];
}

export function validatePlan(input: unknown, options: ValidatePlanOptions = {}): PlanValidation {
  const parsed = Plan.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: 'schema' as const,
        message: i.message,
        path: i.path.join('.'),
      })),
    };
  }
  const plan = parsed.data;
  const issues: PlanIssue[] = [];
  const ids = new Set<string>();

  for (const task of plan.tasks) {
    if (ids.has(task.id)) issues.push({ code: 'duplicate_task_id', taskId: task.id });
    ids.add(task.id);
  }
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (dep === task.id) issues.push({ code: 'self_dependency', taskId: task.id });
      else if (!ids.has(dep))
        issues.push({ code: 'unknown_dependency', taskId: task.id, dependsOn: dep });
    }
    if (options.agents && !options.agents.includes(task.agent)) {
      issues.push({ code: 'unknown_agent', taskId: task.id, agent: task.agent });
    }
  }

  const decisionIds = new Set<string>();
  for (const decision of plan.openDecisions) {
    if (decisionIds.has(decision.id))
      issues.push({ code: 'duplicate_decision_id', decisionId: decision.id });
    decisionIds.add(decision.id);
    for (const taskId of decision.taskIds) {
      if (!ids.has(taskId))
        issues.push({ code: 'unknown_decision_task', decisionId: decision.id, taskId });
    }
  }

  // Cycle check only makes sense on a graph with valid edges.
  if (issues.length === 0) {
    const cycle = findCycle(plan.tasks);
    if (cycle) issues.push({ code: 'cycle', cycle });
  }

  return issues.length ? { ok: false, issues } : { ok: true, plan };
}

export function assertValidPlan(input: unknown, options: ValidatePlanOptions = {}): Plan {
  const result = validatePlan(input, options);
  if (!result.ok) throw new PlanValidationError(result.issues);
  return result.plan;
}

/** Returns one dependency cycle as a closed path (`a → b → a`), or null. */
export function findCycle(tasks: readonly Pick<PlanTask, 'id' | 'dependsOn'>[]): string[] | null {
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 'done') return null;
    if (s === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const t of tasks) {
    const cycle = visit(t.id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Topological layering: stage 0 has no dependencies, stage n depends only on earlier stages.
 * Within a stage, tasks keep their plan order. Throws if the graph has a cycle.
 */
export function computeStages(tasks: readonly Pick<PlanTask, 'id' | 'dependsOn'>[]): string[][] {
  const known = new Set(tasks.map((t) => t.id));
  const stageOf = new Map<string, number>();
  let remaining = [...tasks];
  const stages: string[][] = [];

  while (remaining.length > 0) {
    const ready = remaining.filter((t) =>
      t.dependsOn.every((d) => !known.has(d) || stageOf.has(d)),
    );
    if (ready.length === 0) {
      const cycle = findCycle(remaining) ?? remaining.map((t) => t.id);
      throw new PlanValidationError([{ code: 'cycle', cycle }]);
    }
    const index = stages.length;
    for (const t of ready) stageOf.set(t.id, index);
    stages.push(ready.map((t) => t.id));
    remaining = remaining.filter((t) => !stageOf.has(t.id));
  }
  return stages;
}

// ---------- file conflicts ----------

export interface FileConflict {
  /** Runs first (earlier in the plan). */
  first: string;
  /** Was made to depend on `first`. */
  then: string;
  /** Overlapping expectedFiles patterns as `[fromFirst, fromThen]` pairs. */
  files: [string, string][];
}

export interface ScheduledPlan {
  /** Plan with extra dependencies added to serialise conflicting tasks. */
  plan: Plan;
  stages: string[][];
  /** One entry per added dependency; shown as a warning on the plan screen. */
  conflicts: FileConflict[];
}

/**
 * Validates the plan, then repeatedly: compute stages, and for two tasks in the same stage whose
 * expectedFiles overlap, make the later one (plan order) depend on the earlier one.
 *
 * Adding such an edge can never create a cycle: two tasks in the same stage have no path between
 * them (a path would put them in different stages).
 */
export function schedulePlan(input: PlanInput, options: ValidatePlanOptions = {}): ScheduledPlan {
  const plan = assertValidPlan(input, options);
  const tasks = plan.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] }));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const conflicts: FileConflict[] = [];

  for (;;) {
    const stages = computeStages(tasks);
    const conflict = firstConflict(stages, byId);
    if (!conflict) return { plan: { ...plan, tasks }, stages, conflicts };
    // Chain behind the last task already queued after `first` with overlapping files, so three
    // tasks touching one file become a → b → c instead of also adding a redundant a → c.
    const anchor = lastConflictingSuccessor(conflict, conflicts, byId);
    let added: FileConflict =
      anchor === conflict.first
        ? conflict
        : {
            first: anchor,
            then: conflict.then,
            files: overlappingFiles(
              byId.get(anchor)?.expectedFiles ?? [],
              byId.get(conflict.then)?.expectedFiles ?? [],
            ),
          };
    const deps = byId.get(conflict.then)?.dependsOn;
    if (!deps) throw new Error(`Unknown task ${conflict.then}`);
    deps.push(added.first);
    if (added !== conflict && findCycle(tasks)) {
      // Fall back to the direct edge, which is always safe (see above).
      deps.pop();
      deps.push(conflict.first);
      added = conflict;
    }
    conflicts.push(added);
  }
}

function lastConflictingSuccessor(
  conflict: FileConflict,
  previous: readonly FileConflict[],
  byId: Map<string, Pick<PlanTask, 'expectedFiles'>>,
): string {
  let anchor = conflict.first;
  for (;;) {
    const next = previous.find(
      (c) =>
        c.first === anchor &&
        c.then !== conflict.then &&
        overlappingFiles(
          byId.get(c.then)?.expectedFiles ?? [],
          byId.get(conflict.then)?.expectedFiles ?? [],
        ).length > 0,
    );
    if (!next) return anchor;
    anchor = next.then;
  }
}

function firstConflict(
  stages: string[][],
  byId: Map<string, Pick<PlanTask, 'expectedFiles'>>,
): FileConflict | null {
  for (const stage of stages) {
    for (let i = 0; i < stage.length; i++) {
      for (let j = i + 1; j < stage.length; j++) {
        const first = stage[i];
        const then = stage[j];
        if (first === undefined || then === undefined) continue;
        const files = overlappingFiles(
          byId.get(first)?.expectedFiles ?? [],
          byId.get(then)?.expectedFiles ?? [],
        );
        if (files.length) return { first, then, files };
      }
    }
  }
  return null;
}

export function overlappingFiles(a: readonly string[], b: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (const x of a) for (const y of b) if (patternsOverlap(x, y)) pairs.push([x, y]);
  return pairs;
}

/**
 * Whether two expectedFiles entries (paths or globs with `*`, `**`, `?`) may refer to the same file.
 * Conservative: when both are globs we compare their literal prefixes, so unsure cases count as
 * overlapping (serialising is safe; running in parallel is not).
 */
export function patternsOverlap(a: string, b: string): boolean {
  const pa = normalizePath(a);
  const pb = normalizePath(b);
  if (pa === pb) return true;
  const ga = isGlob(pa);
  const gb = isGlob(pb);
  if (!ga && !gb) return false;
  if (ga && !gb) return globToRegExp(pa).test(pb);
  if (!ga && gb) return globToRegExp(pb).test(pa);
  const prefixA = literalPrefix(pa);
  const prefixB = literalPrefix(pb);
  return prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA);
}

function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function isGlob(p: string): boolean {
  return /[*?]/.test(p);
}

function literalPrefix(glob: string): string {
  const i = glob.search(/[*?]/);
  return i === -1 ? glob : glob.slice(0, i);
}

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*') {
      if (glob.charAt(i + 1) === '*') {
        // `**/` matches zero or more directories; `**` at the end matches everything.
        if (glob.charAt(i + 2) === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}
