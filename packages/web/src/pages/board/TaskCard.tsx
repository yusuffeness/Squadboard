import {
  CircleCheck,
  CircleHelp,
  Clock,
  File,
  GitBranch,
  Play,
  RotateCcw,
  Square,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { TaskView } from '../../api';
import { STARTABLE, summarizeToolInput } from '../../format';
import { useAgents } from '../../lib/agents';
import { taskLook } from '../../lib/board';
import { blockedLine } from '../../lib/plan';
import { useLiveTask, useTaskActions } from '../../lib/queries';
import { navigate } from '../../lib/router';
import { useUi } from '../../lib/store';
import { AgentChip } from '../../ui/AgentAvatar';
import { Button } from '../../ui/Button';
import { ErrorMessage } from '../../ui/ErrorMessage';
import { StatusPill } from '../../ui/Pill';
import { ProgressBar } from '../../ui/ProgressBar';

/** One task on the board (v2-01 cards): agent, title, branch, files, progress, actions. */
export function TaskCard({ task, all }: { task: TaskView; all: readonly TaskView[] }) {
  const mode = useUi((s) => s.nameMode);
  const agents = useAgents();
  const agent = agents.byId(task.agent);
  const look = taskLook(task);
  const actions = useTaskActions(task.projectId);
  const stream = useLiveTask(task);
  const canStart = !task.active && STARTABLE.includes(task.status);
  const error = actions.start.error ?? actions.stop.error;

  const waiting = blockedLine(task, all);

  // Latest thing the agent did, from the live stream (real data, no invented progress).
  const lastTool = [...stream.events].reverse().find((e) => e.event.kind === 'tool_use');
  const doing =
    lastTool?.event.kind === 'tool_use'
      ? `${lastTool.event.name} ${summarizeToolInput(lastTool.event.input)}`
      : null;

  return (
    <article
      data-testid="task-card"
      style={{ borderLeftColor: agent.color }}
      className={`flex flex-col gap-3 rounded-tile border border-l-4 border-line bg-surface p-4 shadow-card ${
        task.status === 'failed' && !task.active ? 'ring-1 ring-danger/30' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AgentChip agent={agent} mode={mode} />
        {task.status === 'done' && !task.active ? (
          <CircleCheck aria-label="Bitti" className="size-6 text-success" />
        ) : (
          <StatusPill tone={look.tone} label={look.label} />
        )}
      </div>

      <h3 className="text-lg leading-snug font-extrabold">
        <button
          type="button"
          onClick={() => navigate({ task: task.id })}
          className="text-left hover:text-accent focus-visible:text-accent"
        >
          {task.title}
        </button>
      </h3>

      <ul className="flex flex-col gap-1.5 text-sm text-muted empty:hidden">
        {waiting && (
          <Meta
            icon={waiting.tone === 'muted' ? Clock : TriangleAlert}
            {...(waiting.tone === 'muted' ? {} : { tone: waiting.tone })}
          >
            {waiting.text}
          </Meta>
        )}
        {task.interrupted && !task.active && (
          <Meta icon={TriangleAlert} tone="warn">
            Squadboard kapandığı için yarıda kesildi
          </Meta>
        )}
        {task.status === 'waiting_decision' && !task.active && (
          <Meta icon={CircleHelp}>Ajan durdu, senden cevap bekliyor</Meta>
        )}
        {task.branch && (
          <Meta icon={GitBranch}>
            <span className="block truncate font-mono" title={task.branch}>
              {task.branch}
            </span>
          </Meta>
        )}
        {task.changedFiles.length > 0 && (
          <Meta icon={File}>{task.changedFiles.length} dosya değişti</Meta>
        )}
        {task.unexpectedFiles.length > 0 && (
          <Meta icon={TriangleAlert} tone="warn">
            {task.unexpectedFiles.length} beklenmeyen dosya
          </Meta>
        )}
        {task.gitError && (
          <Meta icon={TriangleAlert} tone="danger">
            {task.gitError}
          </Meta>
        )}
        {task.active && doing && (
          <li className="truncate font-mono text-xs text-muted" title={doing}>
            ▸ {doing}
          </li>
        )}
      </ul>

      {task.active && <ProgressBar value={null} label={`${task.title} sürüyor`} />}

      {error && <ErrorMessage error={error} className="text-sm" />}

      <div className="flex flex-wrap gap-2">
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
            variant={task.latestRun ? 'secondary' : 'primary'}
            icon={task.latestRun ? RotateCcw : Play}
            loading={actions.start.isPending}
            onClick={() => actions.start.mutate(task.id)}
          >
            {task.latestRun
              ? task.status === 'failed'
                ? 'Yeniden dene'
                : 'Yeniden başlat'
              : 'Başlat'}
          </Button>
        )}
        {(task.latestRun || task.status === 'in_review') && (
          <Button variant="ghost" onClick={() => navigate({ task: task.id })}>
            {task.status === 'in_review' ? 'İncele' : 'Detay'}
          </Button>
        )}
      </div>
    </article>
  );
}

function Meta({
  icon: Icon,
  tone,
  children,
}: {
  icon: typeof Clock;
  tone?: 'warn' | 'danger';
  children: ReactNode;
}) {
  return (
    <li
      className={`flex items-start gap-2 ${tone === 'warn' ? 'font-semibold text-warn' : tone === 'danger' ? 'font-semibold text-danger' : ''}`}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}
