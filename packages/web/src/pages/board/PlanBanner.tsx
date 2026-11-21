import { Flag, Play } from 'lucide-react';
import type { PlanView } from '../../api';
import { usePlanActions } from '../../lib/queries';
import { navigate } from '../../lib/router';
import { Button } from '../../ui/Button';
import { ErrorMessage } from '../../ui/ErrorMessage';

/** Points the board at a plan that needs the user: waiting for approval, planning, stopped, failed. */
export function PlanBanner({ plan }: { plan: PlanView }) {
  const actions = usePlanActions(plan.projectId);
  const open = (
    <Button variant="primary" icon={Flag} onClick={() => navigate({ plan: plan.id, task: null })}>
      Planı aç
    </Button>
  );
  const text: Record<string, string> = {
    awaiting_approval: 'Plan hazır, onayını bekliyor',
    planning: 'Planlayıcı çalışıyor',
    failed: 'Son plan çıkmadı',
  };
  const interrupted = plan.status === 'interrupted';
  const cut = plan.progress?.interrupted ?? 0;

  return (
    <section
      aria-label="Plan durumu"
      className="flex flex-col gap-3 rounded-tile border border-warn/25 bg-warn-tint p-4 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="font-bold">
          {interrupted
            ? `Squadboard kapandığı için plan durdu${cut > 0 ? `; ${cut} iş kesildi` : ''}.`
            : (text[plan.status] ?? 'Plan')}
        </p>
        <p className="truncate text-sm text-muted" title={plan.text}>
          “{plan.text}”
          {plan.progress && ` · ${plan.progress.finished}/${plan.progress.total} iş bitti`}
        </p>
        {actions.resume.isError && <ErrorMessage error={actions.resume.error} />}
      </div>
      {interrupted ? (
        <Button
          variant="primary"
          icon={Play}
          loading={actions.resume.isPending}
          onClick={() => actions.resume.mutate(plan.id)}
        >
          Devam et
        </Button>
      ) : (
        open
      )}
    </section>
  );
}
