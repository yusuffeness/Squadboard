import { canTransition, patternsOverlap, type TaskStatus } from '@squadboard/core';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Db } from '../db/index.js';
import {
  createProject,
  createRequest,
  createTask,
  deleteProject,
  findProjectByPath,
  getProject,
  getTaskWithContext,
  listDependents,
  listProjectTasks,
  setTaskStatus,
  updateProject,
  updateTask,
  type ProjectRow,
  type TaskRow,
} from '../db/repository.js';
import { explainGitError } from '../git/errors.js';
import {
  changedFiles,
  commitAll,
  createWorktree,
  detectMainBranch,
  getRepoInfo,
  removeWorktree,
} from '../git/git.js';
import { taskBranchName, worktreeFolderName } from '../git/naming.js';
import type { AgentRunOptions } from '../runner/claude-cli.js';
import type { RunHandle, RunOutcome, Runner } from '../runner/runner.js';
import { ServiceError } from '../service-error.js';
import { DEFAULT_TOOLS, TeamService } from '../team/team-service.js';

export { ServiceError };

/** `~/.squadboard/worktrees`, overridable with SQUADBOARD_WORKTREES. Never inside a user repo. */
export function defaultWorktreesDir(): string {
  return process.env.SQUADBOARD_WORKTREES ?? join(homedir(), '.squadboard', 'worktrees');
}

/**
 * Agent used when the project has no team (or the task's agent is not in it): may read and edit
 * files in its own worktree, no shell commands. Agents defined in `.team/` bring their own tools,
 * model, budget and prompt (TeamService.runConfig).
 *
 * `--allowedTools` alone is NOT a whitelist: other tools stay available, and Claude Code
 * auto-approves read-only shell commands such as `ls` (seen in the Stage 5 manual test).
 * `--tools` limits which tools exist at all; it also removes AskUserQuestion, which cannot
 * work headless (the agent asked anyway, got denied and guessed an answer).
 */
export const DEFAULT_AGENT_OPTIONS: AgentRunOptions = {
  permissionMode: 'acceptEdits',
  tools: DEFAULT_TOOLS,
  allowedTools: DEFAULT_TOOLS,
  maxBudgetUsd: 1,
};

/** A dependency must be finished (and its work committed) before a dependent task starts. */
const READY_DEPENDENCY: readonly TaskStatus[] = ['in_review', 'done'];

export interface CreateTaskInput {
  title: string;
  prompt: string;
  agent: string;
  expectedFiles?: string[];
  /** At most one dependency for now: the task starts from that task's branch (stacked). */
  dependsOn?: string | null;
}

export interface TaskServiceOptions {
  db: Db;
  runner: Runner;
  worktreesDir?: string;
  /** Used when the task's agent has no definition in the project's `.team/`. */
  agentOptions?: AgentRunOptions;
  team?: TeamService;
}

/**
 * Projects (git repositories) and tasks that each run in their own git worktree on a
 * `team/…` branch. The user's checkout is never modified (docs/ARCHITECTURE.md → "Git worktree stratejisi").
 */
export class TaskService {
  private readonly db: Db;
  private readonly runner: Runner;
  readonly worktreesDir: string;
  private readonly agentOptions: AgentRunOptions;
  readonly team: TeamService;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(options: TaskServiceOptions) {
    this.db = options.db;
    this.runner = options.runner;
    this.worktreesDir = canonicalDir(options.worktreesDir ?? defaultWorktreesDir());
    this.agentOptions = options.agentOptions ?? DEFAULT_AGENT_OPTIONS;
    this.team = options.team ?? new TeamService();
  }

  // ---------- projects ----------

  /**
   * Registers a git repository (idempotent: the same repo returns the existing project).
   * A repository without commits is accepted, so a team can be set up in a fresh repo; tasks
   * can only start after the first commit (the UI warns).
   */
  async addProject(path: string): Promise<ProjectRow> {
    if (!isAbsolute(path)) {
      throw new ServiceError(400, 'Klasörün tam yolunu yaz (ör. C:\\Users\\sen\\projem)');
    }
    if (!isDirectory(path)) throw new ServiceError(400, `Böyle bir klasör yok: ${path}`);
    const info = await getRepoInfo(path);
    if (!info) throw new ServiceError(400, `Bu klasör bir git deposu değil: ${path}`);
    if (isInside(info.root, this.worktreesDir)) {
      throw new ServiceError(400, 'Bu bir Squadboard çalışma klasörü (worktree), proje değil');
    }
    const existing = findProjectByPath(this.db, info.root);
    if (existing) return this.refreshMainBranch(existing);
    const mainBranch = (await detectMainBranch(info.root, null)) ?? info.branch ?? 'main';
    return createProject(this.db, { path: info.root, mainBranch });
  }

  /**
   * Forgets a project: its tasks, runs and events go from Squadboard's database. The user's
   * folder, branches and Squadboard's worktree folders are left as they are.
   */
  deleteProject(projectId: string): void {
    if (!getProject(this.db, projectId)) throw new ServiceError(404, 'Proje bulunamadı');
    const running = listProjectTasks(this.db, projectId).some((t) =>
      this.runner.isTaskRunning(t.task.id),
    );
    if (running) {
      throw new ServiceError(409, 'Bu projede çalışan bir görev var. Önce durdur, sonra sil.');
    }
    deleteProject(this.db, projectId);
  }

  /**
   * Detects the main branch again and stores it if it changed (a stored name can go stale, e.g.
   * the repo uses `master` but `main` was stored). Keeps the stored one when the repository has
   * no committed branch yet.
   */
  async refreshMainBranch(project: ProjectRow): Promise<ProjectRow> {
    if (!existsSync(project.path)) return project;
    const detected = await detectMainBranch(project.path, project.mainBranch);
    if (!detected || detected === project.mainBranch) return project;
    return updateProject(this.db, project.id, { mainBranch: detected });
  }

  // ---------- tasks ----------

  async createTask(projectId: string, input: CreateTaskInput): Promise<TaskRow> {
    const project = getProject(this.db, projectId);
    if (!project) throw new ServiceError(404, 'Project not found');
    // Record the branch this task will start from as it is now; checked again at start.
    await this.refreshMainBranch(project);
    const title = input.title.trim();
    const prompt = input.prompt.trim();
    if (!title) throw new ServiceError(400, 'title is required');
    if (!prompt) throw new ServiceError(400, 'prompt is required');

    let status: TaskStatus = 'planned';
    const dependsOn: string[] = [];
    if (input.dependsOn) {
      const dep = getTaskWithContext(this.db, input.dependsOn);
      if (!dep || dep.projectId !== projectId) {
        throw new ServiceError(400, 'dependsOn must be a task of the same project');
      }
      dependsOn.push(dep.task.id);
      if (!READY_DEPENDENCY.includes(dep.task.status)) status = 'blocked';
    }

    const request = createRequest(this.db, { projectId, text: prompt });
    return createTask(this.db, {
      requestId: request.id,
      title,
      agent: input.agent.trim() || 'general',
      dependsOn,
      expectedFiles: (input.expectedFiles ?? []).map((f) => f.trim()).filter(Boolean),
      status,
    });
  }

  /**
   * Starts a task in its worktree (created on first start). The returned `done` resolves after
   * the run has ended AND its work was committed / measured.
   */
  async startTask(taskId: string): Promise<RunHandle> {
    const ctx = getTaskWithContext(this.db, taskId);
    if (!ctx) throw new ServiceError(404, 'Task not found');
    const project = getProject(this.db, ctx.projectId);
    if (!project) throw new ServiceError(404, 'Project not found');
    let task = ctx.task;

    if (this.runner.isTaskRunning(taskId)) throw new ServiceError(409, 'Task is already running');
    const agentConfig = this.team.runConfig(project.path, task.agent);
    if (agentConfig.status === 'disabled') {
      throw new ServiceError(
        409,
        `${agentConfig.agent.names.tech} ekipte kapalı. Ekip sayfasından açıp tekrar dene.`,
      );
    }
    const dep = this.readyDependency(task);
    // readyDependency may have moved the task from blocked to planned.
    task = getTaskWithContext(this.db, taskId)?.task ?? task;
    if (!canTransition(task.status, 'running')) {
      throw new ServiceError(409, `A ${task.status} task cannot be started`);
    }

    // Only a worktree we created counts. Tasks from the Stage 4 prototype stored the user's own
    // folder here; running there again would edit the user's working tree.
    if (!this.isManagedWorktree(task.worktreePath) || !existsSync(task.worktreePath)) {
      task = await this.ensureWorktree(project, task, dep);
    }
    const cwd = task.worktreePath;
    if (!cwd || !this.isManagedWorktree(cwd)) throw new ServiceError(409, 'Task has no worktree');

    const options = agentConfig.status === 'ok' ? agentConfig.options : this.agentOptions;
    const handle = this.runner.start({ taskId, prompt: ctx.prompt, cwd, ...options });
    const done = handle.done.then((outcome) => this.afterRun(outcome));
    this.pending.add(done);
    void done.finally(() => this.pending.delete(done));
    return { ...handle, done };
  }

  /**
   * Waits for post-run work (commits, changed files) still in progress. Call after stopping the
   * runner and before closing the database, or that work would write to a closed database.
   */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  async stopTask(taskId: string): Promise<RunOutcome | undefined> {
    if (!getTaskWithContext(this.db, taskId)) throw new ServiceError(404, 'Task not found');
    return this.runner.stopTask(taskId);
  }

  /**
   * Removes the task's worktree. Work committed on its branch stays unless `deleteBranch`.
   * Note: the Claude session is bound to the worktree path; a re-created worktree uses the
   * same path, so the session stays resumable.
   */
  async cleanupTask(taskId: string, options: { deleteBranch?: boolean } = {}): Promise<TaskRow> {
    const ctx = getTaskWithContext(this.db, taskId);
    if (!ctx) throw new ServiceError(404, 'Task not found');
    const project = getProject(this.db, ctx.projectId);
    if (!project) throw new ServiceError(404, 'Project not found');
    const { task } = ctx;
    if (this.runner.isTaskRunning(taskId)) {
      throw new ServiceError(409, 'Stop the task before cleaning up its worktree');
    }
    if (options.deleteBranch) {
      const waiting = listDependents(this.db, project.id, taskId).filter((d) => !d.branch);
      if (waiting.length > 0) {
        throw new ServiceError(
          409,
          `Task "${waiting[0]?.title ?? ''}" still needs this branch as its starting point`,
        );
      }
    }
    // Never ask git to remove a folder we did not create (e.g. a Stage 4 task's project folder).
    if (this.isManagedWorktree(task.worktreePath)) {
      const removeOptions: { path: string; branch?: string; deleteBranch?: boolean } = {
        path: task.worktreePath,
      };
      if (task.branch) removeOptions.branch = task.branch;
      if (options.deleteBranch) removeOptions.deleteBranch = true;
      await removeWorktree(project.path, removeOptions);
    }
    return updateTask(this.db, taskId, {
      worktreePath: null,
      ...(options.deleteBranch ? { branch: null, baseRef: null, baseCommit: null } : {}),
    });
  }

  // ---------- internals ----------

  /** True only for a path inside our worktrees folder (and not the folder itself). */
  private isManagedWorktree(path: string | null): path is string {
    return (
      path !== null &&
      path !== '' &&
      isInside(path, this.worktreesDir) &&
      resolve(path) !== this.worktreesDir
    );
  }

  /** The dependency a task starts from (stacked), or null. Throws 409 if it is not finished. */
  private readyDependency(task: TaskRow): TaskRow | null {
    const depId = task.dependsOn[0];
    if (!depId) return null;
    const dep = getTaskWithContext(this.db, depId)?.task;
    if (!dep) throw new ServiceError(409, 'Dependency no longer exists');
    if (!READY_DEPENDENCY.includes(dep.status) || !dep.branch) {
      throw new ServiceError(409, `Waiting for "${dep.title}" to finish first`);
    }
    if (task.status === 'blocked') setTaskStatus(this.db, task.id, 'planned');
    return dep;
  }

  private async ensureWorktree(
    project: ProjectRow,
    task: TaskRow,
    dep: TaskRow | null,
  ): Promise<TaskRow> {
    const branch = task.branch ?? taskBranchName(task.title, task.id);
    const path = join(this.worktreesDir, project.id, worktreeFolderName(branch));
    let base = task.baseRef ?? dep?.branch ?? null;
    if (!base) {
      const main = await detectMainBranch(project.path, project.mainBranch);
      if (!main) {
        throw new ServiceError(
          409,
          "Depoda henüz commit yok. Görev başlatmadan önce ilk commit'i at.",
        );
      }
      if (main !== project.mainBranch) updateProject(this.db, project.id, { mainBranch: main });
      base = main;
    }
    try {
      const wt = await createWorktree(project.path, { branch, path, base });
      return updateTask(this.db, task.id, {
        branch: wt.branch,
        worktreePath: wt.path,
        baseRef: base,
        baseCommit: task.baseCommit ?? wt.baseCommit,
        gitError: null,
      });
    } catch (err) {
      const raw = (err as Error).message;
      updateTask(this.db, task.id, { gitError: raw });
      const explained = explainGitError(raw);
      throw new ServiceError(
        409,
        `Çalışma klasörü açılamadı. ${explained?.message ?? 'Git bir hata verdi.'}`,
        { detail: raw },
      );
    }
  }

  /**
   * After every run: commit finished work to the task's own branch (so dependents can stack on
   * it), record which files changed and which were not expected, and unblock dependents.
   * Never throws; git problems are stored on the task.
   */
  private async afterRun(outcome: RunOutcome): Promise<RunOutcome> {
    const ctx = getTaskWithContext(this.db, outcome.taskId);
    const task = ctx?.task;
    const project = ctx ? getProject(this.db, ctx.projectId) : undefined;
    if (!task || !project || !task.baseCommit || !this.isManagedWorktree(task.worktreePath)) {
      return outcome;
    }
    try {
      if (outcome.taskStatus === 'in_review') {
        await commitAll(project.path, task.worktreePath, `squadboard: ${task.title}`);
      }
      const changed = await changedFiles(task.worktreePath, task.baseCommit);
      const unexpected =
        task.expectedFiles.length === 0
          ? []
          : changed.filter((file) => !task.expectedFiles.some((p) => patternsOverlap(p, file)));
      updateTask(this.db, task.id, {
        changedFiles: changed,
        unexpectedFiles: unexpected,
        gitError: null,
      });
      if (outcome.taskStatus === 'in_review') this.unblockDependents(project.id, task.id);
    } catch (err) {
      updateTask(this.db, task.id, { gitError: (err as Error).message });
    }
    return outcome;
  }

  private unblockDependents(projectId: string, taskId: string): void {
    for (const dependent of listDependents(this.db, projectId, taskId)) {
      if (dependent.status === 'blocked') setTaskStatus(this.db, dependent.id, 'planned');
    }
  }
}

/**
 * Creates the folder and returns its canonical path. On Windows a path can be written in 8.3 short
 * form (C:\Users\RUNNER~1); git always reports the long form, and worktree paths are compared with
 * what git reports.
 */
function canonicalDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return realpathSync.native(path);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True if `child` is `parent` or below it (path.relative is case-insensitive on Windows). */
function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
