import { agentName, type AgentMeta, type NameMode } from '../lib/agents';

const SIZE = {
  xs: { box: 'size-6 rounded-full', icon: 'size-3.5' },
  sm: { box: 'size-8 rounded-lg', icon: 'size-4' },
  md: { box: 'size-11 rounded-xl', icon: 'size-5' },
  lg: { box: 'size-14 rounded-2xl', icon: 'size-6' },
};

/** Pastel square (or circle at xs) with the agent's icon. Decorative: the name is always shown next to it. */
export function AgentAvatar({
  agent,
  size = 'md',
}: {
  agent: AgentMeta;
  size?: keyof typeof SIZE;
}) {
  const Icon = agent.icon;
  return (
    <span
      aria-hidden
      style={{ backgroundColor: agent.color }}
      className={`inline-flex shrink-0 items-center justify-center text-ink ${SIZE[size].box}`}
    >
      <Icon className={SIZE[size].icon} strokeWidth={2} />
    </span>
  );
}

/** Round chip with avatar and name (v2-19 "Ajanlar"). */
export function AgentChip({ agent, mode }: { agent: AgentMeta; mode: NameMode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded-full bg-sand py-1 pr-3 pl-1 text-sm font-semibold">
      <AgentAvatar agent={agent} size="xs" />
      <span className="truncate">{agentName(agent, mode)}</span>
    </span>
  );
}
