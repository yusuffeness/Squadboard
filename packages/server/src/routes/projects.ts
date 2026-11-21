import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import {
  getProject,
  getRequest,
  getTaskWithContext,
  latestRunSummary,
  listProjectTasks,
  listProjects,
  type ProjectRow,
  type TaskWithContext,
} from '../db/repository.js';
import { explainGitError } from '../git/errors.js';
import { getRepoInfo, isClean } from '../git/git.js';
import { INTERRUPTED_ERROR, type Runner } from '../runner/runner.js';
import { ServiceError, type TaskService } from '../tasks/task-service.js';
import {
  pendingFor,
  type AnswerInput,
  type DecisionService,
  type PendingView,
} from '../decisions/decision-service.js';
import type { RunView } from './runs.js';

export interface ProjectView extends ProjectRow {
  /** Whether the user's working tree has uncommitted changes (agents do not see those). */
  clean: boolean | null;
  /** false for a fresh repository: tasks cannot start before the first commit. */
  hasCommits: boolean;
  taskCount: number;
}

export interface TaskView {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  agent: string;
  status: TaskWithContext['task']['status'];
  dependsOn: string[];
  expectedFiles: string[];
  branch: string | null;
  worktreePath: string | null;
  baseRef: string | null;
  changedFiles: string[];
  unexpectedFiles: string[];
  /** Last git problem, in Turkish when it is a common one. */
  gitError: string | null;
  /** git's own message behind gitError (shown under "Ayrıntı"). */
  gitErrorDetail: string | null;
  /** Why a ready task was not started (e.g. its dependencies' branches conflict). */
  blockedReason: string | null;
  /** Stopped because Squadboard shut down, not by the user ("Kesildi"). */
  interrupted: boolean;
  /** The plan this task came from; null for a hand-made task. */
  planId: string | null;
  stage: number;
  createdAt: string;
  active: boolean;
  latestRun: RunView | null;
  /** What the task waits for (waiting_decision): the agent's questions and denied tool calls. */
  pending: PendingView;
}

const IdParams = z.object({ id: z.string().min(1) });
const AddProjectBody = z.object({ path: z.string().trim().min(1, 'path is required') });
const CreateTaskBody = z.object({
  title: z.string().trim().min(1, 'title is required').max(200),
  prompt: z.string().trim().min(1, 'prompt is required').max(20_000),
  agent: z.string().trim().max(50).default('general'),
  expectedFiles: z.array(z.string().trim().min(1)).max(100).default([]),
  dependsOn: z.string().min(1).nullish(),
});
const AnswerBody = z.object({
  answers: z.record(z.string(), z.string().max(4000)).default({}),
  delegate: z.boolean().default(false),
  note: z.string().max(4000).optional(),
});
const PermissionParams = z.object({ id: z.string().min(1), permissionId: z.string().min(1) });
const PermissionBody = z.object({
  action: z.enum(['once', 'task', 'always', 'denied'], {
    error: 'action şunlardan biri olmalı: once, task, always, denied',
  }),
});
const CleanupBody = z.object({ deleteBranch: z.boolean().default(false) }).default({
  deleteBranch: false,
});

export function registerProjectRoutes(
  app: FastifyInstance,
  deps: { db: Db; runner: Runner; tasks: TaskService; decisions: DecisionService },
): void {
  const { db, runner, tasks, decisions } = deps;

  const taskView = ({ task, prompt, projectId }: TaskWithContext): TaskView => {
    const run = latestRunSummary(db, task.id);
    return {
      id: task.id,
      projectId,
      title: task.title,
      prompt,
      agent: task.agent,
      status: task.status,
      dependsOn: task.dependsOn,
      expectedFiles: task.expectedFiles,
      branch: task.branch,
      worktreePath: task.worktreePath,
      baseRef: task.baseRef,
      changedFiles: task.changedFiles,
      unexpectedFiles: task.unexpectedFiles,
      gitError: task.gitError ? (explainGitError(task.gitError)?.message ?? task.gitError) : null,
      gitErrorDetail: task.gitError,
      blockedReason: task.blockedReason,
      interrupted: task.status === 'stopped' && run?.error === INTERRUPTED_ERROR,
      planId: getRequest(db, task.requestId)?.status ? task.requestId : null,
      stage: task.stage,
      createdAt: task.createdAt,
      active: runner.isTaskRunning(task.id),
      latestRun: run ? { ...run, active: runner.isRunning(run.id) } : null,
      pending:
        task.status === 'waiting_decision'
          ? pendingFor(db, task.id)
          : { questions: [], permissions: [], round: 0 },
    };
  };

  const loadTask = (id: string): TaskView => {
    const ctx = getTaskWithContext(db, id);
    if (!ctx) throw new ServiceError(404, 'Task not found');
    return taskView(ctx);
  };

  const projectView = async (stored: ProjectRow): Promise<ProjectView> => {
    // The stored main branch can go stale; show (and keep) what the repository has now.
    const project = await tasks.refreshMainBranch(stored).catch(() => stored);
    const there = existsSync(project.path);
    const info = there ? await getRepoInfo(project.path).catch(() => null) : null;
    return {
      ...project,
      clean: there ? await isClean(project.path).catch(() => null) : null,
      hasCommits: info?.hasCommits ?? false,
      taskCount: listProjectTasks(db, project.id).length,
    };
  };

  app.get('/api/projects', async () => ({
    projects: await Promise.all(listProjects(db).map(projectView)),
  }));

  /** Forgets the project in Squadboard only; the folder and the repository stay as they are. */
  app.delete('/api/projects/:id', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    tasks.deleteProject(id);
    return reply.code(204).send();
  });

  app.post('/api/projects', async (request, reply) => {
    const { path } = AddProjectBody.parse(request.body);
    const project = await tasks.addProject(path);
    return reply.code(201).send(await projectView(project));
  });

  app.get('/api/projects/:id/tasks', async (request) => {
    const { id } = IdParams.parse(request.params);
    if (!getProject(db, id)) throw new ServiceError(404, 'Project not found');
    return { tasks: listProjectTasks(db, id).map(taskView) };
  });

  app.post('/api/projects/:id/tasks', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const body = CreateTaskBody.parse(request.body);
    const created = await tasks.createTask(id, {
      title: body.title,
      prompt: body.prompt,
      agent: body.agent,
      expectedFiles: body.expectedFiles,
      dependsOn: body.dependsOn ?? null,
    });
    return reply.code(201).send(loadTask(created.id));
  });

  app.get('/api/tasks/:id', async (request) => loadTask(IdParams.parse(request.params).id));

  app.post('/api/tasks/:id/start', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    await tasks.startTask(id);
    return reply.code(201).send(loadTask(id));
  });

  app.post('/api/tasks/:id/stop', async (request) => {
    const { id } = IdParams.parse(request.params);
    await tasks.stopTask(id);
    return loadTask(id);
  });

  /** "Cevapla": answers the agent's questions; resumes the session when nothing else waits. */
  app.post('/api/tasks/:id/answer', async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = AnswerBody.parse(request.body ?? {});
    const input: AnswerInput = { answers: body.answers, delegate: body.delegate };
    if (body.note !== undefined) input.note = body.note;
    await decisions.answer(id, input);
    return loadTask(id);
  });

  /** The permission card: once / task ("İzin ver") / always ("Hep izin ver") / denied. */
  app.post('/api/tasks/:id/permissions/:permissionId', async (request) => {
    const { id, permissionId } = PermissionParams.parse(request.params);
    const { action } = PermissionBody.parse(request.body);
    await decisions.respondPermission(id, permissionId, action);
    return loadTask(id);
  });

  app.post('/api/tasks/:id/cleanup', async (request) => {
    const { id } = IdParams.parse(request.params);
    const { deleteBranch } = CleanupBody.parse(request.body ?? undefined);
    await tasks.cleanupTask(id, { deleteBranch });
    return loadTask(id);
  });
}
