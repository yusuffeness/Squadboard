import { Check, CircleHelp, Clock, Zap, type LucideIcon } from 'lucide-react';
import type { TaskView } from '../../api';
import { COLUMNS, groupByColumn, type ColumnId } from '../../lib/board';
import { EmptyState } from '../../ui/EmptyState';
import { TaskCard } from './TaskCard';

const EMPTY_ICON: Record<ColumnId, LucideIcon> = {
  waiting: Clock,
  working: Zap,
  attention: CircleHelp,
  done: Check,
};

/**
 * Four columns: Bekliyor, Çalışıyor, Karar / İnceleme, Bitti (v2-01). On phones they stack as
 * lists ("Çalışıyor · 2", v2-18) and empty ones are hidden once there is any task.
 */
export function Columns({ tasks }: { tasks: readonly TaskView[] }) {
  const groups = groupByColumn(tasks);
  const anyTask = tasks.length > 0;
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => {
        const items = groups[col.id];
        const headingId = `col-${col.id}`;
        return (
          <section
            key={col.id}
            aria-labelledby={headingId}
            data-column={col.id}
            className={`flex flex-col gap-3 md:min-h-96 md:rounded-[1.75rem] md:border md:border-line md:bg-surface/50 md:p-4 ${
              anyTask && items.length === 0 ? 'max-md:hidden' : ''
            }`}
          >
            <div className="flex items-center justify-between px-1 pt-1">
              <h2 id={headingId} className="text-xl font-extrabold md:text-lg">
                {col.title}
                <span className="md:hidden"> · {items.length}</span>
              </h2>
              <span
                aria-label={`${items.length} görev`}
                className="hidden size-8 items-center justify-center rounded-full bg-surface text-sm font-bold text-muted shadow-card md:inline-flex"
              >
                {items.length}
              </span>
            </div>
            {items.length === 0 ? (
              <EmptyState icon={EMPTY_ICON[col.id]} title={col.empty} />
            ) : (
              <ul className="flex flex-col gap-3">
                {items.map((task) => (
                  <li key={task.id}>
                    <TaskCard task={task} all={tasks} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
