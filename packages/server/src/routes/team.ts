import { ProjectSettings } from '@squadboard/core';
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { getProject, type ProjectRow } from '../db/repository.js';
import { countChanges, getRepoInfo } from '../git/git.js';
import type { Runner } from '../runner/runner.js';
import { ServiceError } from '../service-error.js';
import type { TaskService } from '../tasks/task-service.js';
import type { TeamService } from '../team/team-service.js';

/** The setup screen's checklist (v2-07): only what the server can really check. */
export interface ProjectChecks {
  path: string;
  isRepo: boolean;
  mainBranch: string;
  hasCommits: boolean;
  /** Uncommitted entries in the user's checkout (agents do not see them). */
  changes: number | null;
  claude: { ok: boolean; version: string | null };
}

const IdParams = z.object({ id: z.string().min(1) });
const AgentParams = z.object({ id: z.string().min(1), agentId: z.string().min(1) });

const InstallBody = z.object({
  templateId: z.string().trim().min(1, 'templateId gerekli'),
  agents: z.array(z.string().min(1)).max(50).optional(),
  settings: ProjectSettings.partial().optional(),
  overwrite: z.boolean().default(false),
});

const AgentBody = z.object({
  enabled: z.boolean().optional(),
  names: z
    .object({
      tech: z.string().trim().min(1, 'Ad boş olamaz').max(40).optional(),
      friendly: z.string().trim().min(1, 'Sade ad boş olamaz').max(40).optional(),
    })
    .optional(),
  prompt: z.string().trim().min(1, 'Talimat boş olamaz').max(50_000).optional(),
  model: z.string().trim().min(1).max(80).nullable().optional(),
});

export function registerTeamRoutes(
  app: FastifyInstance,
  deps: { db: Db; runner: Runner; tasks: TaskService; team: TeamService },
): void {
  const { db, runner, tasks, team } = deps;

  const project = (id: string): ProjectRow => {
    const found = getProject(db, id);
    if (!found) throw new ServiceError(404, 'Proje bulunamadı');
    if (!existsSync(found.path)) {
      throw new ServiceError(409, `Proje klasörü bulunamadı: ${found.path}`);
    }
    return found;
  };

  app.get('/api/templates', async () => ({ templates: team.listTemplates() }));

  app.get('/api/projects/:id/team', async (request) =>
    team.read(project(IdParams.parse(request.params).id).path),
  );

  app.get('/api/projects/:id/checks', async (request): Promise<ProjectChecks> => {
    const stored = getProject(db, IdParams.parse(request.params).id);
    if (!stored) throw new ServiceError(404, 'Proje bulunamadı');
    const fresh = await tasks.refreshMainBranch(stored);
    const info = existsSync(fresh.path) ? await getRepoInfo(fresh.path).catch(() => null) : null;
    const version = await runner.cliVersion();
    return {
      path: fresh.path,
      isRepo: info !== null,
      mainBranch: fresh.mainBranch,
      hasCommits: info?.hasCommits ?? false,
      changes: info ? await countChanges(fresh.path).catch(() => null) : null,
      claude: { ok: version !== null, version },
    };
  });

  app.post('/api/projects/:id/team/install', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const body = InstallBody.parse(request.body);
    const path = project(id).path;
    const input: Parameters<TeamService['install']>[1] = {
      templateId: body.templateId,
      overwrite: body.overwrite,
    };
    if (body.agents) input.agents = body.agents;
    if (body.settings) input.settings = stripUndefined(body.settings);
    const result = team.install(path, input);
    return reply.code(201).send({ ...result, state: team.read(path) });
  });

  app.patch('/api/projects/:id/team/settings', async (request) => {
    const { id } = IdParams.parse(request.params);
    const patch = stripUndefined(ProjectSettings.partial().parse(request.body));
    return team.updateSettings(project(id).path, patch);
  });

  app.patch('/api/projects/:id/team/agents/:agentId', async (request) => {
    const { id, agentId } = AgentParams.parse(request.params);
    const body = AgentBody.parse(request.body);
    const patch: Parameters<TeamService['updateAgent']>[2] = {};
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.names) patch.names = stripUndefined(body.names);
    if (body.prompt !== undefined) patch.prompt = body.prompt;
    if (body.model !== undefined) patch.model = body.model;
    return team.updateAgent(project(id).path, agentId, patch);
  });
}

/** exactOptionalPropertyTypes: drop keys whose value is undefined. */
function stripUndefined<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
