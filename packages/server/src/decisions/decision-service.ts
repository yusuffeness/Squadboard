import type { Db } from '../db/index.js';
import {
  answerDecision,
  answerPermissionRequest,
  getPermissionRequest,
  getProject,
  getTaskWithContext,
  latestResumableRun,
  listDecisions,
  listPermissionRequests,
  type DecisionRow,
  type PermissionRequestRow,
  type PermissionStatus,
} from '../db/repository.js';
import { ServiceError } from '../service-error.js';
import type { TaskService } from '../tasks/task-service.js';

/**
 * The fallback path of decisions (docs/ARCHITECTURE.md → "Karar alınması", "İzin istekleri"):
 * a running agent asked something or a tool call was denied, the task waits in
 * `waiting_decision`, and the user answers on the board.
 *
 * Everything waits in the database (no process is kept open), so a restart loses nothing.
 * Once every question and permission of the task is answered, the agent gets all of it in ONE
 * `--resume` message, from the worktree its session belongs to.
 *
 * A waiting task holds no process, so it does not count against the team's concurrency limit.
 * Answering resumes it at once, like a manual start; the scheduler then waits until the number
 * of running tasks is below the limit again before it starts new ones.
 */

/** After this many question rounds in one task the board warns that the agent keeps asking. */
export const MAX_QUIET_ROUNDS = 2;

/** Stored as the choice when the user leaves a question to the agent. */
export const DELEGATED = 'Karar ajana bırakıldı';

export type PermissionAction = Exclude<PermissionStatus, 'pending'>;

export interface QuestionView {
  id: string;
  question: string;
  options: string[];
  multiSelect: boolean;
  /** Set when the agent's question could not be read; `question` is then what it wrote. */
  problem: string | null;
}

export interface PermissionView {
  id: string;
  tool: string;
  command: string | null;
  path: string | null;
  /** The rule "Hep izin ver" writes to `.team/team.json`. */
  rule: string;
}

export interface PendingView {
  questions: QuestionView[];
  permissions: PermissionView[];
  /** How many times the agent of this task has asked so far (1 = first time). */
  round: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function permissionView(row: PermissionRequestRow): PermissionView {
  return {
    id: row.id,
    tool: row.tool,
    command: row.tool === 'Bash' ? str(row.input.command) : null,
    path: str(row.input.file_path) ?? str(row.input.path),
    rule: row.rule,
  };
}

const agentQuestions = (db: Db, taskId: string) =>
  listDecisions(db, taskId).filter((d) => d.source === 'agent');

/** What a task waits for, for the API. Empty lists for any other task. */
export function pendingFor(db: Db, taskId: string): PendingView {
  const questions = agentQuestions(db, taskId);
  const rounds = new Set(questions.map((d) => d.runId ?? d.id));
  return {
    questions: questions
      .filter((d) => d.choice === null)
      .map((d) => ({
        id: d.id,
        question: d.question,
        options: d.options,
        multiSelect: d.multiSelect,
        problem: d.problem,
      })),
    permissions: listPermissionRequests(db, taskId)
      .filter((p) => p.status === 'pending')
      .map(permissionView),
    round: rounds.size,
  };
}

/** The message that resumes the agent after the user answered. Turkish, like the agent prompts. */
export function resumeMessage(input: {
  questions: readonly Pick<DecisionRow, 'question' | 'choice' | 'problem'>[];
  permissions: readonly Pick<PermissionRequestRow, 'tool' | 'input' | 'rule' | 'status'>[];
  note?: string | null;
}): string {
  const parts: string[] = [];
  const asked = input.questions.filter((q) => q.problem === null);
  if (asked.length > 0) {
    const lines = asked.map((q, i) =>
      q.choice === DELEGATED
        ? `${i + 1}. ${q.question} → Kararı sana bıraktı: makul olanı seç ve özetinde belirt.`
        : `${i + 1}. ${q.question} → ${q.choice ?? ''}`,
    );
    parts.push(
      `Kullanıcı sorularını cevapladı:\n${lines.join('\n')}\n\nBu cevaplarla göreve kaldığın yerden devam et; yaptığın bir şey bunlarla çelişiyorsa düzelt. Aynı soruları yeniden sorma.`,
    );
  }
  for (const q of input.questions.filter((q) => q.problem !== null)) {
    parts.push(
      `Sormak istediğin şey okunamadı (soru biçimi bozuktu). Kullanıcının cevabı: ${q.choice ?? ''}\nBu cevapla devam et. Yine bir şey sorman gerekirse AskUserQuestion aracını bir kez, bütün sorularla kullan.`,
    );
  }
  const what = (p: Pick<PermissionRequestRow, 'tool' | 'input' | 'rule'>) => {
    const command = p.tool === 'Bash' ? str(p.input.command) : null;
    return command ? `\`${command}\`` : p.rule;
  };
  const allowed = input.permissions.filter((p) => p.status !== 'denied');
  const denied = input.permissions.filter((p) => p.status === 'denied');
  if (allowed.length > 0) {
    parts.push(
      `İzin verildi, şimdi tekrar dene:\n${allowed.map((p) => `- ${what(p)}`).join('\n')}`,
    );
  }
  if (denied.length > 0) {
    parts.push(
      `Kullanıcı şunlara izin vermedi; bunları çalıştırmadan devam et, gerekiyorsa özetinde belirt:\n${denied.map((p) => `- ${what(p)}`).join('\n')}`,
    );
  }
  const note = input.note?.trim();
  if (note) parts.push(`Kullanıcının notu: ${note}`);
  if (parts.length === 0) parts.push('Göreve kaldığın yerden devam et.');
  return parts.join('\n\n');
}

export interface AnswerInput {
  /** decision id → choice (an option or free text; several options joined with ", "). */
  answers?: Record<string, string>;
  /** "Ajanın kararına bırak": every unanswered question goes back to the agent. */
  delegate?: boolean;
  /** Free text sent along (also the only content when nothing is pending). */
  note?: string;
}

export class DecisionService {
  constructor(
    private readonly db: Db,
    private readonly tasks: TaskService,
  ) {}

  /** Answers the agent's questions; resumes the task when nothing else is pending. */
  async answer(taskId: string, input: AnswerInput): Promise<void> {
    this.waitingTask(taskId);
    const pending = agentQuestions(this.db, taskId).filter((d) => d.choice === null);
    const answers = input.answers ?? {};
    const choices = pending.map((d) => {
      const choice = (answers[d.id] ?? '').trim();
      if (choice) return { d, choice };
      if (input.delegate && d.problem === null) return { d, choice: DELEGATED };
      return { d, choice: null };
    });
    const missing = choices.filter((c) => c.choice === null);
    if (missing.length > 0) {
      throw new ServiceError(
        400,
        missing.length === 1
          ? 'Bir soru cevapsız kaldı.'
          : `${missing.length} soru cevapsız kaldı.`,
      );
    }
    this.db.transaction(() => {
      for (const { d, choice } of choices) answerDecision(this.db, d.id, choice ?? '');
    });
    await this.resumeIfReady(taskId, input.note ?? null);
  }

  /** The permission card's buttons; resumes the task when nothing else is pending. */
  async respondPermission(
    taskId: string,
    permissionId: string,
    action: PermissionAction,
  ): Promise<void> {
    const ctx = this.waitingTask(taskId);
    const request = getPermissionRequest(this.db, permissionId);
    if (!request || request.taskId !== taskId)
      throw new ServiceError(404, 'İzin isteği bulunamadı');
    if (request.status !== 'pending')
      throw new ServiceError(409, 'Bu izin isteği zaten cevaplandı');
    if (action === 'always') {
      const project = getProject(this.db, ctx.projectId);
      if (!project) throw new ServiceError(404, 'Proje bulunamadı');
      try {
        this.tasks.team.addAllowRule(project.path, request.rule);
      } catch (err) {
        if (!(err instanceof ServiceError)) throw err;
        throw new ServiceError(
          409,
          `“Hep izin ver” kuralı .team/team.json dosyasına yazılır ama dosya kullanılamıyor: ${err.message}. Bu görev için “İzin ver”i kullanabilirsin.`,
        );
      }
    }
    answerPermissionRequest(this.db, permissionId, action);
    await this.resumeIfReady(taskId, null);
  }

  private waitingTask(taskId: string) {
    const ctx = getTaskWithContext(this.db, taskId);
    if (!ctx) throw new ServiceError(404, 'Görev bulunamadı');
    if (ctx.task.status !== 'waiting_decision') {
      throw new ServiceError(409, 'Bu görev senden cevap beklemiyor');
    }
    return ctx;
  }

  /**
   * One `--resume` with everything answered for the latest run. Runs again with the same answers
   * if the previous attempt could not start (the task is still waiting, nothing pending).
   */
  private async resumeIfReady(taskId: string, note: string | null): Promise<void> {
    const ctx = getTaskWithContext(this.db, taskId);
    if (!ctx) return;
    const pending = pendingFor(this.db, taskId);
    if (pending.questions.length > 0 || pending.permissions.length > 0) {
      this.tasks.hub.notify(ctx.projectId);
      return;
    }
    const run = latestResumableRun(this.db, taskId);
    if (!run)
      throw new ServiceError(409, 'Bu görevin sürdürülecek bir oturumu yok. Yeniden başlat.');
    const questions = agentQuestions(this.db, taskId).filter((d) => d.runId === run.id);
    const permissions = listPermissionRequests(this.db, taskId).filter((p) => p.runId === run.id);
    const message = resumeMessage({ questions, permissions, note });
    const once = permissions.filter((p) => p.status === 'once').map((p) => p.rule);
    await this.tasks.resumeTask(taskId, message, once);
  }
}
