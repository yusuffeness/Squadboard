import {
  ArrowLeft,
  Clock,
  FileText,
  Play,
  RotateCcw,
  Square,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import type { TaskView } from '../api';
import { CleanupDialog } from '../components/CleanupDialog';
import { EventLine } from '../EventLine';
import { STARTABLE, formatDuration, formatUsd } from '../format';
import { agentName, useAgents } from '../lib/agents';
import { taskLook } from '../lib/board';
import { useApi, useLiveTask, useTaskActions } from '../lib/queries';
import { navigate } from '../lib/router';
import { useRunStream } from '../lib/run-streams';
import { useUi } from '../lib/store';
import { AgentAvatar } from '../ui/AgentAvatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ErrorMessage } from '../ui/ErrorMessage';
import { DarkLogPanel } from '../ui/DarkLogPanel';
import { StatusPill } from '../ui/Pill';
import { ProgressBar } from '../ui/ProgressBar';
import { Segmented } from '../ui/Tabs';
import { TONE } from '../ui/tones';

type Tab = 'logs' | 'files' | 'summary';

/** Agent detail (v2-04): task list on the left, live output with Loglar / Dosyalar / Özet. */
export function TaskDetail({ task, tasks }: { task: TaskView; tasks: readonly TaskView[] }) {
  const mode = useUi((s) => s.nameMode);
  const agent = useAgents().byId(task.agent);
  const name = agentName(agent, mode);
  const look = taskLook(task);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          icon={ArrowLeft}
          onClick={() => navigate({ task: null })}
          className="-ml-3"
        >
          Pano
        </Button>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">{name}</h1>
        <p className="mt-2 text-lg text-muted">
          {task.active
            ? `Şu an “${task.title}” üzerinde çalışıyor`
            : `“${task.title}” · ${look.label}`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <TaskList tasks={tasks} selectedId={task.id} />
          <ProgressCard task={task} />
        </div>
        <OutputPanel task={task} />
      </div>
    </div>
  );
}

function TaskList({ tasks, selectedId }: { tasks: readonly TaskView[]; selectedId: string }) {
  const mode = useUi((s) => s.nameMode);
  const agents = useAgents();
  return (
    <Card padding="sm" as="section" aria-label="Görevler">
      <ul className="flex flex-col gap-1">
        {tasks.map((t) => {
          const agent = agents.byId(t.agent);
          const look = taskLook(t);
          const selected = t.id === selectedId;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => navigate({ task: t.id })}
                aria-current={selected || undefined}
                className={`flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 text-left ${
                  selected ? 'bg-surface shadow-card ring-1 ring-line' : 'hover:bg-sand/60'
                }`}
              >
                <AgentAvatar agent={agent} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-bold">{agentName(agent, mode)}</span>
                  <span className="block truncate text-sm text-muted">{t.title}</span>
                </span>
                <span
                  aria-hidden
                  className={`size-2.5 shrink-0 rounded-full ${TONE[look.tone].dot}`}
                />
                <span className="sr-only">{look.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Real numbers only: the CLI gives no percentage, so the bar is indeterminate while running. */
function ProgressCard({ task }: { task: TaskView }) {
  const run = task.latestRun;
  return (
    <Card as="section" aria-labelledby="progress-title" padding="lg">
      <h2 id="progress-title" className="text-sm font-bold tracking-wider text-muted uppercase">
        İlerleme
      </h2>
      <p className="mt-2 text-3xl font-extrabold">
        {task.active ? 'Sürüyor' : run ? taskLook(task).label : 'Başlamadı'}
      </p>
      {(task.active || task.status === 'in_review' || task.status === 'done') && (
        <div className="mt-4">
          {/* Full only once the work is really finished; never a made-up percentage. */}
          <ProgressBar value={task.active ? null : 100} label="İlerleme" />
        </div>
      )}
      {run && (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 text-muted">
          <Clock aria-hidden className="size-4" />
          {formatDuration(run.startedAt, run.endedAt)}
          {run.costUsd !== null && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono">{formatUsd(run.costUsd)}</span>
            </>
          )}
          {run.numTurns !== null && (
            <>
              <span aria-hidden>·</span>
              {run.numTurns} tur
            </>
          )}
        </p>
      )}
    </Card>
  );
}

function OutputPanel({ task }: { task: TaskView }) {
  const api = useApi();
  const mode = useUi((s) => s.nameMode);
  const agent = useAgents().byId(task.agent);
  const look = taskLook(task);
  const [tab, setTab] = useState<Tab>('logs');
  const [cleaning, setCleaning] = useState(false);
  const actions = useTaskActions(task.projectId);
  useLiveTask(task); // refreshes the board when this run ends
  const runId = task.latestRun?.id ?? null;
  // Shared with the board card; replays stored events, then follows live ones.
  const stream = useRunStream(runId, runId ? api.eventsUrl(runId) : null);
  const canStart = !task.active && STARTABLE.includes(task.status);
  const error = actions.start.error ?? actions.stop.error;

  const header = (
    <div className="flex flex-wrap items-center gap-4">
      <AgentAvatar agent={agent} size="lg" />
      <div className="min-w-0 flex-1">
        <h2 className="text-2xl font-extrabold">{agentName(agent, mode)}</h2>
        <p className="truncate text-console-muted">
          {task.title}
          {task.branch && (
            <>
              {' · '}
              <span className="font-mono text-console-ink">{task.branch}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={look.tone} label={look.label} />
        {task.active && (
          <Button
            variant="danger"
            icon={Square}
            loading={actions.stop.isPending}
            onClick={() => actions.stop.mutate(task.id)}
          >
            Durdur
          </Button>
        )}
        {canStart && (
          <Button
            variant="primary"
            icon={task.latestRun ? RotateCcw : Play}
            loading={actions.start.isPending}
            onClick={() => actions.start.mutate(task.id)}
          >
            {task.latestRun ? 'Yeniden başlat' : 'Başlat'}
          </Button>
        )}
        {!task.active && task.worktreePath && (
          <Button variant="danger" icon={Trash2} onClick={() => setCleaning(true)}>
            Temizle
          </Button>
        )}
      </div>
      {error && <ErrorMessage error={error} tone="dark" className="w-full" />}
    </div>
  );

  const tabs = (
    <Segmented<Tab>
      kind="tabs"
      dark
      idPrefix="output"
      label="Çıktı görünümü"
      value={tab}
      onChange={setTab}
      items={[
        { id: 'logs', label: 'Loglar' },
        { id: 'files', label: `Dosyalar · ${task.changedFiles.length}` },
        { id: 'summary', label: 'Özet' },
      ]}
    />
  );

  return (
    <>
      <DarkLogPanel
        header={header}
        toolbar={tabs}
        followKey={stream.events.length}
        label="Ajan çıktısı"
      >
        <div role="tabpanel" id={`output-panel-${tab}`} aria-labelledby={`output-tab-${tab}`}>
          {tab === 'logs' && <Logs task={task} events={stream.events} />}
          {tab === 'files' && <Files task={task} />}
          {tab === 'summary' && <Summary task={task} events={stream.events} />}
        </div>
      </DarkLogPanel>
      <CleanupDialog task={task} open={cleaning} onClose={() => setCleaning(false)} />
    </>
  );
}

type Events = ReturnType<typeof useRunStream>['events'];

function Logs({ task, events }: { task: TaskView; events: Events }) {
  if (!task.latestRun)
    return <p className="text-console-muted">Henüz çalışmadı. Başlat'a bas, çıktı burada akar.</p>;
  if (events.length === 0)
    return (
      <p className="text-console-muted">{task.active ? 'Ajan başlıyor…' : 'Kayıtlı çıktı yok.'}</p>
    );
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite" aria-relevant="additions">
      {events.map(({ seq, event }) => (
        <EventLine key={seq} event={event} />
      ))}
    </div>
  );
}

function Files({ task }: { task: TaskView }) {
  if (task.changedFiles.length === 0)
    return (
      <p className="text-console-muted">
        {task.active ? 'Dosyalar iş bitince sayılır.' : 'Değişen dosya yok.'}
      </p>
    );
  const unexpected = new Set(task.unexpectedFiles);
  return (
    <ul className="flex flex-col gap-2">
      {task.changedFiles.map((file) => (
        <li key={file} className="flex items-center gap-3 break-all">
          {unexpected.has(file) ? (
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-console-warn" />
          ) : (
            <FileText aria-hidden className="size-4 shrink-0 text-console-muted" />
          )}
          <span>{file}</span>
          {unexpected.has(file) && (
            <span className="font-sans text-console-warn">beklenmiyordu</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Plain facts until the reviewer writes real summaries: the agent's last message and the result. */
function Summary({ task, events }: { task: TaskView; events: Events }) {
  const run = task.latestRun;
  const lastText = [...events].reverse().find((e) => e.event.kind === 'text');
  if (!run) return <p className="text-console-muted">Özet, iş çalıştıktan sonra burada.</p>;
  return (
    <div className="flex flex-col gap-4 font-sans text-base">
      {lastText?.event.kind === 'text' ? (
        <p className="whitespace-pre-wrap">{lastText.event.text}</p>
      ) : (
        <p className="text-console-muted">
          {task.active ? 'Ajan henüz bir şey yazmadı.' : 'Ajan mesaj bırakmadı.'}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-console-muted">
        <dt>Süre</dt>
        <dd className="text-console-ink">{formatDuration(run.startedAt, run.endedAt)}</dd>
        <dt>Maliyet</dt>
        <dd className="font-mono text-console-ink">
          {run.costUsd !== null ? formatUsd(run.costUsd) : '—'}
        </dd>
        <dt>Değişen dosya</dt>
        <dd className="text-console-ink">{task.changedFiles.length}</dd>
      </dl>
      {run.error && <p className="text-console-danger">{run.error}</p>}
      {task.gitError && (
        <ErrorMessage error={task.gitError} detail={task.gitErrorDetail} tone="dark" />
      )}
    </div>
  );
}
