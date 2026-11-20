import { FolderPlus } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import type { ProjectView } from '../api';
import { useAddProject } from '../lib/queries';
import { Button } from '../ui/Button';

/** Folder path field + "Ekle". The server checks it is a git repository. */
export function AddProjectForm({ onAdded }: { onAdded: (project: ProjectView) => void }) {
  const [path, setPath] = useState('');
  const add = useAddProject();
  const id = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) return;
    add.mutate(trimmed, {
      onSuccess: (project) => {
        setPath('');
        onAdded(project);
      },
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-bold">
        Proje klasörü (git reposu)
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="C:\Users\sen\projem"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={add.isError || undefined}
          aria-describedby={add.isError ? `${id}-error` : undefined}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-4 font-mono text-sm placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none focus-visible:outline-none"
        />
        <Button type="submit" variant="primary" icon={FolderPlus} loading={add.isPending}>
          Ekle
        </Button>
      </div>
      {add.isError && (
        <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-danger">
          Eklenemedi: {add.error.message}
        </p>
      )}
    </form>
  );
}
