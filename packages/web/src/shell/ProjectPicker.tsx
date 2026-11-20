import { Check, ChevronDown, Folder } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { AddProjectForm } from '../components/AddProjectForm';
import { projectName } from '../format';
import { useProjects } from '../lib/queries';
import { navigate } from '../lib/router';
import { useUi } from '../lib/store';

/** Project pill in the top bar (`kafe-siparis main ›`); opens a list to switch or add a project. */
export function ProjectPicker() {
  const projects = useProjects();
  const projectId = useUi((s) => s.projectId);
  const setProjectId = useUi((s) => s.setProjectId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const current = projects.data?.find((p) => p.id === projectId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(id: string) {
    setProjectId(id);
    setOpen(false);
    navigate({ task: null });
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-12 max-w-full items-center gap-3 rounded-full border border-line bg-surface px-5 shadow-card hover:border-line-strong"
      >
        <Folder aria-hidden className="size-5 shrink-0" />
        <span className="truncate font-bold">
          {current ? projectName(current.path) : projects.isPending ? 'Yükleniyor…' : 'Proje seç'}
        </span>
        {current && <span className="font-mono text-sm text-muted">{current.mainBranch}</span>}
        <ChevronDown
          aria-hidden
          className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute top-full left-0 z-40 mt-2 flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-pop"
        >
          {projects.data && projects.data.length > 0 && (
            <ul aria-label="Projeler" className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {projects.data.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => choose(p.id)}
                    aria-current={p.id === projectId || undefined}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-sand"
                  >
                    <Folder aria-hidden className="size-5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{projectName(p.path)}</span>
                      <span className="block truncate font-mono text-xs text-muted">{p.path}</span>
                    </span>
                    {p.id === projectId && <Check aria-hidden className="size-5 text-accent" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {projects.isError && (
            <p role="alert" className="text-sm font-semibold text-danger">
              Projeler yüklenemedi: {projects.error.message}
            </p>
          )}
          <AddProjectForm onAdded={(p) => choose(p.id)} />
        </div>
      )}
    </div>
  );
}
