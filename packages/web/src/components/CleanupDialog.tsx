import { GitBranch, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { TaskView } from '../api';
import { useTaskActions } from '../lib/queries';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { OptionCard } from '../ui/OptionCard';

/** Removes a task's worktree; the user chooses whether its `team/` branch goes too. */
export function CleanupDialog({
  task,
  open,
  onClose,
}: {
  task: TaskView;
  open: boolean;
  onClose: () => void;
}) {
  const [deleteBranch, setDeleteBranch] = useState(false);
  const { cleanup } = useTaskActions(task.projectId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Çalışma klasörünü temizle"
      description={`“${task.title}” için açılan klasör silinecek. Senin proje klasörün değişmez.`}
    >
      <div role="radiogroup" aria-label="Dal ne olsun?" className="grid gap-3 sm:grid-cols-2">
        <OptionCard
          icon={GitBranch}
          label="Dalı tut"
          hint="Commit'lenmiş iş dalda kalır"
          selected={!deleteBranch}
          onSelect={() => setDeleteBranch(false)}
        />
        <OptionCard
          icon={Trash2}
          label="Dalı da sil"
          hint={task.branch ?? 'team/…'}
          selected={deleteBranch}
          onSelect={() => setDeleteBranch(true)}
        />
      </div>
      {cleanup.isError && (
        <p role="alert" className="font-semibold text-danger">
          Temizlenemedi: {cleanup.error.message}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose}>
          Vazgeç
        </Button>
        <Button
          variant="danger"
          icon={Trash2}
          loading={cleanup.isPending}
          onClick={() => cleanup.mutate({ id: task.id, deleteBranch }, { onSuccess: onClose })}
        >
          Temizle
        </Button>
      </div>
    </Dialog>
  );
}
