import { FolderGit2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { InstallResult, ProjectView } from '../api';
import { AddProjectForm } from '../components/AddProjectForm';
import { useTeam } from '../lib/queries';
import { navigate } from '../lib/router';
import { useUi } from '../lib/store';
import { useCurrentProject } from '../lib/use-project';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ErrorMessage } from '../ui/ErrorMessage';
import { Notice } from '../ui/Notice';
import { SetupDone, SetupTeam } from './team/SetupTeam';
import { Steps } from './team/Steps';
import { TeamMembers } from './team/TeamMembers';

/**
 * Ekip page: without a project, step 1 (pick the folder); without a team, "Ekibini kur" (v2-07);
 * with a team, its members (v2-11). A broken `.team/` is explained, with the way out.
 */
export function TeamPage() {
  const { projects, project } = useCurrentProject();

  if (projects.isPending) return <Card className="h-64 animate-pulse" aria-busy />;
  if (projects.isError) {
    return <ErrorMessage error={projects.error} prefix="Projeler yüklenemedi:" />;
  }
  if (!project) return <PickFolder />;
  // Fresh state per project (an open edit panel or a finished setup belongs to one project).
  return <ProjectTeam key={project.id} project={project} />;
}

type View = { kind: 'auto' } | { kind: 'setup' } | { kind: 'done'; result: InstallResult };

function ProjectTeam({ project }: { project: ProjectView }) {
  const team = useTeam(project.id);
  const [view, setView] = useState<View>({ kind: 'auto' });
  const state = team.data;

  if (view.kind === 'done') {
    return (
      <SetupDone
        project={project}
        result={view.result}
        onShowTeam={() => setView({ kind: 'auto' })}
        onBoard={() => navigate({ page: 'pano', task: null, plan: null })}
      />
    );
  }
  if (team.isPending) return <Card className="h-64 animate-pulse" aria-busy />;
  if (team.isError || !state) {
    return (
      <Notice
        action={
          <Button icon={RotateCcw} onClick={() => void team.refetch()}>
            Yeniden dene
          </Button>
        }
      >
        Ekip okunamadı: {team.error?.message}
      </Notice>
    );
  }

  const installed = (result: InstallResult) => setView({ kind: 'done', result });

  if (state.status === 'missing' || view.kind === 'setup') {
    return (
      <SetupTeam
        project={project}
        state={state}
        onInstalled={installed}
        onCancel={state.status === 'missing' ? undefined : () => setView({ kind: 'auto' })}
      />
    );
  }

  if (state.status === 'invalid') {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Ekip</h1>
          <p className="mt-2 text-lg text-muted">Ekip dosyaları okunamadı.</p>
        </div>
        <Notice>
          <span className="block">{state.error}</span>
        </Notice>
        <p className="text-muted">
          Dosyayı düzelttiysen yeniden oku. O zamana kadar görevler varsayılan ajanla çalışır.
          İstersen şablonu yeniden kurabilirsin; içeriği farklı dosyaların üzerine yazmadan önce
          sorulur.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            icon={RotateCcw}
            loading={team.isFetching}
            onClick={() => void team.refetch()}
          >
            Yeniden oku
          </Button>
          <Button variant="secondary" onClick={() => setView({ kind: 'setup' })}>
            Şablonu yeniden kur
          </Button>
        </div>
      </div>
    );
  }

  return (
    <TeamMembers
      project={project}
      team={state.team}
      onReinstall={() => setView({ kind: 'setup' })}
    />
  );
}

/** Step 1 of the setup when there is no project yet. */
function PickFolder() {
  const setProjectId = useUi((s) => s.setProjectId);
  return (
    <div className="flex flex-col gap-6">
      <Steps current={1} steps={[{ label: 'Klasör' }, { label: 'Ekip' }, { label: 'Hazır' }]} />
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Ekibini kur</h1>
        <p className="mt-2 text-lg text-muted">Önce ekibin çalışacağı proje klasörünü seç.</p>
      </div>
      <Card padding="lg" className="flex max-w-3xl flex-col gap-5">
        <span
          aria-hidden
          className="inline-flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"
        >
          <FolderGit2 className="size-7" />
        </span>
        <AddProjectForm onAdded={(p) => setProjectId(p.id)} />
        <p className="text-sm text-muted">
          Bir git deposu olmalı. Henüz commit'i yoksa da olur: ekibi kurabilirsin, görevler ilk
          commit'ten sonra başlar.
        </p>
      </Card>
    </div>
  );
}
