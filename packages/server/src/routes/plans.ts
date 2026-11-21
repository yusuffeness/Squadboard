import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { getProject } from '../db/repository.js';
import type { ChangeHub } from '../events/change-hub.js';
import { MAX_REQUEST_LENGTH, type PlanService } from '../plans/plan-service.js';
import { ServiceError } from '../service-error.js';

const IdParams = z.object({ id: z.string().min(1) });
const PlanBody = z.object({
  text: z.string().trim().min(1, 'Ne yapılacağını yaz.').max(MAX_REQUEST_LENGTH),
});
const EditBody = z.union([
  z.object({ removeTask: z.string().min(1) }),
  z.object({ taskId: z.string().min(1), agent: z.string().min(1) }),
]);
const ApproveBody = z
  .object({ answers: z.record(z.string(), z.string().max(2000)).default({}) })
  .default({ answers: {} });

/** How long change signals are gathered before one goes out (a plan step can fire several). */
const CHANGE_DEBOUNCE_MS = 100;

export function registerPlanRoutes(
  app: FastifyInstance,
  deps: { db: Db; plans: PlanService; hub: ChangeHub },
): void {
  const { db, plans, hub } = deps;

  /** Runs the team's Planner on the request; returns at once with status "planning". */
  app.post('/api/projects/:id/plans', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { text } = PlanBody.parse(request.body);
    const created = plans.startPlanning(id, text);
    return reply.code(201).send(plans.view(created.id));
  });

  app.get('/api/projects/:id/plans', async (request) => {
    const { id } = IdParams.parse(request.params);
    return { plans: plans.list(id) };
  });

  app.get('/api/plans/:id', async (request) => plans.view(IdParams.parse(request.params).id));

  app.patch('/api/plans/:id', async (request) => {
    const { id } = IdParams.parse(request.params);
    return plans.edit(id, EditBody.parse(request.body));
  });

  app.post('/api/plans/:id/approve', async (request) => {
    const { id } = IdParams.parse(request.params);
    const { answers } = ApproveBody.parse(request.body ?? undefined);
    return plans.approve(id, answers);
  });

  app.post('/api/plans/:id/cancel', async (request) =>
    plans.cancel(IdParams.parse(request.params).id),
  );

  app.post('/api/plans/:id/resume', async (request) =>
    plans.resume(IdParams.parse(request.params).id),
  );

  /**
   * SSE: `event: change` whenever something in the project changed (task created, started,
   * finished; plan step; plan approved). Carries no data on purpose: the page re-reads tasks and
   * plans through the normal API. Starts with one `change` so a reconnect catches up.
   */
  app.get('/api/projects/:id/events', (request, reply) => {
    const { id } = IdParams.parse(request.params);
    if (!getProject(db, id)) throw new ServiceError(404, 'Proje bulunamadı');

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    let timer: NodeJS.Timeout | null = null;
    const send = () => {
      timer = null;
      res.write('event: change\ndata: {}\n\n');
    };
    const onChange = (projectId: string) => {
      if (projectId === id && !timer) timer = setTimeout(send, CHANGE_DEBOUNCE_MS);
    };
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    hub.on('change', onChange);
    send();
    request.raw.on('close', () => {
      hub.off('change', onChange);
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
    });
  });
}
