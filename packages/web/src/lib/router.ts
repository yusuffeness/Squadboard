import { useSyncExternalStore } from 'react';

/**
 * Routing lives in the URL fragment next to the session token (`#token=…&p=ekip&task=…`).
 * The fragment never reaches the server, so the server needs no SPA fallback and the token stays
 * where `squadboard` put it.
 */
export const PAGES = ['pano', 'ekip', 'gecmis', 'harcama', 'ayarlar'] as const;
export type Page = (typeof PAGES)[number];

export interface Route {
  page: Page;
  /** Open task in the agent detail view (Pano only). */
  task: string | null;
  /** Open plan: "Planlayıcı düşünüyor…" or "Plan onayı" (Pano only). */
  plan: string | null;
}

function parse(hash: string): Route {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const p = params.get('p');
  const page = (PAGES as readonly string[]).includes(p ?? '') ? (p as Page) : 'pano';
  return {
    page,
    task: page === 'pano' ? params.get('task') : null,
    plan: page === 'pano' ? params.get('plan') : null,
  };
}

let current = parse(window.location.hash);
const listeners = new Set<() => void>();

window.addEventListener('hashchange', () => {
  current = parse(window.location.hash);
  for (const l of listeners) l();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current);
}

/** Changes the page (and task), keeping every other fragment parameter such as the token. */
export function navigate(to: Partial<Route>) {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const next = { ...current, ...to };
  if (next.page === 'pano') params.delete('p');
  else params.set('p', next.page);
  if (next.page === 'pano' && next.task) params.set('task', next.task);
  else params.delete('task');
  if (next.page === 'pano' && next.plan) params.set('plan', next.plan);
  else params.delete('plan');
  window.location.hash = params.toString();
}
