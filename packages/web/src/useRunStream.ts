import { useEffect, useState } from 'react';
import type { Api, RunView, StreamedEvent } from './api';

export interface RunStream {
  events: StreamedEvent[];
  /** Run summary sent when the stream ends (run finished, failed or stopped). */
  ended: RunView | null;
  connected: boolean;
}

/**
 * Follows `/api/runs/:id/events` (SSE): stored events first, then live ones, then `end`.
 * On a dropped connection EventSource reconnects by itself with Last-Event-ID; duplicates are
 * skipped by `seq`. After `end` the source is closed so it does not reconnect.
 *
 * State is not reset when `runId` changes: render the consumer with `key={runId}` so each run
 * gets a fresh component (RunPanel does).
 */
export function useRunStream(api: Api, runId: string): RunStream {
  const [state, setState] = useState<RunStream>({ events: [], ended: null, connected: false });

  useEffect(() => {
    const source = new EventSource(api.eventsUrl(runId));
    let lastSeq = -1;

    source.onopen = () => setState((s) => ({ ...s, connected: true }));
    source.onerror = () => setState((s) => ({ ...s, connected: false }));
    source.addEventListener('agent', (e) => {
      const item = JSON.parse((e as MessageEvent<string>).data) as StreamedEvent;
      if (item.seq <= lastSeq) return;
      lastSeq = item.seq;
      setState((s) => ({ ...s, events: [...s.events, item] }));
    });
    source.addEventListener('end', (e) => {
      const summary = JSON.parse((e as MessageEvent<string>).data) as RunView | null;
      setState((s) => ({ ...s, ended: summary, connected: false }));
      source.close();
    });

    return () => source.close();
  }, [api, runId]);

  return state;
}
