import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import {
  getProject,
  getTaskWithContext,
  latestRunSummary,
  listProjectTasks,
  listProjects,
  type ProjectRow,
  type TaskWithContext,
} from '../db/repository.js';
import { isClean } from '../git/git.js';
import type { Runner } from '../runner/runner.js';
import { ServiceError, type TaskService } from '../tasks/task-service.js';
import type { RunView } from './runs.js';

export interface ProjectView extends ProjectRow {
  /** Whether the user's working tree has uncommitted changes (agents do not see those). */
  clean: boolean | null;
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
  gitError: string | null;
  createdAt: string;
  active: boolean;
  latestRun: RunView | null;
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
const CleanupBody = z.object({ deleteBranch: z.boolean().default(false) }).default({
  deleteBranch: false,
});

export function registerProjectRoutes(
  app: FastifyInstance,
  deps: { db: Db; runner: Runner; tasks: TaskService },
): void {
  const { db, runner, tasks } = deps;

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
      gitError: task.gitError,
      createdAt: task.createdAt,
      active: runner.isTaskRunning(task.id),
      latestRun: run ? { ...run, active: runner.isRunning(run.id) } : null,
    };
  };

  const loadTask = (id: string): TaskView => {
    const ctx = getTaskWithContext(db, id);
    if (!ctx) throw new ServiceError(404, 'Task not found');
    return taskView(ctx);
  };

  const projectView = async (project: ProjectRow): Promise<ProjectView> => ({
    ...project,
    clean: existsSync(project.path) ? await isClean(project.path).catch(() => null) : null,
    taskCount: listProjectTasks(db, project.id).length,
  });

  app.get('/api/projects', async () => ({
    projects: await Promise.all(listProjects(db).map(projectView)),
  }));

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
    const created = tasks.createTask(id, {
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

  app.post('/api/tasks/:id/cleanup', async (request) => {
    const { id } = IdParams.parse(request.params);
    const { deleteBranch } = CleanupBody.parse(request.body ?? undefined);
    await tasks.cleanupTask(id, { deleteBranch });
    return loadTask(id);
  });
}
