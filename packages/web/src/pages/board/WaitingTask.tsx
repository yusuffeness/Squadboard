import { ArrowRight, Info, Play, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import type { PermissionAction, PermissionView, QuestionView, TaskView } from '../../api';
import { EventLine } from '../../EventLine';
import {
  MAX_QUIET_ROUNDS,
  answersOf,
  decisionAnchor,
  pendingLabel,
  permissionLine,
  permissionVerb,
  pick,
  unansweredQuestions,
  type Draft,
} from '../../lib/decision';
import { agentName, useAgents, type AgentMeta } from '../../lib/agents';
import { useApi, useDecisionActions } from '../../lib/queries';
import { useRunStream } from '../../lib/run-streams';
import { useUi } from '../../lib/store';
import { AgentAvatar } from '../../ui/AgentAvatar';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ErrorMessage } from '../../ui/ErrorMessage';
import { Notice } from '../../ui/Notice';
import { Pill, StatusPill } from '../../ui/Pill';
import { OptionCard } from '../../ui/OptionCard';

/**
 * One waiting task (v2-03): "Kararın lazım" with every question in one box on the left; on the
 * right the agent's last lines and its permission requests. Answers go out together, in one
 * resume of the agent's session.
 */
export function WaitingTask({ task }: { task: TaskView }) {
  const mode = useUi((s) => s.nameMode);
  const agent = useAgents().byId(task.agent);
  const name = agentName(agent, mode);
  const { questions, permissions } = task.pending;
  const titleId = useId();
  const hasQuestions = questions.length > 0;
  const nothingNamed = !hasQuestions && permissions.length === 0;

  return (
    <section
      id={decisionAnchor(task.id)}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={`grid scroll-mt-6 items-start gap-6 focus:outline-none ${
        hasQuestions || nothingNamed ? 'lg:grid-cols-[minmax(0,1fr)_24rem]' : 'lg:grid-cols-2'
      }`}
    >
      {hasQuestions || nothingNamed ? (
        <QuestionBox task={task} agent={agent} name={name} titleId={titleId} />
      ) : (
        <h2 id={titleId} className="sr-only">
          {name} izin bekliyor: {task.title}
        </h2>
      )}
      <AgentSide task={task} agent={agent} name={name} />
    </section>
  );
}

function QuestionBox({
  task,
  agent,
  name,
  titleId,
}: {
  task: TaskView;
  agent: AgentMeta;
  name: string;
  titleId: string;
}) {
  const { questions, permissions, round } = task.pending;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [note, setNote] = useState('');
  const actions = useDecisionActions(task.projectId);
  const open = unansweredQuestions(questions, drafts);
  const readable = questions.filter((q) => q.problem === null);
  const busy = actions.answer.isPending;
  const set = (id: string, draft: Draft) => setDrafts((d) => ({ ...d, [id]: draft }));

  const send = (delegate: boolean) =>
    actions.answer.mutate({
      id: task.id,
      input: delegate
        ? { delegate: true, answers: answersOf(questions, drafts) }
        : questions.length > 0
          ? { answers: answersOf(questions, drafts) }
          : { note },
    });

  const subtitle =
    questions.length === 0
      ? `${name} durdu ve senden bir şey bekliyor, ama bekleyen bir soru kalmadı.`
      : readable.length === 0
        ? `${name} bir şey sormak istemiş olabilir.`
        : `${name} ajanı ilerlemeden önce ${readable.length} şeyi bilmek istiyor.`;

  return (
    <Card as="div" tone="warm" padding="lg" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start gap-4">
        <AgentAvatar agent={agent} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-2xl font-extrabold sm:text-3xl">
            Kararın lazım
          </h2>
          <p className="mt-1 text-muted">{subtitle}</p>
          <p className="text-sm text-muted">Görev: “{task.title}”</p>
        </div>
        {questions.length > 0 && (
          <Pill className="bg-warn-soft text-warn">
            {pendingLabel({ ...task.pending, permissions: [] })}
          </Pill>
        )}
      </header>

      {round > MAX_QUIET_ROUNDS && (
        <Notice tone="warn">
          Ajan bu görevde {round}. kez soru soruyor. Görev belirsiz olabilir; cevaplamak yerine
          görevi netleştirip yeniden başlatmayı da düşünebilirsin.
        </Notice>
      )}

      {questions.map((q, i) =>
        q.problem === null ? (
          <Question
            key={q.id}
            index={i + 1}
            question={q}
            draft={drafts[q.id]}
            onChange={(d) => set(q.id, d)}
          />
        ) : (
          <BrokenQuestion
            key={q.id}
            question={q}
            value={drafts[q.id]?.free ?? ''}
            onChange={(free) => set(q.id, { selected: [], free })}
          />
        ),
      )}

      {questions.length === 0 && (
        <div>
          <label htmlFor={`${titleId}-note`} className="block font-bold">
            Ajana bir not yaz (isteğe bağlı)
          </label>
          <textarea
            id={`${titleId}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
            rows={3}
            placeholder="Örn. Önceki cevaplarımla devam et."
            className="mt-1 w-full rounded-xl border border-line-strong bg-surface px-4 py-3 placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none"
          />
        </div>
      )}

      {actions.answer.error && <ErrorMessage error={actions.answer.error} />}

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button
          variant="primary"
          size="lg"
          {...(questions.length > 0 ? { trailingIcon: ArrowRight } : { icon: Play })}
          disabled={open.length > 0}
          loading={busy && !actions.answer.variables?.input.delegate}
          onClick={() => send(false)}
        >
          {questions.length > 0 ? 'Cevapları gönder' : 'Devam ettir'}
        </Button>
        {readable.length > 0 && (
          <Button
            variant="ghost"
            size="lg"
            disabled={busy || open.some((q) => q.problem !== null)}
            loading={busy && actions.answer.variables?.input.delegate === true}
            onClick={() => send(true)}
          >
            Ajanın kararına bırak
          </Button>
        )}
        <p className="flex items-center gap-1.5 text-sm text-muted sm:ml-auto" role="status">
          <Info aria-hidden className="size-4" />
          {open.length > 0
            ? `${open.length} soru cevap bekliyor`
            : permissions.length > 0
              ? 'İzin isteği de cevaplanınca ajan devam eder'
              : 'Tek seferde gönderilir'}
        </p>
      </footer>
    </Card>
  );
}

function Question({
  index,
  question,
  draft,
  onChange,
}: {
  index: number;
  question: QuestionView;
  draft: Draft | undefined;
  onChange: (draft: Draft) => void;
}) {
  const id = useId();
  const selected = draft?.selected ?? [];
  const multi = question.multiSelect;
  return (
    <fieldset>
      <legend className="text-lg font-bold">
        {index} · {question.question}
      </legend>
      {multi && <p className="text-sm text-muted">Birden çok seçebilirsin.</p>}
      {question.options.length > 0 && (
        <div
          role={multi ? 'group' : 'radiogroup'}
          aria-label={question.question}
          className={`mt-3 grid grid-cols-2 gap-3 ${question.options.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}
        >
          {question.options.map((option) => (
            <OptionCard
              key={option}
              role={multi ? 'checkbox' : 'radio'}
              label={option}
              selected={selected.includes(option) && !draft?.free.trim()}
              onSelect={() => onChange(pick(draft, option, multi))}
            />
          ))}
        </div>
      )}
      <label htmlFor={`${id}-free`} className="mt-3 block text-sm font-bold">
        {question.options.length > 0 ? 'Başka bir cevap' : 'Cevabın'}
      </label>
      <input
        id={`${id}-free`}
        value={draft?.free ?? ''}
        onChange={(e) => onChange({ selected, free: e.target.value })}
        maxLength={4000}
        placeholder="Kendi cevabını yaz"
        className="mt-1 min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none"
      />
    </fieldset>
  );
}

/** The agent tried to ask but its question could not be read: show what it wrote. */
function BrokenQuestion({
  question,
  value,
  onChange,
}: {
  question: QuestionView;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warn">
        Ajan bir şey sormak istemiş olabilir, ama sorusu okunamadı. Yazdığını oku ve kendi cevabını
        yaz; iş sessizce bitirilmedi.
      </Notice>
      <pre className="max-h-64 overflow-auto rounded-xl border border-line bg-surface p-4 font-mono text-sm whitespace-pre-wrap break-words">
        {question.question}
      </pre>
      <label htmlFor={`${id}-answer`} className="block font-bold">
        Cevabın
      </label>
      <textarea
        id={`${id}-answer`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={4000}
        rows={3}
        className="w-full rounded-xl border border-line-strong bg-surface px-4 py-3 focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none"
      />
    </div>
  );
}

/** Dark peek at the agent's last lines, with its permission requests under it (v2-03 right). */
function AgentSide({ task, agent, name }: { task: TaskView; agent: AgentMeta; name: string }) {
  const api = useApi();
  const runId = task.latestRun?.id ?? null;
  const stream = useRunStream(runId, runId ? api.eventsUrl(runId) : null);
  const lines = stream.events
    .filter(({ event }) => event.kind === 'tool_use' || event.kind === 'text')
    .slice(-3);

  return (
    <div className="overflow-hidden rounded-card shadow-card">
      <div className="bg-console text-console-ink">
        <div className="flex items-center gap-3 border-b border-console-raised p-4 sm:px-6">
          <AgentAvatar agent={agent} size="md" />
          <p className="min-w-0 flex-1 truncate text-lg font-extrabold">{name}</p>
          <StatusPill
            tone="warn"
            label={task.pending.questions.length > 0 ? 'Karar bekliyor' : 'İzin bekliyor'}
          />
        </div>
        <div
          className="flex flex-col gap-1.5 p-4 font-mono text-sm sm:px-6"
          aria-label={`${name} son satırlar`}
        >
          {lines.length === 0 ? (
            <p className="text-console-muted">Kayıtlı çıktı yükleniyor…</p>
          ) : (
            lines.map(({ seq, event }) => <EventLine key={seq} event={event} />)
          )}
          <p className="text-console-warn">? Senden cevap bekliyor, durdu</p>
        </div>
      </div>
      {task.pending.permissions.map((p) => (
        <PermissionCard key={p.id} task={task} permission={p} agent={agent} name={name} />
      ))}
    </div>
  );
}

function PermissionCard({
  task,
  permission,
  agent,
  name,
}: {
  task: TaskView;
  permission: PermissionView;
  agent: AgentMeta;
  name: string;
}) {
  const actions = useDecisionActions(task.projectId);
  const pending = actions.permission.isPending ? actions.permission.variables : undefined;
  const titleId = useId();
  const act = (action: PermissionAction) =>
    actions.permission.mutate({ taskId: task.id, permissionId: permission.id, action });
  const loading = (action: PermissionAction) => pending?.action === action;

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 border-t border-line bg-surface p-4 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar agent={agent} size="md" />
        <div className="min-w-0">
          <h3 id={titleId} className="text-lg font-bold">
            İzin isteği
          </h3>
          <p className="text-muted">
            {name} {permissionVerb(permission)}
          </p>
        </div>
      </div>
      <p className="rounded-xl bg-console px-4 py-3 font-mono text-sm break-all text-console-ink">
        {permission.command && (
          <span aria-hidden className="text-console-success">
            ${' '}
          </span>
        )}
        {permissionLine(permission)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="approve"
          disabled={pending !== undefined}
          loading={loading('task')}
          onClick={() => act('task')}
          title="Bu görev boyunca izin ver"
        >
          İzin ver
        </Button>
        <Button
          disabled={pending !== undefined}
          loading={loading('once')}
          onClick={() => act('once')}
          title="Yalnızca ajanın bir sonraki çalışmasında"
        >
          Bir kez
        </Button>
        <Button
          variant="danger"
          disabled={pending !== undefined}
          loading={loading('denied')}
          onClick={() => act('denied')}
        >
          Reddet
        </Button>
      </div>
      <Button
        variant="ghost"
        disabled={pending !== undefined}
        loading={loading('always')}
        onClick={() => act('always')}
        className="self-start"
      >
        Hep izin ver · yalnızca bu proje
      </Button>
      <p className="text-xs text-muted">
        “İzin ver” bu görev boyunca geçerli. “Hep izin ver”{' '}
        <code className="font-mono break-all">{permission.rule}</code> kuralını projenin{' '}
        <code className="font-mono">.team/team.json</code> dosyasına yazar.
      </p>
      {actions.permission.error && (
        <p className="flex items-start gap-2 text-sm font-semibold text-danger" role="alert">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {actions.permission.error.message}
        </p>
      )}
    </section>
  );
}
