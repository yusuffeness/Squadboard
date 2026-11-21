import {
  ArrowLeft,
  Check,
  CircleCheck,
  CircleHelp,
  File,
  Flag,
  LoaderCircle,
  RefreshCw,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { PlanDecision } from '@squadboard/core';
import type { PlanContent, PlanStep, PlanTaskView, PlanView } from '../api';
import { formatUsd } from '../format';
import { agentName, useAgents } from '../lib/agents';
import { addedOrder, stagesSentence, stepSeconds, tasksByStage, unanswered } from '../lib/plan';
import { usePlanActions } from '../lib/queries';
import { navigate } from '../lib/router';
import { useUi } from '../lib/store';
import { AgentAvatar } from '../ui/AgentAvatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ErrorMessage } from '../ui/ErrorMessage';
import { Notice } from '../ui/Notice';
import { OptionCard } from '../ui/OptionCard';

/** "Planlayıcı düşünüyor…" (v2-05) and "Plan onayı" (v2-06) for one plan. */
export function PlanPage({ plan }: { plan: PlanView }) {
  switch (plan.status) {
    case 'planning':
      return <Planning plan={plan} />;
    case 'failed':
      return <PlanFailed plan={plan} />;
    case 'cancelled':
      return (
        <Notice tone="warn" action={<BackButton />}>
          Bu plan iptal edildi.
        </Notice>
      );
    case 'awaiting_approval':
      return plan.plan ? <Approval key={plan.id} plan={plan} content={plan.plan} /> : null;
    default:
      return (
        <Notice tone="warn" action={<BackButton />}>
          Bu plan onaylandı; işler panoda.
        </Notice>
      );
  }
}

function BackButton() {
  return (
    <Button icon={ArrowLeft} onClick={() => navigate({ plan: null })}>
      Panoya dön
    </Button>
  );
}

// ---------- v2-05: planning ----------

function Planning({ plan }: { plan: PlanView }) {
  const actions = usePlanActions(plan.projectId);
  return (
    <section
      aria-labelledby="planning-title"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 py-4 text-center sm:py-10"
    >
      <span
        aria-hidden
        className="inline-flex size-24 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-accent-soft to-blob-peach text-ink shadow-card sm:size-28"
      >
        <Flag className="size-11" />
      </span>
      <div>
        <h1 id="planning-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          Planlayıcı düşünüyor…
        </h1>
        <p className="mt-2 text-lg text-muted">
          İşi ekibe paylaştırıyor. Adımlar oldukça burada görünür.
        </p>
      </div>
      <Card padding="lg" className="w-full text-left">
        <RequestLine text={plan.text} />
        <StepList steps={plan.steps} live />
      </Card>
      {actions.cancel.isError && <ErrorMessage error={actions.cancel.error} />}
      <Button
        size="lg"
        loading={actions.cancel.isPending}
        onClick={() =>
          actions.cancel.mutate(plan.id, { onSuccess: () => navigate({ plan: null }) })
        }
      >
        İptal et
      </Button>
    </section>
  );
}

function RequestLine({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
      <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-accent-soft px-3 py-1 text-sm font-bold">
        <Sparkles aria-hidden className="size-4" />
        İsteğin
      </span>
      <p className="min-w-0 text-lg font-bold break-words">“{text}”</p>
    </div>
  );
}

/** Only the steps the server really reported; durations from their own timestamps. */
function StepList({ steps, live = false }: { steps: readonly PlanStep[]; live?: boolean }) {
  return (
    <ol aria-label="Planlama adımları" aria-live={live ? 'polite' : undefined} className="mt-4">
      {steps.map((step) => {
        const seconds = stepSeconds(step);
        return (
          <li
            key={step.id}
            className="flex items-center gap-4 border-b border-line py-3.5 last:border-b-0"
          >
            <StepIcon status={step.status} />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{step.label}</p>
              {step.detail && (
                <p className="truncate text-sm text-muted" title={step.detail}>
                  {step.detail}
                </p>
              )}
            </div>
            <span className="shrink-0 text-sm text-muted">
              {step.status === 'running'
                ? 'sürüyor'
                : step.status === 'failed'
                  ? 'olmadı'
                  : seconds !== null && seconds > 0
                    ? `${seconds} sn`
                    : 'tamam'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({ status }: { status: PlanStep['status'] }) {
  const look: Record<PlanStep['status'], { icon: LucideIcon; className: string; label: string }> = {
    done: { icon: Check, className: 'bg-success-soft text-success', label: 'Bitti' },
    running: {
      icon: LoaderCircle,
      className: 'bg-info-soft text-info [&>svg]:animate-spin',
      label: 'Sürüyor',
    },
    failed: { icon: X, className: 'bg-danger-soft text-danger', label: 'Olmadı' },
  };
  const { icon: Icon, className, label } = look[status];
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${className}`}
    >
      <Icon aria-hidden className="size-4" strokeWidth={2.5} />
    </span>
  );
}

function PlanFailed({ plan }: { plan: PlanView }) {
  const actions = usePlanActions(plan.projectId);
  return (
    <section aria-labelledby="plan-failed-title" className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 id="plan-failed-title" className="text-3xl font-extrabold tracking-tight">
        Plan çıkmadı
      </h1>
      <ErrorMessage error={plan.error ?? 'Planlama başarısız oldu.'} detail={plan.errorDetail} />
      <Card padding="lg">
        <RequestLine text={plan.text} />
        <StepList steps={plan.steps} />
      </Card>
      {actions.start.isError && <ErrorMessage error={actions.start.error} />}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={RefreshCw}
          loading={actions.start.isPending}
          onClick={() =>
            actions.start.mutate(plan.text, { onSuccess: (p) => navigate({ plan: p.id }) })
          }
        >
          Yeniden dene
        </Button>
        <BackButton />
      </div>
    </section>
  );
}

// ---------- v2-06: plan approval ----------

function Approval({ plan, content }: { plan: PlanView; content: PlanContent }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const actions = usePlanActions(plan.projectId);
  const open = unanswered(content.openDecisions, answers);
  const ready = open.length === 0;
  const stages = tasksByStage(content);
  const editError = actions.edit.error ?? actions.approve.error ?? actions.cancel.error;

  function approve() {
    actions.approve.mutate({ id: plan.id, answers }, { onSuccess: () => navigate({ plan: null }) });
  }

  function regenerate() {
    actions.cancel.mutate(plan.id, {
      onSuccess: () =>
        actions.start.mutate(plan.text, { onSuccess: (p) => navigate({ plan: p.id }) }),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper />
      <header>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Plan hazır</h1>
        <p className="mt-2 text-lg text-muted">
          {stagesSentence(content.stages.length)}{' '}
          {plan.requirePlanApproval
            ? ready
              ? 'İstersen düzenle, sonra onayla.'
              : 'Başlamadan önce birkaç soruyu cevapla.'
            : 'Plan onayı kapalı: soruları cevaplayınca iş kendiliğinden başlar.'}
        </p>
        <p className="mt-1 text-sm text-muted">İstek: “{plan.text}”</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {content.openDecisions.length > 0 && (
            <Decisions
              decisions={content.openDecisions}
              tasks={content.tasks}
              answers={answers}
              onAnswer={(id, value) => setAnswers((a) => ({ ...a, [id]: value }))}
            />
          )}
          {ready ? (
            stages.map((tasks, i) => (
              <StageGroup
                key={tasks.map((t) => t.id).join('|')}
                index={i}
                tasks={tasks}
                content={content}
                busy={actions.edit.isPending}
                onRemove={(taskId) =>
                  actions.edit.mutate({ id: plan.id, edit: { removeTask: taskId } })
                }
                onAgent={(taskId, agent) =>
                  actions.edit.mutate({ id: plan.id, edit: { taskId, agent } })
                }
              />
            ))
          ) : (
            <p className="rounded-tile border border-dashed border-line-strong p-5 text-center text-muted">
              Sorular cevaplanınca {content.tasks.length} iş aşama aşama burada görünür.
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-4" aria-label="Plan özeti">
          <Summary plan={plan} content={content} />
          <ConflictPanel content={content} />
          {editError && <ErrorMessage error={editError} />}
          <Button
            variant="primary"
            size="lg"
            icon={Rocket}
            disabled={!ready}
            loading={actions.approve.isPending}
            onClick={approve}
          >
            {plan.requirePlanApproval ? 'Onayla ve başlat' : 'Cevapla ve başlat'}
          </Button>
          {!ready && (
            <p className="text-sm text-muted" role="status">
              {open.length} soru cevap bekliyor.
            </p>
          )}
          <Button
            icon={RefreshCw}
            loading={actions.cancel.isPending || actions.start.isPending}
            onClick={regenerate}
          >
            Planı yeniden oluştur
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              actions.cancel.mutate(plan.id, { onSuccess: () => navigate({ plan: null }) })
            }
          >
            Vazgeç
          </Button>
        </aside>
      </div>
    </div>
  );
}

function Stepper() {
  const steps = [
    { label: 'İsteğin', state: 'done' },
    { label: 'Plan', state: 'current' },
    { label: 'Onay', state: 'next' },
  ] as const;
  return (
    <ol aria-label="Adımlar" className="flex flex-wrap items-center gap-3">
      {steps.map((s, i) => (
        <li
          key={s.label}
          aria-current={s.state === 'current' ? 'step' : undefined}
          className="flex items-center gap-3"
        >
          <span
            aria-hidden
            className={`inline-flex size-9 items-center justify-center rounded-full font-bold ${
              s.state === 'done'
                ? 'bg-success text-white'
                : s.state === 'current'
                  ? 'bg-accent text-white'
                  : 'border border-line-strong bg-surface text-muted'
            }`}
          >
            {s.state === 'done' ? <Check className="size-4" strokeWidth={3} /> : i + 1}
          </span>
          <span className="font-bold">{s.label}</span>
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={`hidden h-0.5 w-16 sm:block ${s.state === 'done' ? 'bg-success' : 'bg-line-strong'}`}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

/** "Önce şunları netleştirelim": the Planner's open decisions, options + free text. */
function Decisions({
  decisions,
  tasks,
  answers,
  onAnswer,
}: {
  decisions: readonly PlanDecision[];
  tasks: readonly PlanTaskView[];
  answers: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
}) {
  return (
    <Card as="section" tone="warm" padding="lg" aria-labelledby="decisions-title">
      <h2 id="decisions-title" className="flex items-center gap-2 text-xl font-extrabold">
        <CircleHelp aria-hidden className="size-6 text-warn" />
        Önce şunları netleştirelim
      </h2>
      <p className="mt-1 text-muted">
        Planlayıcı bunları tahmin etmedi. Cevapların ilgili işlerin talimatına eklenir.
      </p>
      <div className="mt-5 flex flex-col gap-6">
        {decisions.map((d) => (
          <Decision
            key={d.id}
            decision={d}
            tasks={tasks}
            value={answers[d.id] ?? ''}
            onChange={(v) => onAnswer(d.id, v)}
          />
        ))}
      </div>
    </Card>
  );
}

function Decision({
  decision,
  tasks,
  value,
  onChange,
}: {
  decision: PlanDecision;
  tasks: readonly PlanTaskView[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const isOption = decision.options.includes(value);
  const affected =
    decision.taskIds.length === 0
      ? 'Tüm planı etkiler'
      : `Etkilediği işler: ${decision.taskIds
          .map((tid) => tasks.find((t) => t.id === tid)?.title ?? tid)
          .join(', ')}`;
  return (
    <fieldset>
      <legend className="text-lg font-bold">{decision.question}</legend>
      <p className="text-sm text-muted">{affected}</p>
      <div
        role="radiogroup"
        aria-label={decision.question}
        className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {decision.options.map((option) => (
          <OptionCard
            key={option}
            label={option}
            selected={value === option}
            onSelect={() => onChange(option)}
          />
        ))}
      </div>
      <label htmlFor={`${id}-free`} className="mt-3 block text-sm font-bold">
        Başka bir cevap
      </label>
      <input
        id={`${id}-free`}
        value={isOption ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={2000}
        placeholder="Kendi cevabını yaz"
        className="mt-1 min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none focus-visible:outline-none"
      />
    </fieldset>
  );
}

function StageGroup({
  index,
  tasks,
  content,
  busy,
  onRemove,
  onAgent,
}: {
  index: number;
  tasks: readonly PlanTaskView[];
  content: PlanContent;
  busy: boolean;
  onRemove: (taskId: string) => void;
  onAgent: (taskId: string, agent: string) => void;
}) {
  return (
    <section aria-label={`${index + 1}. aşama`} className="flex flex-col gap-3">
      <h2 className="flex items-center gap-3 text-sm font-bold tracking-wide text-muted uppercase">
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-ink text-base text-white normal-case">
          {index + 1}
        </span>
        {index + 1}. aşama
        {tasks.length > 1 && <span className="normal-case">· {tasks.length} iş paralel</span>}
      </h2>
      {tasks.map((task) => (
        <PlanTaskCard
          key={task.id}
          task={task}
          content={content}
          busy={busy}
          onRemove={() => onRemove(task.id)}
          onAgent={(agent) => onAgent(task.id, agent)}
        />
      ))}
    </section>
  );
}

function PlanTaskCard({
  task,
  content,
  busy,
  onRemove,
  onAgent,
}: {
  task: PlanTaskView;
  content: PlanContent;
  busy: boolean;
  onRemove: () => void;
  onAgent: (agent: string) => void;
}) {
  const mode = useUi((s) => s.nameMode);
  const agents = useAgents();
  const agent = agents.byId(task.agent);
  const selectId = useId();
  const titleOf = (id: string) => content.tasks.find((t) => t.id === id)?.title ?? id;
  const waitsFor = task.dependsOn.map(titleOf);
  const serialised = addedOrder(task).map(titleOf);
  const decisions = content.openDecisions.filter(
    (d) => d.taskIds.length === 0 || d.taskIds.includes(task.id),
  ).length;

  return (
    <Card
      as="article"
      data-testid="plan-task"
      className="flex flex-col gap-3 border-l-4"
      style={{ borderLeftColor: agent.color }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <AgentAvatar agent={agent} />
          <div className="min-w-0">
            <h3 className="text-lg leading-snug font-extrabold break-words">{task.title}</h3>
            <p className="text-sm text-muted">{agentName(agent, mode)}</p>
          </div>
        </div>
      </div>

      {task.expectedFiles.length > 0 ? (
        <p className="font-mono text-sm break-all text-muted">{task.expectedFiles.join(', ')}</p>
      ) : (
        <p className="text-sm text-muted">Beklenen dosya yazılmamış</p>
      )}

      <ul className="flex flex-col gap-1 text-sm empty:hidden">
        {waitsFor.length > 0 && <Line>Önce bitmeli: {waitsFor.join(', ')}</Line>}
        {serialised.length > 0 && (
          <Line tone="warn">Aynı dosyalar yüzünden sıraya alındı: {serialised.join(', ')}</Line>
        )}
        {task.outsideOwns.length > 0 && (
          <Line tone="warn">Ajanın alanı dışında: {task.outsideOwns.join(', ')}</Line>
        )}
        {task.agentUnavailable && (
          <Line tone="danger">Bu ajan kapalı ya da dosya yazamıyor; ajanı değiştir.</Line>
        )}
        {decisions > 0 && <Line>{decisions} cevabın talimatına eklenecek</Line>}
      </ul>

      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-bold">
          Talimatı göster
        </summary>
        <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{task.prompt || task.title}</p>
      </details>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={selectId} className="text-sm font-bold">
            Ajanı değiştir
          </label>
          <select
            id={selectId}
            value={task.agent}
            disabled={busy}
            onChange={(e) => onAgent(e.target.value)}
            className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none"
          >
            {!content.assignableAgents.includes(task.agent) && (
              <option value={task.agent} disabled>
                {agentName(agent, mode)} (kapalı)
              </option>
            )}
            {content.assignableAgents.map((id) => (
              <option key={id} value={id}>
                {agentName(agents.byId(id), mode)}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="danger"
          icon={Trash2}
          disabled={busy || content.tasks.length <= 1}
          onClick={onRemove}
          aria-label={`Kaldır: ${task.title}`}
        >
          Kaldır
        </Button>
      </div>
    </Card>
  );
}

function Line({ tone, children }: { tone?: 'warn' | 'danger'; children: ReactNode }) {
  return (
    <li
      className={
        tone === 'warn'
          ? 'font-semibold text-warn'
          : tone === 'danger'
            ? 'font-semibold text-danger'
            : 'text-muted'
      }
    >
      {children}
    </li>
  );
}

function Summary({ plan, content }: { plan: PlanView; content: PlanContent }) {
  return (
    <Card as="section" padding="lg" aria-labelledby="summary-title">
      <h2 id="summary-title" className="text-xl font-extrabold">
        Özet
      </h2>
      <dl className="mt-3 flex flex-col gap-2">
        <Row icon={Users} label="Ajan" value={String(content.summary.agents)} />
        <Row icon={File} label="Beklenen dosya" value={String(content.summary.files)} />
        <Row
          icon={CircleCheck}
          label="Harcama sınırı"
          value={`en fazla ${formatUsd(content.summary.maxCostUsd)}`}
        />
      </dl>
      <p className="mt-2 text-xs text-muted">
        Sınır, ajanların iş başına bütçelerinin toplamı; tahmin değil.
        {plan.plannerCostUsd !== null && ` Planlama: ${formatUsd(plan.plannerCostUsd)}.`}
      </p>
    </Card>
  );
}

function Row({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2">
        <Icon aria-hidden className="size-5 text-muted" />
        {label}
      </dt>
      <dd className="font-mono font-bold">{value}</dd>
    </div>
  );
}

function ConflictPanel({ content }: { content: PlanContent }) {
  const clean = content.notes.length === 0 && content.warnings.length === 0;
  if (clean) {
    return (
      <section
        aria-labelledby="conflicts-title"
        className="rounded-card border border-success/25 bg-success-soft p-5"
      >
        <h2 id="conflicts-title" className="flex items-center gap-2 font-extrabold">
          <ShieldCheck aria-hidden className="size-5 text-success" />
          Çakışma yok
        </h2>
        <p className="mt-1 text-muted">Hiçbir iki iş aynı dosyaya aynı anda yazmıyor.</p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="conflicts-title"
      className="rounded-card border border-warn/25 bg-warn-tint p-5"
    >
      <h2 id="conflicts-title" className="flex items-center gap-2 font-extrabold">
        <ShieldAlert aria-hidden className="size-5 text-warn" />
        Çakışma kontrolü
      </h2>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {content.notes.map((note) => (
          <li key={note} className="flex gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{note}</span>
          </li>
        ))}
        {content.warnings.map((warning) => (
          <li key={warning} className="flex gap-2 font-semibold text-warn">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{warning}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
