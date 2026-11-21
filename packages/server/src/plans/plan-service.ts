import {
  Plan,
  READ_ONLY_TOOLS,
  describeConflict,
  describeIssue,
  ownershipWarnings,
  planJsonSchema,
  reassignPlanTask,
  removePlanTask,
  schedulePlan,
  taskPromptWithAnswers,
  unansweredDecisions,
  validatePlan,
  type AgentEvent,
  type DecisionAnswers,
  type PlanDecision,
  type PlanIssue,
} from '@squadboard/core';
import type { Db } from '../db/index.js';
import {
  answerDecision,
  createRequest,
  getProject,
  getRequest,
  insertDecision,
  listPlanRequests,
  listRequestTasks,
  updateRequest,
  type PlanStep,
  type ProjectRow,
  type RequestRow,
  type RequestStatus,
} from '../db/repository.js';
import type { Runner } from '../runner/runner.js';
import { ServiceError } from '../service-error.js';
import type { TaskService } from '../tasks/task-service.js';
import type { AgentView, TeamView } from '../team/team-service.js';
import { plannerPrompt, retryPrompt } from './planner-prompt.js';
import type { Scheduler } from './scheduler.js';

/** Id of the agent that plans; the templates ship it as `planner`. */
export const PLANNER_ID = 'planner';
export const MAX_REQUEST_LENGTH = 4000;
/** One retry when the answer does not match the plan schema, then a clear error. */
const MAX_ATTEMPTS = 2;

export const PLANNING_INTERRUPTED =
  'Squadboard kapandığı için planlama yarıda kesildi. İsteği yeniden planlat.';

export interface PlanTaskView {
  id: string;
  title: string;
  agent: string;
  prompt: string;
  /** As planned (and edited). */
  dependsOn: string[];
  /** What it really waits for: dependsOn plus the order added for shared files. */
  runsAfter: string[];
  expectedFiles: string[];
  stage: number;
  /** expectedFiles outside the agent's `owns`. */
  outsideOwns: string[];
  /** The agent is switched off or cannot write files any more. */
  agentUnavailable: boolean;
}

export interface PlanContent {
  tasks: PlanTaskView[];
  openDecisions: PlanDecision[];
  stages: string[][];
  /** Why tasks were put in order ("aynı dosyalara dokunduğu için…"). */
  notes: string[];
  /** Tasks writing outside their agent's area, closed agents. */
  warnings: string[];
  summary: {
    agents: number;
    /** expectedFiles entries (paths or patterns) of all tasks. */
    files: number;
    /** Sum of the agents' per-run budgets: an upper bound, not an estimate. */
    maxCostUsd: number;
  };
  /** Agents a task may be given to now (open and able to write). */
  assignableAgents: string[];
}

export interface PlanView {
  id: string;
  projectId: string;
  text: string;
  status: RequestStatus;
  error: string | null;
  errorDetail: string | null;
  steps: PlanStep[];
  plannerCostUsd: number | null;
  createdAt: string;
  approvedAt: string | null;
  /** The team's requirePlanApproval setting right now. */
  requirePlanApproval: boolean;
  plan: PlanContent | null;
  /** Tasks created on approval, with how far they got. */
  progress: { total: number; finished: number; failed: number; interrupted: number } | null;
}

export type PlanEdit = { removeTask: string } | { taskId: string; agent: string };

interface PlannerSetup {
  team: TeamView;
  planner: AgentView;
  workers: AgentView[];
}

/** Agents that can take plan tasks: switched on, not the Planner, and able to change files. */
export function workerAgents(team: TeamView): AgentView[] {
  return team.agents.filter((a) => a.enabled && a.id !== PLANNER_ID && !a.readOnly);
}

const now = () => new Date().toISOString();

/**
 * Turns a request into an approved plan of tasks: runs the team's Planner read-only with
 * `--json-schema`, validates the answer (one retry), serialises tasks that touch the same files,
 * lets the user answer the Planner's open decisions and edit the plan, then creates the tasks
 * and hands them to the Scheduler.
 */
export class PlanService {
  private readonly planning = new Map<string, { stop: () => Promise<void>; cancelled: boolean }>();
  private readonly pending = new Set<Promise<unknown>>();
  private closing = false;

  constructor(
    private readonly db: Db,
    private readonly runner: Runner,
    private readonly tasks: TaskService,
    private readonly scheduler: Scheduler,
  ) {}

  // ---------- planning ----------

  startPlanning(projectId: string, text: string): RequestRow {
    const project = this.mustProject(projectId);
    const request = text.trim();
    if (!request) throw new ServiceError(400, 'Ne yapılacağını yaz.');
    if (request.length > MAX_REQUEST_LENGTH) {
      throw new ServiceError(400, `İstek en fazla ${MAX_REQUEST_LENGTH} karakter olabilir.`);
    }
    const setup = this.plannerSetup(project);
    if (listPlanRequests(this.db, projectId).some((r) => r.status === 'planning')) {
      throw new ServiceError(409, 'Bu projede zaten bir plan hazırlanıyor. Bitmesini bekle.');
    }

    const names = setup.workers.map((a) => a.names.tech).join(', ');
    const row = createRequest(this.db, { projectId, text: request, status: 'planning' });
    const created = updateRequest(this.db, row.id, {
      steps: [
        {
          id: 'team',
          label: 'Ekip okundu',
          detail: `${setup.workers.length} açık ajan: ${names}`,
          status: 'done',
          startedAt: row.createdAt,
          endedAt: now(),
        },
      ],
    });
    this.tasks.hub.notify(projectId);
    const job = this.runPlanner(project, created, setup).catch((err: unknown) => {
      this.fail(created.id, 'Planlama beklenmedik bir hatayla durdu.', (err as Error).message);
    });
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
    return created;
  }

  /** Stops a running Planner, or drops a plan waiting for approval. */
  async cancel(requestId: string): Promise<PlanView> {
    const request = this.mustRequest(requestId);
    if (request.status === 'planning') {
      const job = this.planning.get(requestId);
      updateRequest(this.db, requestId, { status: 'cancelled' });
      if (job) {
        job.cancelled = true;
        await job.stop();
      }
    } else if (request.status === 'awaiting_approval' || request.status === 'failed') {
      updateRequest(this.db, requestId, { status: 'cancelled' });
    } else {
      throw new ServiceError(409, 'Bu plan artık iptal edilemez.');
    }
    this.tasks.hub.notify(request.projectId);
    return this.view(requestId);
  }

  /** Before closing the database: mark planning as interrupted and wait for the jobs. */
  async shutdown(): Promise<void> {
    this.closing = true;
    await Promise.all([...this.planning.values()].map((job) => job.stop()));
    await Promise.allSettled([...this.pending]);
  }

  private async runPlanner(
    project: ProjectRow,
    request: RequestRow,
    setup: PlannerSetup,
  ): Promise<void> {
    const workerIds = setup.workers.map((a) => a.id);
    const tools = (setup.planner.tools ?? READ_ONLY_TOOLS).filter((t) =>
      READ_ONLY_TOOLS.includes(t),
    );
    const basePrompt = plannerPrompt(request.text, setup.workers);
    let feedback = '';
    let cost = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const exploreId = `explore-${attempt}`;
      this.addStep(request.id, {
        id: exploreId,
        label: attempt === 1 ? 'Proje dosyaları inceleniyor' : 'Planlayıcı yeniden deniyor',
        detail: null,
        status: 'running',
        startedAt: now(),
        endedAt: null,
      });

      let looked = 0;
      const handle = this.runner.runOnce({
        prompt: basePrompt + feedback,
        cwd: project.path,
        // Read-only, really: --tools removes every other tool, the Planner cannot write.
        tools,
        allowedTools: tools,
        permissionMode: 'default',
        systemPrompt: setup.planner.prompt,
        maxBudgetUsd: setup.planner.budgetUsd,
        ...(setup.planner.model ? { model: setup.planner.model } : {}),
        jsonSchema: planJsonSchema(workerIds),
        onEvent: (event: AgentEvent) => {
          if (event.kind !== 'tool_use' || event.name === 'StructuredOutput') return;
          looked++;
          this.updateStep(request.id, exploreId, {
            detail: `${looked} bakış · son: ${event.name} ${toolTarget(event.input)}`.trim(),
          });
        },
      });
      const job = { stop: handle.stop, cancelled: false };
      this.planning.set(request.id, job);
      const outcome = await handle.done;
      this.planning.delete(request.id);
      cost += outcome.result?.costUsd ?? 0;
      updateRequest(this.db, request.id, { plannerCostUsd: cost || null });

      if (outcome.status === 'stopped') {
        this.updateStep(request.id, exploreId, { status: 'failed', endedAt: now() });
        if (job.cancelled) {
          updateRequest(this.db, request.id, { status: 'cancelled' });
          this.tasks.hub.notify(project.id);
        } else {
          this.fail(request.id, this.closing ? PLANNING_INTERRUPTED : 'Planlama durduruldu.');
        }
        return;
      }
      if (outcome.status === 'failed') {
        this.updateStep(request.id, exploreId, { status: 'failed', endedAt: now() });
        this.fail(
          request.id,
          'Planlayıcı çalışırken hata verdi. Ayrıntıya bak, sonra yeniden dene.',
          outcome.error,
        );
        return;
      }
      this.updateStep(request.id, exploreId, { status: 'done', endedAt: now() });

      const answer = outcome.result?.structuredOutput;
      const checked =
        answer === undefined
          ? ({ ok: false, issues: 'yapılandırılmış çıktı (structured_output) yok' } as const)
          : validatePlan(answer, { agents: workerIds });
      if (!checked.ok) {
        const problem =
          typeof checked.issues === 'string'
            ? checked.issues
            : checked.issues.map(describeIssue).join('; ');
        const last = attempt === MAX_ATTEMPTS;
        this.addStep(request.id, {
          id: `validate-${attempt}`,
          label: last ? 'Plan yine geçersiz' : 'Plan şemaya uymadı, bir kez daha deneniyor',
          detail: problem,
          status: 'failed',
          startedAt: now(),
          endedAt: now(),
        });
        if (last) {
          this.fail(
            request.id,
            'Planlayıcı iki denemede de geçerli bir plan üretemedi. İsteği biraz daha açık yazıp yeniden dene.',
            problem,
          );
          return;
        }
        feedback = retryPrompt(checked.issues as readonly PlanIssue[] | string);
        continue;
      }

      const plan = checked.plan;
      this.addStep(request.id, {
        id: 'validate',
        label: 'Plan kontrol edildi',
        detail: `${plan.tasks.length} iş, ${plan.openDecisions.length} soru`,
        status: 'done',
        startedAt: now(),
        endedAt: now(),
      });
      const scheduled = schedulePlan(plan);
      this.addStep(request.id, {
        id: 'conflicts',
        label: 'Çakışma kontrolü',
        detail: scheduled.conflicts.length
          ? `${scheduled.conflicts.length} iş aynı dosyalar yüzünden sıraya dizildi`
          : 'Aynı dosyaya aynı anda yazan iş yok',
        status: 'done',
        startedAt: now(),
        endedAt: now(),
      });
      updateRequest(this.db, request.id, { plan, status: 'awaiting_approval' });
      this.tasks.hub.notify(project.id);

      // Without plan approval the plan starts at once, unless the user still has to decide.
      if (!setup.team.settings.requirePlanApproval && plan.openDecisions.length === 0) {
        this.approve(request.id, {});
      }
      return;
    }
  }

  // ---------- approval ----------

  edit(requestId: string, edit: PlanEdit): PlanView {
    const request = this.mustRequest(requestId);
    if (request.status !== 'awaiting_approval') {
      throw new ServiceError(409, 'Yalnızca onay bekleyen bir plan düzenlenebilir.');
    }
    const plan = Plan.parse(request.plan);
    let next: Plan;
    if ('removeTask' in edit) {
      if (!plan.tasks.some((t) => t.id === edit.removeTask)) {
        throw new ServiceError(404, 'Planda böyle bir iş yok.');
      }
      if (plan.tasks.length === 1) throw new ServiceError(400, 'Planda en az bir iş kalmalı.');
      next = removePlanTask(plan, edit.removeTask);
    } else {
      if (!plan.tasks.some((t) => t.id === edit.taskId)) {
        throw new ServiceError(404, 'Planda böyle bir iş yok.');
      }
      const project = this.mustProject(request.projectId);
      const workers = workerAgents(this.plannerSetup(project).team);
      if (!workers.some((a) => a.id === edit.agent)) {
        throw new ServiceError(400, 'Bu ajan kapalı ya da dosya yazamıyor; başka bir ajan seç.');
      }
      next = reassignPlanTask(plan, edit.taskId, edit.agent);
    }
    updateRequest(this.db, requestId, { plan: next });
    this.tasks.hub.notify(request.projectId);
    return this.view(requestId);
  }

  /**
   * Creates the plan's tasks (dependencies include the order added for shared files) with the
   * user's answers in their prompts, records the answers and lets the Scheduler start them.
   */
  approve(requestId: string, answers: DecisionAnswers): PlanView {
    const request = this.mustRequest(requestId);
    if (request.status !== 'awaiting_approval') {
      throw new ServiceError(409, 'Bu plan onay beklemiyor.');
    }
    const project = this.mustProject(request.projectId);
    const plan = Plan.parse(request.plan);
    const missing = unansweredDecisions(plan.openDecisions, answers);
    if (missing.length > 0) {
      throw new ServiceError(400, `Önce şu soruyu cevapla: ${missing[0]?.question ?? ''}`);
    }
    const workers = workerAgents(this.plannerSetup(project).team);
    const closed = plan.tasks.find((t) => !workers.some((a) => a.id === t.agent));
    if (closed) {
      throw new ServiceError(
        409,
        `“${closed.title}” işinin ajanı (${closed.agent}) kapalı. Ajanı değiştir ya da işi kaldır.`,
      );
    }

    const scheduled = schedulePlan(plan);
    const stageOf = new Map(scheduled.stages.flatMap((ids, i) => ids.map((id) => [id, i])));
    this.tasks.createPlannedTasks(
      request.id,
      scheduled.plan.tasks.map((t) => ({
        key: t.id,
        title: t.title,
        prompt: taskPromptWithAnswers(t, plan.openDecisions, answers),
        agent: t.agent,
        dependsOn: t.dependsOn,
        expectedFiles: t.expectedFiles,
        stage: stageOf.get(t.id) ?? 0,
      })),
    );
    for (const decision of plan.openDecisions) {
      const row = insertDecision(this.db, {
        requestId: request.id,
        taskId: null,
        source: 'planner',
        question: decision.question,
        options: decision.options,
      });
      answerDecision(this.db, row.id, (answers[decision.id] ?? '').trim());
    }
    updateRequest(this.db, request.id, { status: 'running', approvedAt: now() });
    this.tasks.hub.notify(project.id);
    void this.scheduler.kick(project.id);
    return this.view(requestId);
  }

  /** "Devam et" after an interruption: the Scheduler picks the plan up again. */
  resume(requestId: string): PlanView {
    const request = this.mustRequest(requestId);
    if (request.status !== 'interrupted') {
      throw new ServiceError(409, 'Bu plan durmuş değil.');
    }
    updateRequest(this.db, requestId, { status: 'running' });
    this.tasks.hub.notify(request.projectId);
    void this.scheduler.kick(request.projectId);
    return this.view(requestId);
  }

  // ---------- views ----------

  list(projectId: string): PlanView[] {
    this.mustProject(projectId);
    return listPlanRequests(this.db, projectId).map((r) => this.toView(r));
  }

  view(requestId: string): PlanView {
    return this.toView(this.mustRequest(requestId));
  }

  private toView(request: RequestRow): PlanView {
    const project = getProject(this.db, request.projectId);
    const team = project ? this.tasks.team.read(project.path) : { status: 'missing' as const };
    const teamView = team.status === 'ok' ? team.team : null;
    const created = listRequestTasks(this.db, request.id);
    return {
      id: request.id,
      projectId: request.projectId,
      text: request.text,
      status: request.status ?? 'running',
      error: request.error,
      errorDetail: request.errorDetail,
      steps: request.steps,
      plannerCostUsd: request.plannerCostUsd,
      createdAt: request.createdAt,
      approvedAt: request.approvedAt,
      requirePlanApproval: teamView?.settings.requirePlanApproval ?? true,
      plan: request.plan ? planContent(Plan.parse(request.plan), teamView) : null,
      progress:
        created.length === 0
          ? null
          : {
              total: created.length,
              finished: created.filter((t) => t.status === 'in_review' || t.status === 'done')
                .length,
              failed: created.filter((t) => t.status === 'failed').length,
              interrupted: created.filter((t) => t.status === 'stopped').length,
            },
    };
  }

  // ---------- internals ----------

  private plannerSetup(project: ProjectRow): PlannerSetup {
    const state = this.tasks.team.read(project.path);
    if (state.status === 'missing') {
      throw new ServiceError(409, 'Planlamak için önce bu projede ekibini kur.');
    }
    if (state.status === 'invalid') {
      throw new ServiceError(409, `Ekip dosyaları okunamadı: ${state.error}`);
    }
    const planner = state.team.agents.find((a) => a.id === PLANNER_ID);
    if (!planner) {
      throw new ServiceError(409, 'Ekipte Planlayıcı yok (planner). Ekip sayfasından ekle.');
    }
    if (!planner.enabled) {
      throw new ServiceError(409, 'Planlayıcı ekipte kapalı. Ekip sayfasından açıp tekrar dene.');
    }
    const workers = workerAgents(state.team);
    if (workers.length === 0) {
      throw new ServiceError(
        409,
        'Ekipte iş alabilecek açık bir ajan yok. Ekip sayfasından en az bir ajan aç.',
      );
    }
    return { team: state.team, planner, workers };
  }

  private mustProject(projectId: string): ProjectRow {
    const project = getProject(this.db, projectId);
    if (!project) throw new ServiceError(404, 'Proje bulunamadı');
    return project;
  }

  private mustRequest(requestId: string): RequestRow {
    const request = getRequest(this.db, requestId);
    if (!request?.status) throw new ServiceError(404, 'Plan bulunamadı');
    return request;
  }

  private fail(requestId: string, error: string, detail: string | null = null): void {
    const request = getRequest(this.db, requestId);
    if (!request) return;
    updateRequest(this.db, requestId, { status: 'failed', error, errorDetail: detail });
    this.tasks.hub.notify(request.projectId);
  }

  private addStep(requestId: string, step: PlanStep): void {
    const request = getRequest(this.db, requestId);
    if (!request) return;
    updateRequest(this.db, requestId, { steps: [...request.steps, step] });
    this.tasks.hub.notify(request.projectId);
  }

  private updateStep(requestId: string, stepId: string, patch: Partial<PlanStep>): void {
    const request = getRequest(this.db, requestId);
    if (!request) return;
    updateRequest(this.db, requestId, {
      steps: request.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    });
    this.tasks.hub.notify(request.projectId);
  }
}

/** Stages, conflict notes, ownership warnings and the summary for the approval screen. */
export function planContent(plan: Plan, team: TeamView | null): PlanContent {
  const workers = team ? workerAgents(team) : [];
  const scheduled = schedulePlan(plan);
  const stageOf = new Map(scheduled.stages.flatMap((ids, i) => ids.map((id) => [id, i])));
  const titleOf = (id: string) => plan.tasks.find((t) => t.id === id)?.title ?? id;
  const outside = ownershipWarnings(plan.tasks, workers);
  const available = (agent: string) => !team || workers.some((a) => a.id === agent);

  const warnings = [
    ...outside.map((w) => {
      const agent = team?.agents.find((a) => a.id === w.agent)?.names.tech ?? w.agent;
      return `“${titleOf(w.taskId)}” ${agent} ajanının alanı dışına yazacak: ${w.files.join(', ')}`;
    }),
    ...plan.tasks
      .filter((t) => !available(t.agent))
      .map((t) => `“${t.title}” işinin ajanı (${t.agent}) kapalı ya da dosya yazamıyor.`),
  ];
  const budgetOf = (agent: string) => team?.agents.find((a) => a.id === agent)?.budgetUsd ?? 1;

  return {
    tasks: scheduled.plan.tasks.map((t) => {
      const original = plan.tasks.find((p) => p.id === t.id);
      return {
        id: t.id,
        title: t.title,
        agent: t.agent,
        prompt: t.prompt,
        dependsOn: original?.dependsOn ?? t.dependsOn,
        runsAfter: t.dependsOn,
        expectedFiles: t.expectedFiles,
        stage: stageOf.get(t.id) ?? 0,
        outsideOwns: outside.find((w) => w.taskId === t.id)?.files ?? [],
        agentUnavailable: !available(t.agent),
      };
    }),
    openDecisions: plan.openDecisions,
    stages: scheduled.stages,
    notes: scheduled.conflicts.map((c) => describeConflict(c, titleOf)),
    warnings,
    summary: {
      agents: new Set(plan.tasks.map((t) => t.agent)).size,
      files: new Set(plan.tasks.flatMap((t) => t.expectedFiles)).size,
      maxCostUsd: Math.round(plan.tasks.reduce((sum, t) => sum + budgetOf(t.agent), 0) * 100) / 100,
    },
    assignableAgents: workers.map((a) => a.id),
  };
}

/** "src/app.ts", "**\/*.tsx": what a read-only tool call looked at, for the progress line. */
function toolTarget(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  const value = record.file_path ?? record.pattern ?? record.path;
  if (typeof value !== 'string') return '';
  const short = value.replace(/\\/g, '/');
  return short.length > 60 ? `…${short.slice(-59)}` : short;
}
