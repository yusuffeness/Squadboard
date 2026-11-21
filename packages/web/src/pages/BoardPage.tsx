import { FolderGit2, RotateCcw, Users } from 'lucide-react';
import { AddProjectForm } from '../components/AddProjectForm';
import { NewTaskDialog } from '../components/NewTaskDialog';
import { PLAN_SCREEN, planNeedingAttention } from '../lib/plan';
import { usePlans, useProjectEvents, useTasks, useTeam } from '../lib/queries';
import { navigate, useRoute } from '../lib/router';
import { useUi } from '../lib/store';
import { useCurrentProject } from '../lib/use-project';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Notice } from '../ui/Notice';
import { AgentStrip } from './board/AgentStrip';
import { Columns } from './board/Columns';
import { Hero } from './board/Hero';
import { PlanBanner } from './board/PlanBanner';
import { waitingTasks } from '../lib/decision';
import { PlanPage } from './PlanPage';
import { Suggestions } from './board/Suggestions';
import { TaskDetail } from './TaskDetail';
import { WaitingTask } from './board/WaitingTask';

/** Pano (v2-01, v2-02, v2-04): welcome, agent strip, four columns, or one task's detail. */
export function BoardPage() {
  const { projects, project } = useCurrentProject();
  const route = useRoute();
  const tasks = useTasks(project?.id ?? null);
  const team = useTeam(project?.id ?? null);
  const plans = usePlans(project?.id ?? null);
  // Live updates for the whole project (scheduler starts, plan steps) without polling.
  useProjectEvents(project?.id ?? null);

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
  const planList = plans.data ?? [];
  const openPlan = route.plan ? planList.find((p) => p.id === route.plan) : undefined;
  const attention = planNeedingAttention(planList);

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      {!project.hasCommits && (
        <Notice tone="warn">
          Bu depoda henüz commit yok. Ekibini kurabilir, görev ekleyebilirsin; görevler ilk
          commit'ten sonra başlar.
        </Notice>
      )}
      {project.clean === false && project.hasCommits && (
        <Notice tone="warn">
          Projende kaydedilmemiş değişiklikler var. Ajanlar yalnızca commit'lenmiş hâli görür.
        </Notice>
      )}
      {team.data?.status === 'invalid' && (
        <Notice
          tone="warn"
          action={<Button onClick={() => navigate({ page: 'ekip', task: null })}>Ekibe git</Button>}
        >
          Ekip dosyaları okunamadı, varsayılan ekip gösteriliyor. {team.data.error}
        </Notice>
      )}
      {team.data?.status === 'missing' && (
        <Notice
          tone="warn"
          action={
            <Button icon={Users} onClick={() => navigate({ page: 'ekip', task: null })}>
              Ekibini kur
            </Button>
          }
        >
          Bu projede henüz ekip kurulmamış. Şimdilik varsayılan ekip görünüyor.
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

      {route.plan && plans.isSuccess && !openPlan && (
        <Notice
          tone="warn"
          action={<Button onClick={() => navigate({ plan: null })}>Panoya dön</Button>}
        >
          Bu plan bu projede yok.
        </Notice>
      )}
      {openPlan && PLAN_SCREEN.includes(openPlan.status) ? (
        <PlanPage plan={openPlan} />
      ) : open ? (
        <TaskDetail task={open} tasks={taskList} />
      ) : (
        <>
          {route.task && tasks.isSuccess && <MissingTask />}
          {attention && <PlanBanner plan={attention} />}
          {/* Kararın lazım (v2-03): always in the top half, before anything else on the board. */}
          {waitingTasks(taskList).map((t) => (
            <WaitingTask key={t.id} task={t} />
          ))}
          {/* First run (v2-02) puts the team on top; the working board (v2-01) leads with the hero. */}
          {firstRun && <AgentStrip tasks={taskList} />}
          <Hero firstRun={firstRun} projectId={project.id} />
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
