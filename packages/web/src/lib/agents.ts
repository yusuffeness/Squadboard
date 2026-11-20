import {
  AppWindow,
  Database,
  Eye,
  Flag,
  FlaskConical,
  Server,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

export type NameMode = 'technical' | 'simple';

export interface AgentMeta {
  id: string;
  technical: string;
  simple: string;
  /** What the agent does, in one short line. */
  role: string;
  icon: LucideIcon;
  /** Pastel fill (full class names so Tailwind can see them). */
  bg: string;
  /** Left edge of task cards. */
  edge: string;
}

/** The team in the order the design shows it (agent strip, menus). */
export const TEAM: readonly AgentMeta[] = [
  {
    id: 'planner',
    technical: 'Planlayıcı',
    simple: 'Kaptan',
    role: 'Planlar, işi parçalara böler',
    icon: Flag,
    bg: 'bg-agent-planner',
    edge: 'border-l-agent-planner',
  },
  {
    id: 'frontend',
    technical: 'Ön Yüz',
    simple: 'Pixel',
    role: 'Ekranları ve arayüzü yapar',
    icon: AppWindow,
    bg: 'bg-agent-frontend',
    edge: 'border-l-agent-frontend',
  },
  {
    id: 'backend',
    technical: 'Arka Yüz',
    simple: 'Motor',
    role: 'Sunucu ve API yazar',
    icon: Server,
    bg: 'bg-agent-backend',
    edge: 'border-l-agent-backend',
  },
  {
    id: 'database',
    technical: 'Veritabanı',
    simple: 'Kutu',
    role: 'Tabloları ve veriyi kurar',
    icon: Database,
    bg: 'bg-agent-database',
    edge: 'border-l-agent-database',
  },
  {
    id: 'test',
    technical: 'Test',
    simple: 'Dedektif',
    role: 'Test yazar, hata arar',
    icon: FlaskConical,
    bg: 'bg-agent-test',
    edge: 'border-l-agent-test',
  },
  {
    id: 'reviewer',
    technical: 'İnceleyici',
    simple: 'Usta',
    role: 'Biten işi inceler, özetler',
    icon: Eye,
    bg: 'bg-agent-reviewer',
    edge: 'border-l-agent-reviewer',
  },
];

/** Tasks created before roles existed (stage 5) use `general`; unknown agents fall back to it. */
export const GENERAL_AGENT: AgentMeta = {
  id: 'general',
  technical: 'Genel',
  simple: 'Genel',
  role: 'Her işe bakar',
  icon: Sparkles,
  bg: 'bg-agent-general',
  edge: 'border-l-agent-general',
};

/** Agents a task can be given by hand (planner and reviewer get work from the flow, later). */
export const ASSIGNABLE: readonly AgentMeta[] = [
  GENERAL_AGENT,
  ...TEAM.filter((a) => a.id !== 'planner' && a.id !== 'reviewer'),
];

export function agentMeta(id: string): AgentMeta {
  return TEAM.find((a) => a.id === id) ?? GENERAL_AGENT;
}

export function agentName(agent: AgentMeta, mode: NameMode): string {
  return mode === 'simple' ? agent.simple : agent.technical;
}
