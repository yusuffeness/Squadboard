import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient as Client,
} from '@tanstack/react-query';
import { createContext, useContext, useEffect } from 'react';
import type { ProjectSettings } from '@squadboard/core';
import type { AgentPatch, Api, InstallTeam, NewTask, TaskView, TeamState } from '../api';
import { useRunStream } from './run-streams';

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi: no ApiContext provider');
  return api;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Live changes come from SSE (see useLiveTask), not from polling.
      queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
    },
  });
}

export const keys = {
  health: ['health'] as const,
  projects: ['projects'] as const,
  tasks: (projectId: string) => ['tasks', projectId] as const,
  runs: ['runs'] as const,
  templates: ['templates'] as const,
  team: (projectId: string) => ['team', projectId] as const,
  checks: (projectId: string) => ['checks', projectId] as const,
};

export function useHealth() {
  const api = useApi();
  return useQuery({ queryKey: keys.health, queryFn: api.health, refetchInterval: 30_000 });
}

export function useProjects() {
  const api = useApi();
  return useQuery({ queryKey: keys.projects, queryFn: api.listProjects });
}

export function useTasks(projectId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: keys.tasks(projectId ?? ''),
    queryFn: () => api.listTasks(projectId ?? ''),
    enabled: projectId !== null,
  });
}

export function useRuns() {
  const api = useApi();
  return useQuery({ queryKey: keys.runs, queryFn: api.listRuns });
}

/** Refreshes everything a task change can affect: its list, the project counts, today's cost. */
function refreshAfterTaskChange(client: Client, projectId: string) {
  void client.invalidateQueries({ queryKey: keys.tasks(projectId) });
  void client.invalidateQueries({ queryKey: keys.projects });
  void client.invalidateQueries({ queryKey: keys.runs });
}

/** Puts a task returned by the server straight into the cached list. */
function putTask(client: Client, task: TaskView) {
  client.setQueryData<TaskView[]>(keys.tasks(task.projectId), (list) =>
    list ? list.map((t) => (t.id === task.id ? task : t)) : list,
  );
}

export function useAddProject() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.addProject(path),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useDeleteProject() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSettled: () => void client.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useTemplates() {
  const api = useApi();
  return useQuery({ queryKey: keys.templates, queryFn: api.listTemplates, staleTime: Infinity });
}

/** The project's `.team/` (missing, invalid or ok). Re-read on focus: users edit it by hand. */
export function useTeam(projectId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: keys.team(projectId ?? ''),
    queryFn: () => api.getTeam(projectId ?? ''),
    enabled: projectId !== null,
    staleTime: 5_000,
  });
}

export function useChecks(projectId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: keys.checks(projectId ?? ''),
    queryFn: () => api.getChecks(projectId ?? ''),
    enabled: projectId !== null,
    staleTime: 5_000,
  });
}

/** Team writes return the new team; put it in the cache so every page sees it at once. */
function putTeam(client: Client, projectId: string, state: TeamState) {
  client.setQueryData(keys.team(projectId), state);
  void client.invalidateQueries({ queryKey: keys.checks(projectId) });
}

export function useInstallTeam(projectId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: InstallTeam) => api.installTeam(projectId, input),
    onSuccess: (result) => putTeam(client, projectId, result.state),
  });
}

export function useUpdateAgent(projectId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, patch }: { agentId: string; patch: AgentPatch }) =>
      api.updateAgent(projectId, agentId, patch),
    onSuccess: (team) => putTeam(client, projectId, { status: 'ok', team }),
  });
}

export function useUpdateTeamSettings(projectId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: Partial<ProjectSettings>) => api.updateTeamSettings(projectId, settings),
    onSuccess: (team) => putTeam(client, projectId, { status: 'ok', team }),
  });
}

export function useCreateTask(projectId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ task, start }: { task: NewTask; start: boolean }) => {
      const created = await api.createTask(projectId, task);
      return start ? api.startTask(created.id) : created;
    },
    onSettled: () => refreshAfterTaskChange(client, projectId),
  });
}

/** Start, stop and clean up, all keyed by task. */
export function useTaskActions(projectId: string) {
  const api = useApi();
  const client = useQueryClient();
  const after = {
    onSuccess: (task: TaskView) => putTask(client, task),
    onSettled: () => refreshAfterTaskChange(client, projectId),
  };
  return {
    start: useMutation({ mutationFn: (id: string) => api.startTask(id), ...after }),
    stop: useMutation({ mutationFn: (id: string) => api.stopTask(id), ...after }),
    cleanup: useMutation({
      mutationFn: ({ id, deleteBranch }: { id: string; deleteBranch: boolean }) =>
        api.cleanupTask(id, deleteBranch),
      ...after,
    }),
  };
}

/**
 * Follows a running task's event stream and refreshes the board when it ends. The server commits
 * the work and unblocks dependent tasks right after the run ends, so the board is refreshed once
 * more shortly after (one extra request per finished run, not a polling loop).
 */
export function useLiveTask(task: TaskView) {
  const api = useApi();
  const client = useQueryClient();
  const runId = task.active ? (task.latestRun?.id ?? null) : null;
  const stream = useRunStream(runId, runId ? api.eventsUrl(runId) : null);

  useEffect(() => {
    if (!stream.finished) return;
    refreshAfterTaskChange(client, task.projectId);
    // Not cleared on cleanup: the first refresh makes the task inactive, which unsubscribes the
    // stream and re-runs this effect; the follow-up must still happen.
    setTimeout(() => refreshAfterTaskChange(client, task.projectId), 1500);
  }, [stream.finished, client, task.projectId]);

  return stream;
}
