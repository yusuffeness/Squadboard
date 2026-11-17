import { useEffect, useRef, useState } from 'react';
import type { Api, RunView } from './api';
import { EventLine } from './EventLine';
import {
  RUN_STATUS_CLASS,
  RUN_STATUS_LABEL,
  TASK_STATUS_LABEL,
  formatCost,
  formatDuration,
} from './format';
import { useRunStream } from './useRunStream';

/** Live output of one run (render with `key={run.id}` so each run gets a fresh stream). */
export function RunPanel({
  api,
  run,
  title,
  onChanged,
}: {
  api: Api;
  run: RunView;
  title: string;
  onChanged: () => Promise<void>;
}) {
  const stream = useRunStream(api, run.id);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const summary = stream.ended ?? run;
  const isActive = summary.active && !stream.ended;

  // Refresh the task list (status, cost) once the stream says the run ended.
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
            Çıktı: {title}
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-ink/60">{summary.cwd}</p>
          <p aria-live="polite" className="mt-2 flex flex-wrap gap-x-3 text-sm">
            <span className={`font-semibold ${RUN_STATUS_CLASS[summary.status]}`}>
              {RUN_STATUS_LABEL[summary.status]}
            </span>
            {!isActive && <span>Görev: {TASK_STATUS_LABEL[summary.taskStatus]}</span>}
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
        className="flex max-h-[60vh] min-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg bg-console p-4 font-mono text-sm text-console-ink"
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
