import type { RunStatus, TaskStatus } from '@squadboard/core';

/** Status is always shown as text (not only colour), per the design's accessibility rules. */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Çalışıyor',
  succeeded: 'Bitti',
  failed: 'Hata',
  stopped: 'Durduruldu',
};

export const RUN_STATUS_CLASS: Record<RunStatus, string> = {
  running: 'text-accent',
  succeeded: 'text-success',
  failed: 'text-danger',
  stopped: 'text-ink/60',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  planned: 'Planlandı',
  blocked: 'Bekliyor',
  running: 'Çalışıyor',
  waiting_decision: 'Kararın lazım',
  in_review: 'İncelemede',
  changes_requested: 'Değişiklik istendi',
  done: 'Bitti',
  failed: 'Hata',
  stopped: 'Durduruldu',
};

export function formatCost(costUsd: number | null): string {
  if (costUsd === null) return '—';
  return `$${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`;
}

export function formatDuration(startIso: string, endIso: string | null): string {
  const ms = (endIso ? Date.parse(endIso) : Date.now()) - Date.parse(startIso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} sn` : `${Math.floor(s / 60)} dk ${s % 60} sn`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One-line summary of a tool call's input: the path, pattern or command it acts on. */
export function summarizeToolInput(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'notebook_path', 'path', 'pattern', 'command', 'url', 'query']) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}

export function firstLine(text: string, max = 160): string {
  const line = text.split('\n').find((l) => l.trim() !== '') ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
