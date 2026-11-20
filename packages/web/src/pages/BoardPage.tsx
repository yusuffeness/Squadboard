import { FolderGit2, RotateCcw } from 'lucide-react';
import { useEffect } from 'react';
import { AddProjectForm } from '../components/AddProjectForm';
import { NewTaskDialog } from '../components/NewTaskDialog';
import { useProjects, useTasks } from '../lib/queries';
import { navigate, useRoute } from '../lib/router';
import { useUi } from '../lib/store';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Notice } from '../ui/Notice';
import { AgentStrip } from './board/AgentStrip';
import { Columns } from './board/Columns';
import { Hero } from './board/Hero';
import { Suggestions } from './board/Suggestions';
import { TaskDetail } from './TaskDetail';

/** Pano (v2-01, v2-02, v2-04): welcome, agent strip, four columns, or one task's detail. */
export function BoardPage() {
  const projects = useProjects();
  const projectId = useUi((s) => s.projectId);
  const setProjectId = useUi((s) => s.setProjectId);
  const route = useRoute();

  // Keep the selection valid: first project when none (or a deleted one) is selected.
  const list = projects.data;
  useEffect(() => {
    if (!list) return;
    if (!list.some((p) => p.id === projectId)) setProjectId(list[0]?.id ?? null);
  }, [list, projectId, setProjectId]);

  const project = list?.find((p) => p.id === projectId) ?? null;
  const tasks = useTasks(project?.id ?? null);

  if (projects.isPending) return <BoardSkeleton />;
  if (projects.isError)
    return (
      <Notice
        action={
          <Button icon={RotateCcw} onClick={() => void projects.refetch()}>
            Yeniden dene
          </Button>
        }
      >
        Projeler yüklenemedi: {projects.error.message}
      </Notice>
    );
  if (!project) return <NoProject />;

  const taskList = tasks.data ?? [];
  const firstRun = tasks.isSuccess && taskList.length === 0;
  const open = route.task ? taskList.find((t) => t.id === route.task) : undefined;

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      {project.clean === false && (
        <Notice tone="warn">
          Projende kaydedilmemiş değişiklikler var. Ajanlar yalnızca commit'lenmiş hâli görür.
        </Notice>
      )}

      {tasks.isError && (
        <Notice
          action={
            <Button icon={RotateCcw} onClick={() => void tasks.refetch()}>
              Yeniden dene
            </Button>
          }
        >
          Görevler yüklenemedi: {tasks.error.message}
        </Notice>
      )}

      {open ? (
        <TaskDetail task={open} tasks={taskList} />
      ) : (
        <>
          {route.task && tasks.isSuccess && <MissingTask />}
          {/* First run (v2-02) puts the team on top; the working board (v2-01) leads with the hero. */}
          {firstRun && <AgentStrip tasks={taskList} />}
          <Hero firstRun={firstRun} />
          {!firstRun && <AgentStrip tasks={taskList} />}
          {tasks.isPending ? (
            <ColumnsSkeleton />
          ) : (
            <>
              {taskList.length === 0 && <Suggestions />}
              <Columns tasks={taskList} />
            </>
          )}
        </>
      )}

      <NewTaskDialog projectId={project.id} tasks={taskList} />
    </div>
  );
}

function MissingTask() {
  return (
    <Notice
      tone="warn"
      action={<Button onClick={() => navigate({ task: null })}>Panoya dön</Button>}
    >
      Bu görev bu projede yok. Başka bir projeye ait ya da silinmiş olabilir.
    </Notice>
  );
}

/** No project yet (v2-02 tone): one friendly card with the folder field. */
function NoProject() {
  const setProjectId = useUi((s) => s.setProjectId);
  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <Card padding="lg" as="section" aria-labelledby="no-project-title" className="rounded-[2rem]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          <span
            aria-hidden
            className="inline-flex size-16 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent"
          >
            <FolderGit2 className="size-8" />
          </span>
          <div className="min-w-0 flex-1">
            <h1
              id="no-project-title"
              className="text-4xl font-extrabold tracking-tight sm:text-5xl"
            >
              Ekibin hazır.
            </h1>
            <p className="mt-2 text-lg text-muted sm:text-xl">
              Önce projeni göster. Ajanlar senin klasörüne dokunmaz, her iş kendi dalında yapılır.
            </p>
          </div>
        </div>
        <div className="mt-8 max-w-2xl">
          <AddProjectForm onAdded={(p) => setProjectId(p.id)} />
        </div>
      </Card>
      <AgentStrip tasks={[]} />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yükleniyor" className="flex flex-col gap-8">
      <div className="h-64 animate-pulse rounded-[2rem] bg-surface/70" />
      <ColumnsSkeleton />
    </div>
  );
}

function ColumnsSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-72 animate-pulse rounded-[1.75rem] bg-surface/60" />
      ))}
    </div>
  );
}
