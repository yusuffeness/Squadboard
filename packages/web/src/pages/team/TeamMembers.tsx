import type { AGENT_MODELS as CoreModels } from '@squadboard/core';
import { Pencil, RefreshCw, X } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { AgentPatch, AgentView, ProjectView, TeamView } from '../../api';
import { agentName, fromAgentView } from '../../lib/agents';
import { useUpdateAgent, useUpdateTeamSettings } from '../../lib/queries';
import { useUi } from '../../lib/store';
import { AgentAvatar } from '../../ui/AgentAvatar';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ErrorMessage } from '../../ui/ErrorMessage';
import { Pill } from '../../ui/Pill';
import { Switch } from '../../ui/Switch';
import { Segmented } from '../../ui/Tabs';
import { TeamSettingsForm } from './TeamSettingsForm';

/**
 * "Ekip" (v2-11): the project's agents from `.team/`, each with an on/off switch and an edit
 * panel (name, instructions, model). Saving writes `.team/team.json` and the agent's
 * `.claude/agents/*.md` in the project folder.
 */
export function TeamMembers({
  project,
  team,
  onReinstall,
}: {
  project: ProjectView;
  team: TeamView;
  onReinstall: () => void;
}) {
  const mode = useUi((s) => s.nameMode);
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const update = useUpdateAgent(project.id);
  const settings = useUpdateTeamSettings(project.id);
  const editingAgent = team.agents.find((a) => a.id === editing) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Ekip</h1>
          <p className="mt-2 text-lg text-muted">Ajanlarını aç, kapat ya da özelleştir</p>
        </div>
        <Button variant="secondary" icon={RefreshCw} onClick={onReinstall}>
          Şablonu yeniden kur
        </Button>
      </div>

      {saved && (
        <p role="status" className="font-semibold text-success">
          Kaydedildi: <span className="font-mono">{saved}</span>
        </p>
      )}
      {update.isError && <ErrorMessage error={update.error} prefix="Kaydedilemedi:" />}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <ul
          aria-label="Ajanlar"
          className="grid grid-cols-1 content-start gap-4 self-start lg:grid-cols-2"
        >
          {team.agents.map((agent) => {
            const meta = fromAgentView(agent);
            const name = agentName(meta, mode);
            const selected = agent.id === editing;
            return (
              <Card
                as="li"
                key={agent.id}
                padding="lg"
                data-agent={agent.id}
                className={`flex flex-col gap-4 transition-colors ${
                  selected ? 'outline-2 outline-ink' : ''
                } ${agent.enabled ? '' : 'opacity-70'}`}
              >
                <div className="flex items-start gap-4">
                  <AgentAvatar agent={meta} size="lg" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-xl font-extrabold">{name}</h2>
                    <p className="text-muted">
                      {mode === 'simple'
                        ? `Teknik: ${agent.names.tech}`
                        : `Sade: ${agent.names.friendly}`}
                    </p>
                  </div>
                  <Switch
                    checked={agent.enabled}
                    label={`${name} açık`}
                    disabled={update.isPending}
                    onChange={(enabled) => {
                      setSaved(null);
                      update.mutate({ agentId: agent.id, patch: { enabled } });
                    }}
                  />
                </div>
                <p>{agent.description}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill>{agent.model ?? 'varsayılan model'}</Pill>
                  <Pill>{agent.readOnly ? 'Salt okuma' : 'Yazma'}</Pill>
                  <Pill>${agent.budgetUsd} sınır</Pill>
                  <Button
                    variant="ghost"
                    icon={Pencil}
                    className="ml-auto"
                    aria-label={`${name} ajanını düzenle`}
                    aria-expanded={selected}
                    onClick={() => {
                      setSaved(null);
                      update.reset();
                      setEditing(selected ? null : agent.id);
                    }}
                  >
                    Düzenle
                  </Button>
                </div>
              </Card>
            );
          })}
        </ul>

        <div className="order-first flex flex-col gap-6 xl:order-none">
          {editingAgent && (
            <EditPanel
              // Remount when another agent is picked, so the form starts from its values.
              key={editingAgent.id}
              agent={editingAgent}
              saving={update.isPending}
              onCancel={() => setEditing(null)}
              onSave={(patch) =>
                update.mutate(
                  { agentId: editingAgent.id, patch },
                  {
                    onSuccess: () => {
                      setEditing(null);
                      setSaved(`.claude/agents/${editingAgent.file}`);
                    },
                  },
                )
              }
            />
          )}
          <Card as="section" padding="lg" aria-labelledby="team-settings-heading">
            <h2 id="team-settings-heading" className="text-xl font-extrabold">
              Ekip ayarları
            </h2>
            <p className="mb-2 text-sm text-muted">{team.name}</p>
            <TeamSettingsForm
              value={team.settings}
              disabled={settings.isPending}
              onChange={(patch) => settings.mutate(patch)}
            />
            {settings.isError && <ErrorMessage error={settings.error} prefix="Kaydedilemedi:" />}
          </Card>
        </div>
      </div>

      <p className="text-sm text-muted">
        Değişiklikler projendeki <code className="font-mono">.team/team.json</code> ve{' '}
        <code className="font-mono">.claude/agents/</code> dosyalarına yazılır. Ajanlar onları senin
        klasöründen okur; ekibin başka bilgisayarda da aynı olsun diye commit'le.
      </p>
    </div>
  );
}

/** Same list as core's AGENT_MODELS (web takes only types from core). */
const AGENT_MODELS: typeof CoreModels = ['haiku', 'sonnet', 'opus'];

type ModelChoice = (typeof AGENT_MODELS)[number] | 'custom' | 'default';

function EditPanel({
  agent,
  saving,
  onSave,
  onCancel,
}: {
  agent: AgentView;
  saving: boolean;
  onSave: (patch: AgentPatch) => void;
  onCancel: () => void;
}) {
  const [tech, setTech] = useState(agent.names.tech);
  const [friendly, setFriendly] = useState(agent.names.friendly);
  const [prompt, setPrompt] = useState(agent.prompt);
  const known = (AGENT_MODELS as readonly string[]).includes(agent.model ?? '');
  const [model, setModel] = useState<ModelChoice>(
    agent.model === null ? 'default' : known ? (agent.model as ModelChoice) : 'custom',
  );
  const id = useId();
  const headingId = `${id}-heading`;

  function submit(e: FormEvent) {
    e.preventDefault();
    const patch: AgentPatch = {};
    const names: { tech?: string; friendly?: string } = {};
    if (tech.trim() !== agent.names.tech) names.tech = tech.trim();
    if (friendly.trim() !== agent.names.friendly) names.friendly = friendly.trim();
    if (Object.keys(names).length > 0) patch.names = names;
    if (prompt.trim() !== agent.prompt) patch.prompt = prompt.trim();
    if (model === 'default' && agent.model !== null) patch.model = null;
    else if (model !== 'default' && model !== 'custom' && model !== agent.model)
      patch.model = model;
    if (Object.keys(patch).length === 0) onCancel();
    else onSave(patch);
  }

  const items: { id: ModelChoice; label: string }[] = AGENT_MODELS.map((m) => ({
    id: m,
    label: m,
  }));
  if (!known && agent.model) items.push({ id: 'custom', label: agent.model });

  return (
    <Card as="section" padding="lg" aria-labelledby={headingId} className="shadow-pop">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <AgentAvatar agent={fromAgentView(agent)} />
          <h2 id={headingId} className="min-w-0 flex-1 text-xl font-extrabold">
            Düzenle: {agent.names.tech}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Kapat"
            className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-sand"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <Field id={`${id}-tech`} label="Ad">
          <input
            id={`${id}-tech`}
            value={tech}
            maxLength={40}
            required
            onChange={(e) => setTech(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field id={`${id}-friendly`} label="Sade ad">
          <input
            id={`${id}-friendly`}
            value={friendly}
            maxLength={40}
            required
            onChange={(e) => setFriendly(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field id={`${id}-prompt`} label="Talimat" hint={`.claude/agents/${agent.file}`}>
          <textarea
            id={`${id}-prompt`}
            value={prompt}
            required
            rows={10}
            onChange={(e) => setPrompt(e.target.value)}
            className={`${INPUT} min-h-48 py-3 leading-relaxed`}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">Model</span>
          <Segmented
            label="Model"
            kind="choice"
            items={[...items, { id: 'default', label: 'Varsayılan' }]}
            value={model}
            onChange={setModel}
            className="self-start"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" loading={saving}>
            Kaydet
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Vazgeç
          </Button>
        </div>
      </form>
    </Card>
  );
}

const INPUT =
  'min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none focus-visible:outline-none';

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-bold"
      >
        {label}
        {hint && <span className="font-mono text-xs font-normal text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
