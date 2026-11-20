import { useEffect } from 'react';
import { useProjects } from './queries';
import { useUi } from './store';

/**
 * The selected project, kept valid: the first project when none (or a deleted one) is selected.
 */
export function useCurrentProject() {
  const projects = useProjects();
  const projectId = useUi((s) => s.projectId);
  const setProjectId = useUi((s) => s.setProjectId);
  const list = projects.data;

  useEffect(() => {
    if (!list) return;
    if (!list.some((p) => p.id === projectId)) setProjectId(list[0]?.id ?? null);
  }, [list, projectId, setProjectId]);

  return { projects, project: list?.find((p) => p.id === projectId) ?? null };
}
