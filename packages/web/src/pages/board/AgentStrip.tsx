import type { TaskView } from '../../api';
import { TEAM, agentName } from '../../lib/agents';
import { agentState } from '../../lib/board';
import { useUi } from '../../lib/store';
import { AgentAvatar } from '../../ui/AgentAvatar';
import { StatusDot } from '../../ui/Pill';

/** Six agent tiles with what each is doing (v2-01). Scrolls sideways on narrow screens. */
export function AgentStrip({ tasks }: { tasks: readonly TaskView[] }) {
  const mode = useUi((s) => s.nameMode);
  return (
    <section aria-label="Ekip">
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 xl:grid-cols-6 xl:gap-4">
        {TEAM.map((agent) => {
          const state = agentState(agent.id, tasks);
          return (
            <li
              key={agent.id}
              data-agent={agent.id}
              className="min-w-44 snap-start rounded-card border border-line bg-surface/90 p-3.5 shadow-card sm:min-w-0"
            >
              <div className="flex items-center gap-3">
                <AgentAvatar agent={agent} />
                <span className="truncate text-base font-extrabold" data-testid="agent-name">
                  {agentName(agent, mode)}
                </span>
              </div>
              <div className="mt-3">
                <StatusDot tone={state.tone} label={state.label} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
