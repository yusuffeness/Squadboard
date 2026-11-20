import type { ProjectSettings } from '@squadboard/core';
import {
  ArrowRight,
  Check,
  CircleAlert,
  Folder,
  LayoutGrid,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  ApiError,
  type InstallResult,
  type ProjectView,
  type TeamState,
  type TemplateView,
} from '../../api';
import { projectName } from '../../format';
import { agentName, fromAgentView } from '../../lib/agents';
import { useChecks, useInstallTeam, useTemplates } from '../../lib/queries';
import { useUi } from '../../lib/store';
import { AgentAvatar } from '../../ui/AgentAvatar';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Dialog } from '../../ui/Dialog';
import { ErrorMessage } from '../../ui/ErrorMessage';
import { OptionCard } from '../../ui/OptionCard';
import { Steps } from './Steps';
import { TeamSettingsForm } from './TeamSettingsForm';

/**
 * "Ekibini kur" (v2-07): pick a template and its members, set the team settings, check the
 * folder, then write `.team/` and `.claude/agents/` into the project. Nothing is committed.
 */
export function SetupTeam({
  project,
  state,
  onInstalled,
  onCancel,
}: {
  project: ProjectView;
  state: TeamState;
  onInstalled: (result: InstallResult) => void;
  /** Shown when the project already has a team (re-installing). */
  onCancel?: (() => void) | undefined;
}) {
  const templates = useTemplates();
  const list = templates.data ?? [];
  const current = state.status === 'ok' ? state.team : null;
  const [templateId, setTemplateId] = useState<string | null>(null);
  const template =
    list.find((t) => t.id === templateId) ??
    list.find((t) => t.id === current?.id) ??
    list.find((t) => t.id === 'fullstack-web') ??
    list[0];

  if (templates.isPending) {
    return <Frame project={project}>{<Card className="h-64 animate-pulse" aria-busy />}</Frame>;
  }
  if (templates.isError) {
    return (
      <Frame project={project}>
        <ErrorMessage error={templates.error} prefix="Şablonlar yüklenemedi:" />
      </Frame>
    );
  }
  if (!template) {
    return (
      <Frame project={project}>
        <ErrorMessage error="Hiç şablon bulunamadı (templates/ klasörü boş)." />
      </Frame>
    );
  }
  return (
    <Frame project={project}>
      {/* Remount per template so its members and settings start from the template's defaults. */}
      <TemplateForm
        key={template.id}
        project={project}
        templates={list}
        template={template}
        current={current?.id === template.id ? current : null}
        onTemplate={setTemplateId}
        hasTeam={state.status !== 'missing'}
        onInstalled={onInstalled}
        onCancel={onCancel}
      />
    </Frame>
  );
}

function Frame({ project, children }: { project: ProjectView; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <Steps
        current={2}
        steps={[
          { label: 'Klasör', hint: projectName(project.path) },
          { label: 'Ekip' },
          { label: 'Hazır' },
        ]}
      />
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Ekibini kur</h1>
        <p className="mt-2 text-lg text-muted">Hangi ajanlar bu projede çalışsın?</p>
      </div>
      {children}
    </div>
  );
}

function TemplateForm({
  project,
  templates,
  template,
  current,
  onTemplate,
  hasTeam,
  onInstalled,
  onCancel,
}: {
  project: ProjectView;
  templates: readonly TemplateView[];
  template: TemplateView;
  /** The project's installed team when it uses this template (start from its choices). */
  current: { settings: ProjectSettings; agents: { id: string; enabled: boolean }[] } | null;
  onTemplate: (id: string) => void;
  hasTeam: boolean;
  onInstalled: (result: InstallResult) => void;
  onCancel: (() => void) | undefined;
}) {
  const mode = useUi((s) => s.nameMode);
  const [enabled, setEnabled] = useState<Set<string>>(
    () =>
      new Set(
        current
          ? current.agents.filter((a) => a.enabled).map((a) => a.id)
          : template.agents.map((a) => a.id),
      ),
  );
  const [settings, setSettings] = useState<ProjectSettings>(current?.settings ?? template.settings);
  const install = useInstallTeam(project.id);
  // Kept apart from the mutation: resetting a mutation while it runs drops its callbacks.
  const [conflicts, setConflicts] = useState<string[]>([]);
  const isConflict = install.error instanceof ApiError && install.error.status === 409;

  function toggle(id: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(overwrite: boolean) {
    install.mutate(
      {
        templateId: template.id,
        agents: template.agents.filter((a) => enabled.has(a.id)).map((a) => a.id),
        settings,
        overwrite,
      },
      {
        onSuccess: onInstalled,
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) setConflicts(err.conflicts);
        },
      },
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {templates.length > 1 && (
          <Card as="section" padding="lg" aria-labelledby="tpl-heading">
            <h2 id="tpl-heading" className="mb-4 text-xl font-extrabold">
              Şablon
            </h2>
            <div
              role="radiogroup"
              aria-labelledby="tpl-heading"
              className="grid gap-3 sm:grid-cols-2"
            >
              {templates.map((t) => (
                <OptionCard
                  key={t.id}
                  icon={t.agents.length > 3 ? LayoutGrid : Users}
                  label={t.name}
                  hint={`${t.agents.length} ajan · ${t.description ?? ''}`}
                  selected={t.id === template.id}
                  onSelect={() => onTemplate(t.id)}
                />
              ))}
            </div>
          </Card>
        )}

        <Card as="section" padding="lg" aria-labelledby="members-heading">
          <h2 id="members-heading" className="mb-4 text-xl font-extrabold">
            Ekip üyeleri
          </h2>
          <div
            role="group"
            aria-labelledby="members-heading"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {template.agents.map((a) => {
              const meta = fromAgentView(a);
              return (
                <OptionCard
                  key={a.id}
                  role="checkbox"
                  leading={<AgentAvatar agent={meta} size="lg" />}
                  label={agentName(meta, mode)}
                  hint={a.description}
                  selected={enabled.has(a.id)}
                  onSelect={() => toggle(a.id)}
                />
              );
            })}
          </div>
          {enabled.size === 0 && (
            <p role="status" className="mt-3 font-semibold text-warn">
              En az bir ajan seç.
            </p>
          )}
        </Card>

        <Card as="section" padding="lg" aria-labelledby="settings-heading">
          <h2 id="settings-heading" className="mb-2 text-xl font-extrabold">
            Ayarlar
          </h2>
          <TeamSettingsForm
            value={settings}
            onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
          />
        </Card>
      </div>

      <div className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
        <ChecksCard project={project} />
        {hasTeam && (
          <p className="flex gap-2 text-sm text-muted">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            Bu projede zaten ekip dosyaları var. İçeriği farklı olanların üzerine yazmadan önce
            sorulur.
          </p>
        )}
        {install.isError && !isConflict && (
          <ErrorMessage error={install.error} prefix="Kurulamadı:" />
        )}
        <Button
          variant="primary"
          size="lg"
          trailingIcon={ArrowRight}
          loading={install.isPending}
          disabled={enabled.size === 0}
          onClick={() => submit(false)}
          className="w-full"
        >
          Ekibi kur
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} className="w-full">
            Vazgeç
          </Button>
        )}
      </div>

      <Dialog
        open={conflicts.length > 0}
        onClose={() => setConflicts([])}
        title="Dosyalar zaten var"
        description="Bu dosyaların içeriği şablondan farklı. Üzerine yazılsın mı?"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConflicts([])}>
              Vazgeç
            </Button>
            <Button
              variant="danger"
              loading={install.isPending}
              onClick={() => {
                setConflicts([]);
                submit(true);
              }}
            >
              Üzerine yaz
            </Button>
          </div>
        }
      >
        <ul className="flex flex-col gap-1 font-mono text-sm">
          {conflicts.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
        <p className="text-muted">
          Elle yaptığın değişiklikler kaybolur. Saklamak istiyorsan önce commit'le.
        </p>
      </Dialog>
    </div>
  );
}

/** Folder card with the checklist (v2-07, right column). Only what the server really checked. */
function ChecksCard({ project }: { project: ProjectView }) {
  const checks = useChecks(project.id);
  const c = checks.data;
  return (
    <Card padding="lg" aria-busy={checks.isPending || undefined}>
      <p className="flex items-center gap-3 font-extrabold">
        <Folder aria-hidden className="size-5 shrink-0" />
        <span className="truncate">{projectName(project.path)}</span>
      </p>
      <p className="mt-1 font-mono text-sm break-all text-muted">{project.path}</p>
      {checks.isError && (
        <ErrorMessage error={checks.error} prefix="Kontrol edilemedi:" className="mt-3" />
      )}
      <ul className="mt-4 flex flex-col">
        <CheckRow
          ok={c?.isRepo}
          label={c?.isRepo === false ? 'Git deposu değil' : 'Git deposu bulundu'}
          value={c?.mainBranch}
          mono
        />
        <CheckRow
          ok={c?.hasCommits}
          label={c?.hasCommits === false ? 'Henüz commit yok' : 'İlk commit var'}
          note={
            c?.hasCommits === false
              ? 'Ekibi kurabilirsin; görevler ilk committen sonra başlar.'
              : undefined
          }
        />
        <CheckRow
          ok={c?.claude.ok}
          label={c?.claude.ok === false ? 'Claude Code bulunamadı' : 'Claude Code kurulu'}
          value={c?.claude.version ? `v${c.claude.version}` : undefined}
        />
        <CheckRow
          ok={c ? c.changes === 0 : undefined}
          label={c && c.changes !== 0 ? 'Çalışma ağacında değişiklik var' : 'Çalışma ağacı temiz'}
          value={
            c?.changes !== null && c?.changes !== undefined ? `${c.changes} değişiklik` : undefined
          }
          note={
            c && c.changes !== null && c.changes > 0
              ? 'Ajanlar commitlenmemiş değişiklikleri görmez.'
              : undefined
          }
        />
      </ul>
    </Card>
  );
}

function CheckRow({
  ok,
  label,
  value,
  note,
  mono = false,
}: {
  /** undefined while loading. */
  ok: boolean | undefined;
  label: string;
  value?: string | undefined;
  note?: string | undefined;
  mono?: boolean;
}) {
  const Icon: LucideIcon = ok === false ? CircleAlert : Check;
  return (
    <li className="flex items-start gap-3 border-b border-line py-3 last:border-b-0">
      <span
        aria-hidden
        className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full ${
          ok === undefined
            ? 'bg-sand text-faint'
            : ok
              ? 'bg-success-soft text-success'
              : 'bg-warn-soft text-warn'
        }`}
      >
        <Icon className="size-4" strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-bold">
            {label}
            <span className="sr-only">
              : {ok === undefined ? 'kontrol ediliyor' : ok ? 'tamam' : 'dikkat'}
            </span>
          </span>
          {value && (
            <span className={`text-sm text-muted ${mono ? 'font-mono' : ''}`}>{value}</span>
          )}
        </span>
        {note && <span className="block text-sm text-muted">{note}</span>}
      </span>
    </li>
  );
}

/** Step 3: what was written, and the commit we leave to the user. */
export function SetupDone({
  project,
  result,
  onShowTeam,
  onBoard,
}: {
  project: ProjectView;
  result: InstallResult;
  onShowTeam: () => void;
  onBoard: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Steps
        current={3}
        steps={[
          { label: 'Klasör', hint: projectName(project.path) },
          { label: 'Ekip' },
          { label: 'Hazır' },
        ]}
      />
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Ekibin hazır.</h1>
        <p className="mt-2 text-lg text-muted">
          Ekip dosyaları projene yazıldı. Ajanlar bir sonraki görevden itibaren bu tanımlarla
          çalışır.
        </p>
      </div>
      <Card padding="lg" className="flex flex-col gap-4">
        {result.written.length > 0 && <FileList title="Yazılan dosyalar" files={result.written} />}
        {result.unchanged.length > 0 && (
          <FileList title="Zaten aynıydı, dokunulmadı" files={result.unchanged} />
        )}
        <div className="rounded-tile bg-sand p-4">
          <p className="font-bold">Commit'lemeyi unutma</p>
          <p className="mt-1 text-muted">
            Squadboard senin dalına commit atmaz. Ekibin projede kalsın ve başka bilgisayarda da
            aynı çalışsın diye kendin commit'le:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-console p-4 font-mono text-sm text-console-ink">
            {'git add .team .claude/agents\ngit commit -m "Squadboard ekibini ekle"'}
          </pre>
        </div>
      </Card>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" icon={Users} onClick={onShowTeam}>
          Ekibi gör
        </Button>
        <Button variant="secondary" onClick={onBoard}>
          Panoya git
        </Button>
      </div>
    </div>
  );
}

function FileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div>
      <h2 className="font-bold">{title}</h2>
      <ul className="mt-2 flex flex-col gap-1 font-mono text-sm text-muted">
        {files.map((f) => (
          <li key={f} className="break-all">
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
