import type { AgentEvent } from '@squadboard/core';
import { firstLine, formatCost, summarizeToolInput } from './format';

/** One row of the live output panel. Noise (rate limits, status pings, deltas) is hidden. */
export function EventLine({ event }: { event: AgentEvent }) {
  switch (event.kind) {
    case 'session_started':
      return (
        <p className="text-console-muted">
          Oturum başladı · {event.model ?? 'model ?'} · {event.cwd}
        </p>
      );
    case 'text':
      return <p className="whitespace-pre-wrap text-console-ink">{event.text}</p>;
    case 'thinking':
      return <p className="whitespace-pre-wrap italic text-console-muted">{event.text}</p>;
    case 'tool_use':
      return (
        <p>
          <span className="text-console-muted">▸ </span>
          <span className="font-semibold">{event.name}</span>{' '}
          <span className="break-all text-console-muted">{summarizeToolInput(event.input)}</span>
        </p>
      );
    case 'tool_result':
      return event.isError ? (
        <p className="break-all pl-4 text-console-danger">✗ {firstLine(event.content)}</p>
      ) : (
        <p className="break-all pl-4 text-console-muted">✓ {firstLine(event.content) || 'tamam'}</p>
      );
    case 'file_change':
      return (
        <p className="break-all text-console-success">
          ✎ Dosya {event.operation === 'write' ? 'yazıldı' : 'değişti'}: {event.path}
        </p>
      );
    case 'result':
      return (
        <div
          className={`mt-2 border-t border-console-muted/30 pt-2 ${event.isError ? 'text-console-danger' : 'text-console-success'}`}
        >
          <p>
            {event.isError ? `Hata (${event.subtype})` : 'Bitti'} · maliyet{' '}
            {formatCost(event.costUsd)} · {event.numTurns ?? '?'} tur
            {event.durationMs !== null ? ` · ${(event.durationMs / 1000).toFixed(1)} sn` : ''}
          </p>
          {event.permissionDenials.length > 0 && (
            <p className="text-console-danger">
              İzin verilmedi:{' '}
              {event.permissionDenials
                .map((d) => `${d.toolName} ${summarizeToolInput(d.input)}`)
                .join(', ')}
            </p>
          )}
          {event.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      );
    case 'error':
      return (
        <p className="text-console-danger">
          Hata ({event.code}): {event.message}
        </p>
      );
    case 'unknown':
      return <p className="text-console-muted">Tanınmayan olay: {event.rawType ?? '?'}</p>;
    case 'rate_limit':
    case 'status':
    case 'text_delta':
      return null;
  }
}
