import { ArrowRight, ChevronDown } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import type { TaskView } from '../api';
import { agentName, useAgents } from '../lib/agents';
import { titleFromPrompt } from '../lib/board';
import { useCreateTask } from '../lib/queries';
import { useUi } from '../lib/store';
import { AgentAvatar } from '../ui/AgentAvatar';
import { Button } from '../ui/Button';
import { ErrorMessage } from '../ui/ErrorMessage';
import { Dialog } from '../ui/Dialog';
import { OptionCard } from '../ui/OptionCard';

const FIELD =
  'w-full rounded-xl border border-line-strong bg-surface px-4 placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none focus-visible:outline-none';

/**
 * "Yeni iş" (v2-17). Until the planner exists this creates one task for one agent; the title is
 * taken from the request unless the user writes one.
 */
export function NewTaskDialog({
  projectId,
  tasks,
}: {
  projectId: string;
  tasks: readonly TaskView[];
}) {
  const state = useUi((s) => s.newTask);
  const close = useUi((s) => s.closeNewTask);
  return (
    <Dialog
      open={state.open}
      onClose={close}
      title="Yeni iş"
      description="Ne yapılsın? Bir cümle yeter."
    >
      {state.open && (
        <NewTaskForm
          // Fresh form state for each opening.
          key={`${state.prompt}|${state.agent ?? ''}`}
          projectId={projectId}
          tasks={tasks}
          initialPrompt={state.prompt}
          initialAgent={state.agent}
          onDone={close}
        />
      )}
    </Dialog>
  );
}

function NewTaskForm({
  projectId,
  tasks,
  initialPrompt,
  initialAgent,
  onDone,
}: {
  projectId: string;
  tasks: readonly TaskView[];
  initialPrompt: string;
  initialAgent: string | null;
  onDone: () => void;
}) {
  const mode = useUi((s) => s.nameMode);
  const agents = useAgents();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [agent, setAgent] = useState(() =>
    initialAgent && agents.assignable.some((a) => a.id === initialAgent) ? initialAgent : 'general',
  );
  const [title, setTitle] = useState('');
  const [expected, setExpected] = useState('');
  const [dependsOn, setDependsOn] = useState('');
  const create = useCreateTask(projectId);
  const id = useId();

  const finalTitle = title.trim() || titleFromPrompt(prompt);

  function submit(e: FormEvent, start: boolean) {
    e.preventDefault();
    if (!prompt.trim() || !finalTitle) return;
    create.mutate(
      {
        start,
        task: {
          title: finalTitle,
          prompt: prompt.trim(),
          agent,
          expectedFiles: expected
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean),
          dependsOn: dependsOn || null,
        },
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={(e) => submit(e, true)} className="flex flex-col gap-5">
      <div>
        <label htmlFor={`${id}-prompt`} className="sr-only">
          İstek
        </label>
        <textarea
          id={`${id}-prompt`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          required
          rows={4}
          autoFocus
          placeholder="Kafe için sipariş sayfası ve admin paneli ekle. Sepet ve toplam tutar olsun."
          className={`${FIELD} min-h-32 py-3 text-lg`}
        />
      </div>

      <fieldset>
        <legend className="mb-2 font-bold">Kim yapsın?</legend>
        <div role="radiogroup" aria-label="Ajan" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {agents.assignable.map((a) => (
            <OptionCard
              key={a.id}
              label={agentName(a, mode)}
              selected={agent === a.id}
              onSelect={() => setAgent(a.id)}
              leading={<AgentAvatar agent={a} size="sm" />}
            />
          ))}
        </div>
      </fieldset>

      <details className="group rounded-tile border border-line bg-sand/40 p-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-bold">
          Ayrıntılar (isteğe bağlı)
          <ChevronDown aria-hidden className="size-5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-bold">Başlık</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={titleFromPrompt(prompt) || 'İstekten alınır'}
              maxLength={200}
              className={`${FIELD} min-h-12`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold">Beklenen dosyalar</span>
            <textarea
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder={'README.md\nsrc/**'}
              spellCheck={false}
              rows={3}
              className={`${FIELD} py-2 font-mono text-sm`}
            />
            <span className="text-xs text-muted">
              Bunların dışında değişiklik olursa uyarı verilir.
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold">Önce bitmesi gereken iş</span>
            <select
              value={dependsOn}
              onChange={(e) => setDependsOn(e.target.value)}
              className={`${FIELD} min-h-12`}
            >
              <option value="">Yok (ana daldan başla)</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">Seçilirse o işin dalı üzerine kurulur.</span>
          </label>
        </div>
      </details>

      {create.isError && <ErrorMessage error={create.error} prefix="Oluşturulamadı:" />}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="ghost" onClick={onDone}>
          Vazgeç
        </Button>
        <Button
          variant="secondary"
          disabled={!prompt.trim() || create.isPending}
          onClick={(e) => submit(e, false)}
        >
          Sadece ekle
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          trailingIcon={ArrowRight}
          loading={create.isPending}
          disabled={!prompt.trim()}
        >
          Ekle ve başlat
        </Button>
      </div>
    </form>
  );
}
