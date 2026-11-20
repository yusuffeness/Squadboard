import { useCallback, useSyncExternalStore } from 'react';
import type { RunView, StreamedEvent } from '../api';

export interface RunStreamState {
  events: StreamedEvent[];
  /** Run summary sent when the stream ends (finished, failed or stopped). */
  ended: RunView | null;
  /** True once `end` arrived, even if the server had no summary to send. */
  finished: boolean;
  connected: boolean;
}

const EMPTY: RunStreamState = { events: [], ended: null, finished: false, connected: false };

interface Stream {
  source: EventSource;
  state: RunStreamState;
  listeners: Set<() => void>;
}

/**
 * One EventSource per run, shared by everything that watches it (board cards, detail view).
 * Browsers allow about six HTTP/1.1 connections per origin; a stream per component would
 * exhaust that with a few parallel agents and stall ordinary API calls.
 *
 * Follows `/api/runs/:id/events`: stored events first, then live ones, then `end`. EventSource
 * reconnects by itself with Last-Event-ID; duplicates are skipped by `seq`. After `end` the source
 * is closed so it does not reconnect.
 */
const streams = new Map<string, Stream>();

function open(runId: string, url: string): Stream {
  const source = new EventSource(url);
  const stream: Stream = { source, state: EMPTY, listeners: new Set() };
  let lastSeq = -1;
  const update = (patch: Partial<RunStreamState>) => {
    stream.state = { ...stream.state, ...patch };
    for (const l of stream.listeners) l();
  };

  source.onopen = () => update({ connected: true });
  source.onerror = () => update({ connected: false });
  source.addEventListener('agent', (e) => {
    const item = JSON.parse((e as MessageEvent<string>).data) as StreamedEvent;
    if (item.seq <= lastSeq) return;
    lastSeq = item.seq;
    update({ events: [...stream.state.events, item] });
  });
  source.addEventListener('end', (e) => {
    const summary = JSON.parse((e as MessageEvent<string>).data) as RunView | null;
    source.close();
    update({ ended: summary, finished: true, connected: false });
  });
  streams.set(runId, stream);
  return stream;
}

function subscribe(runId: string, url: string, listener: () => void): () => void {
  const stream = streams.get(runId) ?? open(runId, url);
  stream.listeners.add(listener);
  return () => {
    stream.listeners.delete(listener);
    if (stream.listeners.size === 0) {
      stream.source.close();
      streams.delete(runId);
    }
  };
}

/** Live events of one run. `url` is `api.eventsUrl(runId)`; pass null to watch nothing. */
export function useRunStream(runId: string | null, url: string | null): RunStreamState {
  const sub = useCallback(
    (listener: () => void) => (runId && url ? subscribe(runId, url, listener) : () => {}),
    [runId, url],
  );
  const snapshot = useCallback(
    () => (runId ? (streams.get(runId)?.state ?? EMPTY) : EMPTY),
    [runId],
  );
  return useSyncExternalStore(sub, snapshot);
}
