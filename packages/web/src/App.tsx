import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createApi, readToken, type Api, type RunView } from './api';
import { EventLine } from './EventLine';
import {
  RUN_STATUS_CLASS,
  RUN_STATUS_LABEL,
  TASK_STATUS_LABEL,
  formatCost,
  formatDuration,
  formatTime,
} from './format';
import { useRunStream } from './useRunStream';

// Prototype UI (Stage 4): functional, not polished. One page: start a run, watch it live, stop it.

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

const CWD_KEY = 'squadboard.lastCwd';

function loadCwd(): string {
  try {
    return localStorage.getItem(CWD_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveCwd(cwd: string) {
  try {
    localStorage.setItem(CWD_KEY, cwd);
  } catch {
    // storage unavailable: just don't remember it
  }
}

function Workspace({ api }: { api: Api }) {
  const [runs, setRuns] = useState<RunView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRuns(await api.listRuns());
      setListError(null);
    } catch (err) {
      setListError((err as Error).message);
    }
  }, [api]);

  // Initial load (state is set in the promise callbacks, not synchronously in the effect).
  useEffect(() => {
    let cancelled = false;
    api.listRuns().then(
      (list) => {
        if (!cancelled) setRuns(list);
      },
      (err: unknown) => {
        if (!cancelled) setListError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const selected = runs.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="grid gap-6 md:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <RunForm
          api={api}
          onStarted={(run) => {
            setRuns((prev) => [run, ...prev]);
            setSelectedId(run.id);
          }}
        />
        <RunList runs={runs} selectedId={selectedId} onSelect={setSelectedId} error={listError} />
      </div>
      {selected ? (
        <RunPanel key={selected.id} api={api} run={selected} onChanged={refresh} />
      ) : (
        <div className="rounded-lg border border-dashed border-ink/20 p-6 text-ink/60">
          Bir istek çalıştır ya da listeden bir run seç.
        </div>
      )}
    </div>
  );
}

function RunForm({ api, onStarted }: { api: Api; onStarted: (run: RunView) => void }) {
  const [cwd, setCwd] = useState(loadCwd);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const run = await api.createRun({ cwd: cwd.trim(), prompt });
      saveCwd(cwd.trim());
      setPrompt('');
      onStarted(run);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Proje klasörü</span>
        <input
          className="min-h-11 rounded-md border border-ink/20 px-3 font-mono text-sm"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="C:\Users\sen\projem ya da /home/sen/projem"
          required
          spellCheck={false}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">İstek</span>
        <textarea
          className="min-h-28 rounded-md border border-ink/20 px-3 py-2"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="README'ye bir satır ekle"
          required
        />
      </label>
      <p className="text-xs text-ink/60">
        Ajan dosyaları okuyup düzenleyebilir, komut çalıştıramaz. Bütçe sınırı $1.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded-md bg-accent px-4 font-bold text-white disabled:opacity-60"
      >
        {busy ? 'Başlatılıyor…' : 'Çalıştır'}
      </button>
    </form>
  );
}

function RunList({
  runs,
  selectedId,
  onSelect,
  error,
}: {
  runs: RunView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  error: string | null;
}) {
  return (
    <section aria-labelledby="runs-heading">
      <h2
        id="runs-heading"
        className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/60"
      >
        Geçmiş run'lar
      </h2>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {runs.length === 0 && !error && <p className="text-sm text-ink/60">Henüz run yok.</p>}
      <ul className="flex flex-col gap-2">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => onSelect(run.id)}
              aria-current={run.id === selectedId}
              className={`w-full rounded-md border p-3 text-left ${
                run.id === selectedId ? 'border-accent bg-white' : 'border-transparent bg-white/60'
              }`}
            >
              <p className="line-clamp-2 font-semibold">{run.prompt}</p>
              <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-ink/70">
                <span className={`font-semibold ${RUN_STATUS_CLASS[run.status]}`}>
                  {RUN_STATUS_LABEL[run.status]}
                </span>
                <span>{formatCost(run.costUsd)}</span>
                <span>{formatTime(run.startedAt)}</span>
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RunPanel({
  api,
  run,
  onChanged,
}: {
  api: Api;
  run: RunView;
  onChanged: () => Promise<void>;
}) {
  const stream = useRunStream(api, run.id);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const summary = stream.ended ?? run;
  const isActive = summary.active && !stream.ended;

  // Refresh the list (status, cost) once the stream says the run ended.
  useEffect(() => {
    if (stream.ended) void onChanged();
  }, [stream.ended, onChanged]);

  // Follow the output while the user is at the bottom.
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [stream.events.length]);

  async function stop() {
    setStopping(true);
    setStopError(null);
    try {
      await api.stopRun(run.id);
      await onChanged();
    } catch (err) {
      setStopError((err as Error).message);
    } finally {
      setStopping(false);
    }
  }

  return (
    <section aria-labelledby="run-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-white p-4 shadow-sm">
        <div className="min-w-0">
          <h2 id="run-heading" className="font-bold">
            {summary.prompt}
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-ink/60">{summary.cwd}</p>
          <p aria-live="polite" className="mt-2 flex flex-wrap gap-x-3 text-sm">
            <span className={`font-semibold ${RUN_STATUS_CLASS[summary.status]}`}>
              {RUN_STATUS_LABEL[summary.status]}
            </span>
            {!isActive && <span>İş: {TASK_STATUS_LABEL[summary.taskStatus]}</span>}
            <span>Maliyet: {formatCost(summary.costUsd)}</span>
            <span>{summary.numTurns ?? '—'} tur</span>
            <span>{formatDuration(summary.startedAt, summary.endedAt)}</span>
          </p>
          {summary.error && <p className="mt-1 text-sm text-danger">{summary.error}</p>}
          {stopError && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {stopError}
            </p>
          )}
        </div>
        {isActive && (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={stopping}
            className="min-h-11 rounded-md border-2 border-danger px-4 font-bold text-danger disabled:opacity-60"
          >
            {stopping ? 'Durduruluyor…' : 'Durdur'}
          </button>
        )}
      </div>

      <div
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex max-h-[70vh] min-h-64 flex-col gap-1.5 overflow-y-auto rounded-lg bg-console p-4 font-mono text-sm text-console-ink"
      >
        {stream.events.length === 0 && (
          <p className="text-console-muted">{isActive ? 'Bekleniyor…' : 'Olay yok.'}</p>
        )}
        {stream.events.map(({ seq, event }) => (
          <EventLine key={seq} event={event} />
        ))}
      </div>
    </section>
  );
}
