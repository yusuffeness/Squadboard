import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createApi, readToken, type Api, type ProjectView, type TaskView } from './api';
import { STARTABLE, TASK_STATUS_CLASS, TASK_STATUS_LABEL, formatCost } from './format';
import { RunPanel } from './RunPanel';

// Stage 5 UI: functional, not polished. Projects (git repos) → tasks, each in its own worktree.

const AGENTS = ['general', 'frontend', 'backend', 'database', 'test'] as const;

export function App() {
  const token = useMemo(() => readToken(), []);
  const api = useMemo(() => (token ? createApi(token) : null), [token]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-baseline gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Squad<span className="text-accent">board</span>
        </h1>
        <span className="text-sm text-ink/60">prototip</span>
      </header>
      {api ? <Workspace api={api} /> : <MissingToken />}
    </div>
  );
}

function MissingToken() {
  return (
    <div role="alert" className="max-w-xl rounded-lg border border-warn/40 bg-white p-4">
      <p className="font-semibold text-warn">Oturum anahtarı yok.</p>
      <p className="mt-1">
        Bu sayfayı terminalde <code className="font-mono">squadboard</code> komutunun yazdığı
        bağlantıyla aç (sonu <code className="font-mono">#token=…</code> ile biter).
      </p>
    </div>
  );
}

function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}

// ---------- projects ----------

function Workspace({ api }: { api: Api }) {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listProjects().then(
      (list) => {
        if (cancelled) return;
        setProjects(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      },
      (err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="grid gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4">
        <AddProjectForm
          api={api}
          onAdded={(project) => {
            setProjects((prev) =>
              prev.some((p) => p.id === project.id) ? prev : [...prev, project],
            );
            setSelectedId(project.id);
          }}
        />
        <section aria-labelledby="projects-heading">
          <h2
            id="projects-heading"
            className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/60"
          >
            Projeler
          </h2>
          <ErrorText>{error}</ErrorText>
          {projects.length === 0 && !error && (
            <p className="text-sm text-ink/60">Henüz proje yok. Bir git reposu ekle.</p>
          )}
          <ul className="flex flex-col gap-2">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  aria-current={p.id === selectedId}
                  className={`min-h-11 w-full rounded-md border p-3 text-left ${
                    p.id === selectedId
                      ? 'border-accent bg-white'
                      : 'border-transparent bg-white/60'
                  }`}
                >
                  <p className="break-all font-mono text-xs">{p.path}</p>
                  <p className="mt-1 text-xs text-ink/70">
                    {p.mainBranch} · {p.taskCount} görev
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>
      {selected ? (
        <ProjectPanel key={selected.id} api={api} project={selected} />
      ) : (
        <div className="rounded-lg border border-dashed border-ink/20 p-6 text-ink/60">
          Soldan bir proje seç ya da ekle.
        </div>
      )}
    </div>
  );
}

function AddProjectForm({ api, onAdded }: { api: Api; onAdded: (p: ProjectView) => void }) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAdded(await api.addProject(path.trim()));
      setPath('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 rounded-lg bg-white p-4 shadow-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Proje ekle (git reposu)</span>
        <input
          className="min-h-11 rounded-md border border-ink/20 px-3 font-mono text-sm"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="C:\Users\sen\projem"
          required
          spellCheck={false}
        />
      </label>
      <ErrorText>{error}</ErrorText>
      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded-md bg-ink px-4 font-bold text-white disabled:opacity-60"
      >
        {busy ? 'Ekleniyor…' : 'Ekle'}
      </button>
    </form>
  );
}

// ---------- tasks ----------

function ProjectPanel({ api, project }: { api: Api; project: ProjectView }) {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTasks(await api.listTasks(project.id));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api, project.id]);

  // Initial load; state is set in the promise callbacks, not synchronously in the effect.
  useEffect(() => {
    let cancelled = false;
    api.listTasks(project.id).then(
      (list) => {
        if (!cancelled) setTasks(list);
      },
      (err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, project.id]);

  // Several tasks can run at once: poll while any is active so every row stays current.
  const anyActive = tasks.some((t) => t.active);
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [anyActive, refresh]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <p className="break-all font-mono text-sm">{project.path}</p>
        <p className="mt-1 text-sm text-ink/70">
          Görevler <span className="font-mono">{project.mainBranch}</span> branch'inden başlar; her
          biri kendi worktree'sinde çalışır. Senin klasörüne dokunulmaz.
        </p>
        {project.clean === false && (
          <p className="mt-1 text-sm text-warn">
            ⚠ Klasöründe commit'lenmemiş değişiklikler var; ajanlar bunları görmez.
          </p>
        )}
      </div>

      <TaskForm
        api={api}
        projectId={project.id}
        tasks={tasks}
        onCreated={(task) => setTasks((prev) => [...prev, task])}
      />

      <section aria-labelledby="tasks-heading">
        <h2
          id="tasks-heading"
          className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/60"
        >
          Görevler
        </h2>
        <ErrorText>{error}</ErrorText>
        {tasks.length === 0 && !error && <p className="text-sm text-ink/60">Henüz görev yok.</p>}
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              api={api}
              task={task}
              dependency={tasks.find((t) => t.id === task.dependsOn[0]) ?? null}
              selected={task.id === selectedTaskId}
              onSelect={() => setSelectedTaskId(task.id)}
              onChanged={refresh}
            />
          ))}
        </ul>
      </section>

      {selectedTask?.latestRun && (
        <RunPanel
          key={selectedTask.latestRun.id}
          api={api}
          run={selectedTask.latestRun}
          title={selectedTask.title}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function TaskForm({
  api,
  projectId,
  tasks,
  onCreated,
}: {
  api: Api;
  projectId: string;
  tasks: TaskView[];
  onCreated: (task: TaskView) => void;
}) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agent, setAgent] = useState<string>('general');
  const [expected, setExpected] = useState('');
  const [dependsOn, setDependsOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const task = await api.createTask(projectId, {
        title,
        prompt,
        agent,
        expectedFiles: expected
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        dependsOn: dependsOn || null,
      });
      onCreated(task);
      setTitle('');
      setPrompt('');
      setExpected('');
      setDependsOn('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = 'rounded-md border border-ink/20 px-3';
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="grid gap-3 rounded-lg bg-white p-4 shadow-sm md:grid-cols-2"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Görev başlığı</span>
        <input
          className={`min-h-11 ${field}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="README güncelle"
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Ajan</span>
        <select
          className={`min-h-11 ${field}`}
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
        >
          {AGENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="text-sm font-semibold">İstek</span>
        <textarea
          className={`min-h-24 py-2 ${field}`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="README'ye bir satır ekle"
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Beklenen dosyalar (isteğe bağlı)</span>
        <textarea
          className={`min-h-16 py-2 font-mono text-sm ${field}`}
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          placeholder={'README.md\nsrc/**'}
          spellCheck={false}
        />
        <span className="text-xs text-ink/60">
          Bunların dışında değişiklik olursa uyarı verilir.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Önce bitmesi gereken görev</span>
        <select
          className={`min-h-11 ${field}`}
          value={dependsOn}
          onChange={(e) => setDependsOn(e.target.value)}
        >
          <option value="">Yok (ana branch'ten başla)</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink/60">Seçilirse o görevin branch'i üzerine kurulur.</span>
      </label>
      <div className="flex flex-col gap-2 md:col-span-2">
        <ErrorText>{error}</ErrorText>
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-md bg-accent px-4 font-bold text-white disabled:opacity-60 md:self-start"
        >
          {busy ? 'Ekleniyor…' : 'Görev ekle'}
        </button>
      </div>
    </form>
  );
}

function TaskRow({
  api,
  task,
  dependency,
  selected,
  onSelect,
  onChanged,
}: {
  api: Api;
  task: TaskView;
  dependency: TaskView | null;
  selected: boolean;
  onSelect: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: () => Promise<unknown>, select = false) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (select) onSelect();
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function cleanup() {
    const deleteBranch = window.confirm(
      `"${task.title}" worktree'si silinecek.\n\nBranch'i (${task.branch ?? '-'}) de silmek için Tamam'a, branch'i ve commit'lenmiş işi tutmak için İptal'e bas.`,
    );
    void act(() => api.cleanupTask(task.id, deleteBranch));
  }

  const status = task.active ? 'running' : task.status;
  const canStart = !task.active && STARTABLE.includes(task.status);
  const button = 'min-h-11 rounded-md px-3 text-sm font-bold disabled:opacity-60';

  return (
    <li
      className={`rounded-md border bg-white p-3 ${selected ? 'border-accent' : 'border-transparent'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{task.title}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink/70">
            <span className={`font-semibold ${TASK_STATUS_CLASS[status]}`}>
              {TASK_STATUS_LABEL[status]}
            </span>
            <span>{task.agent}</span>
            {task.branch && <span className="font-mono">{task.branch}</span>}
            {task.latestRun && <span>{formatCost(task.latestRun.costUsd)}</span>}
            {task.changedFiles.length > 0 && (
              <span title={task.changedFiles.join('\n')}>
                {task.changedFiles.length} dosya değişti
              </span>
            )}
          </p>
          {task.status === 'blocked' && dependency && (
            <p className="mt-1 text-xs text-ink/60">Önce "{dependency.title}" bitmeli.</p>
          )}
          {task.unexpectedFiles.length > 0 && (
            <p className="mt-1 text-xs text-warn" title={task.unexpectedFiles.join('\n')}>
              ⚠ Beklenmeyen dosya: {task.unexpectedFiles.join(', ')}
            </p>
          )}
          {task.gitError && <p className="mt-1 text-xs text-danger">Git: {task.gitError}</p>}
          <ErrorText>{error}</ErrorText>
        </div>
        <div className="flex flex-wrap gap-2">
          {canStart && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => api.startTask(task.id), true)}
              className={`${button} bg-accent text-white`}
            >
              {task.latestRun ? 'Yeniden başlat' : 'Başlat'}
            </button>
          )}
          {task.active && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => api.stopTask(task.id))}
              className={`${button} border-2 border-danger text-danger`}
            >
              Durdur
            </button>
          )}
          {task.latestRun && (
            <button
              type="button"
              onClick={onSelect}
              aria-pressed={selected}
              className={`${button} border border-ink/20`}
            >
              Çıktı
            </button>
          )}
          {!task.active && task.worktreePath && (
            <button
              type="button"
              disabled={busy}
              onClick={cleanup}
              className={`${button} border border-ink/20 text-ink/70`}
            >
              Temizle
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
