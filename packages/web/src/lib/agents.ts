import {
  AppWindow,
  Bot,
  Code,
  Database,
  Eye,
  Flag,
  FlaskConical,
  Server,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import type { AgentView, TeamState } from '../api';
import { useTeam } from './queries';
import { useUi } from './store';

export type NameMode = 'technical' | 'simple';

export interface AgentMeta {
  id: string;
  technical: string;
  simple: string;
  /** What the agent does, in one short line. */
  role: string;
  icon: LucideIcon;
  /** Pastel fill: a CSS colour, from `.team/team.json` or a design token for the fallback team. */
  color: string;
  enabled: boolean;
}

/** Roles get an icon by id; agents users add themselves get a generic one. */
const ICONS: Record<string, LucideIcon> = {
  planner: Flag,
  frontend: AppWindow,
  backend: Server,
  database: Database,
  test: FlaskConical,
  reviewer: Eye,
  developer: Code,
  general: Sparkles,
};

/** Agents that get their work from the flow (plan, review), not from a hand-made task. */
const FLOW_ROLES = new Set(['planner', 'reviewer']);

const fallback = (id: string, technical: string, simple: string, role: string): AgentMeta => ({
  id,
  technical,
  simple,
  role,
  icon: ICONS[id] ?? Bot,
  color: `var(--color-agent-${id})`,
  enabled: true,
});

/**
 * Used only for a project without a (valid) `.team/`: the same six roles the full-stack template
 * installs. Once a team is set up, names and colours come from its files.
 */
export const DEFAULT_TEAM: readonly AgentMeta[] = [
  fallback('planner', 'Planlayıcı', 'Kaptan', 'Planlar, işi parçalara böler'),
  fallback('frontend', 'Ön Yüz', 'Pixel', 'Ekranları ve arayüzü yapar'),
  fallback('backend', 'Arka Yüz', 'Motor', 'Sunucu ve API yazar'),
  fallback('database', 'Veritabanı', 'Kutu', 'Tabloları ve veriyi kurar'),
  fallback('test', 'Test', 'Dedektif', 'Test yazar, hata arar'),
  fallback('reviewer', 'İnceleyici', 'Usta', 'Biten işi inceler, özetler'),
];

/** Not part of any template: tasks without a role, and agents no longer in the team. */
export const GENERAL_AGENT: AgentMeta = fallback('general', 'Genel', 'Genel', 'Her işe bakar');

export function fromAgentView(agent: AgentView): AgentMeta {
  return {
    id: agent.id,
    technical: agent.names.tech,
    simple: agent.names.friendly,
    role: agent.description,
    icon: ICONS[agent.id] ?? Bot,
    color: agent.color,
    enabled: agent.enabled,
  };
}

export function agentName(agent: AgentMeta, mode: NameMode): string {
  return mode === 'simple' ? agent.simple : agent.technical;
}

export interface Agents {
  /** 'team' when `.team/` was read; 'default' otherwise. */
  source: 'team' | 'default';
  /** Switched-on members in the team's order (agent strip). */
  team: readonly AgentMeta[];
  /** Agents a task can be given by hand: Genel first, then the members without a flow role. */
  assignable: readonly AgentMeta[];
  byId: (id: string) => AgentMeta;
}

export function agentsFrom(state: TeamState | undefined): Agents {
  const members = state?.status === 'ok' ? state.team.agents.map(fromAgentView) : [...DEFAULT_TEAM];
  const enabled = members.filter((a) => a.enabled);
  return {
    source: state?.status === 'ok' ? 'team' : 'default',
    team: enabled,
    assignable: [GENERAL_AGENT, ...enabled.filter((a) => !FLOW_ROLES.has(a.id))],
    // Old tasks may name an agent the team no longer has: keep a sensible look for them.
    byId: (id) =>
      members.find((a) => a.id === id) ?? DEFAULT_TEAM.find((a) => a.id === id) ?? GENERAL_AGENT,
  };
}

/** The current project's agents (from its `.team/`, or the fallback team). */
export function useAgents(): Agents {
  const projectId = useUi((s) => s.projectId);
  const team = useTeam(projectId);
  return useMemo(() => agentsFrom(team.data), [team.data]);
}
