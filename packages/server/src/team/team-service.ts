import {
  AGENTS_DIR,
  ASK_USER_QUESTION,
  buildAllowedTools,
  defaultAllowRules,
  type PackageManager,
  TEAM_FILE,
  TeamFile,
  describeZodError,
  formatAgentFile,
  isReadOnly,
  parseAgentFile,
  parseTeamFile,
  type AgentFrontmatter,
  type ProjectSettings,
  type TeamAgent,
} from '@squadboard/core';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRunOptions } from '../runner/claude-cli.js';
import { ServiceError } from '../service-error.js';

/**
 * The team lives in the user's repository as plain files (docs/ARCHITECTURE.md → "Ajan ve ekip
 * şablonu formatı"): `.team/team.json` and `.claude/agents/*.md`. They are always read from the
 * user's own checkout (the project folder), never from a task worktree, so an uncommitted edit
 * applies to the next run (docs/claude-cli-notes.md §15).
 *
 * Writing happens only on an explicit user action (install a template, save in the Ekip page) and
 * only to those two places. Squadboard never commits them; that is left to the user.
 */

/** `templates/` at the repository root (same relative path from src/ and dist/). */
export const DEFAULT_TEMPLATES_DIR = fileURLToPath(
  new URL('../../../../templates', import.meta.url),
);

/** Tools an agent gets when its file does not list any (no shell, like the pre-template default). */
export const DEFAULT_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];
export const DEFAULT_BUDGET_USD = 1;

/** One agent as the API shows it: team.json entry + its Markdown file. */
export interface AgentView {
  id: string;
  file: string;
  names: { tech: string; friendly: string };
  color: string;
  owns: string[];
  enabled: boolean;
  budgetUsd: number;
  description: string;
  /** null = not listed in the file (Squadboard's default set applies). */
  tools: string[] | null;
  model: string | null;
  permissionMode: AgentFrontmatter['permissionMode'] | null;
  prompt: string;
  readOnly: boolean;
}

export interface TeamView {
  id: string;
  name: string;
  description: string | null;
  settings: ProjectSettings;
  agents: AgentView[];
  /**
   * Allow rules for every run in this project (`--allowedTools`). From `.team/team.json`
   * (`permissions.allow`), or, when the file has none, derived from the project's scripts.
   */
  permissions: { allow: string[]; fromFile: boolean };
}

export type TeamState =
  { status: 'missing' } | { status: 'invalid'; error: string } | { status: 'ok'; team: TeamView };

export interface TemplateView extends TeamView {
  /** Files the template writes, relative to the project folder. */
  files: string[];
}

export interface InstallInput {
  templateId: string;
  /** Agents switched on; the rest are written too, but `enabled: false`. Default: all. */
  agents?: string[];
  settings?: Partial<ProjectSettings>;
  /** Replace files that already exist with different content. */
  overwrite?: boolean;
}

export interface InstallResult {
  written: string[];
  unchanged: string[];
}

export interface AgentPatch {
  enabled?: boolean;
  names?: { tech?: string; friendly?: string };
  prompt?: string;
  model?: string | null;
}

/** What the runner needs for one agent, or why the default must be used. */
export type AgentRunConfig =
  | { status: 'ok'; options: AgentRunOptions; agent: AgentView }
  | { status: 'disabled'; agent: AgentView }
  | { status: 'none' };

interface LoadedTeam {
  /** The JSON as written (unknown fields kept when we write it back). */
  raw: Record<string, unknown>;
  team: TeamFile;
  agents: AgentView[];
}

const agentFilePath = (root: string, file: string) => join(root, AGENTS_DIR, file);

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

const sameText = (a: string, b: string) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

function toView(agent: TeamAgent, frontmatter: AgentFrontmatter, prompt: string): AgentView {
  return {
    id: agent.id,
    file: agent.file,
    names: agent.names,
    color: agent.color,
    owns: agent.owns,
    enabled: agent.enabled,
    budgetUsd: agent.budgetUsd ?? DEFAULT_BUDGET_USD,
    description: frontmatter.description,
    tools: frontmatter.tools ?? null,
    model: frontmatter.model ?? null,
    permissionMode: frontmatter.permissionMode ?? null,
    prompt,
    readOnly: isReadOnly(frontmatter.tools),
  };
}

/** Reads and validates a team folder (a project or a template). Throws a Turkish message. */
function loadTeam(root: string): LoadedTeam | null {
  const text = readText(join(root, TEAM_FILE));
  if (text === null) return null;
  const parsed = parseTeamFile(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const raw = JSON.parse(text) as Record<string, unknown>;
  const agents = parsed.value.agents.map((agent) => {
    const label = `${AGENTS_DIR}/${agent.file}`;
    const md = readText(agentFilePath(root, agent.file));
    if (md === null)
      throw new Error(`${label} bulunamadı (${TEAM_FILE} içinde "${agent.id}" ajanı)`);
    const def = parseAgentFile(md, label);
    if (!def.ok) throw new Error(def.error);
    if (def.value.frontmatter.name !== agent.id) {
      throw new Error(
        `${label}: name alanı "${def.value.frontmatter.name}", ama ${TEAM_FILE} içindeki id "${agent.id}". İkisi aynı olmalı`,
      );
    }
    return toView(agent, def.value.frontmatter, def.value.prompt);
  });
  return { raw, team: parsed.value, agents };
}

function view(loaded: LoadedTeam, root: string): TeamView {
  const allow = loaded.team.permissions?.allow;
  return {
    id: loaded.team.id,
    name: loaded.team.name,
    description: loaded.team.description ?? null,
    settings: loaded.team.settings,
    agents: loaded.agents,
    permissions: allow
      ? { allow, fromFile: true }
      : { allow: detectAllowRules(root), fromFile: false },
  };
}

/** Lock file → package manager; npm when there is none. */
function packageManagerOf(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

/**
 * The project's default allowlist: its test, lint and typecheck scripts (package.json) for its
 * package manager. Empty for projects without package.json; the user can still allow a command
 * from the permission card.
 */
export function detectAllowRules(root: string): string[] {
  const text = readText(join(root, 'package.json'));
  if (text === null) return [];
  let scripts: string[] = [];
  try {
    const pkg = JSON.parse(text) as { scripts?: unknown };
    if (typeof pkg.scripts === 'object' && pkg.scripts !== null) scripts = Object.keys(pkg.scripts);
  } catch {
    return [];
  }
  return defaultAllowRules({ scripts, packageManager: packageManagerOf(root) });
}

/**
 * Agents that can change files get AskUserQuestion: asking is how they reach the user (the
 * call is denied headless and lands in permission_denials). Read-only agents stay read-only.
 */
function withQuestionTool(tools: readonly string[]): string[] {
  if (isReadOnly([...tools]) || tools.includes(ASK_USER_QUESTION)) return [...tools];
  return [...tools, ASK_USER_QUESTION];
}

export class TeamService {
  constructor(readonly templatesDir: string = DEFAULT_TEMPLATES_DIR) {}

  // ---------- templates ----------

  listTemplates(): TemplateView[] {
    if (!existsSync(this.templatesDir)) return [];
    return readdirSync(this.templatesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) => {
        const loaded = loadTeam(join(this.templatesDir, e.name));
        if (!loaded) return [];
        return [
          {
            ...view(loaded, join(this.templatesDir, e.name)),
            files: [TEAM_FILE, ...loaded.team.agents.map((a) => `${AGENTS_DIR}/${a.file}`)],
          },
        ];
      });
  }

  // ---------- a project's team ----------

  read(projectPath: string): TeamState {
    try {
      const loaded = loadTeam(projectPath);
      return loaded ? { status: 'ok', team: view(loaded, projectPath) } : { status: 'missing' };
    } catch (err) {
      return { status: 'invalid', error: (err as Error).message };
    }
  }

  /**
   * Writes a template into the project folder. Idempotent: files that already have the same
   * content are left alone. Files that exist with different content are only replaced with
   * `overwrite`; otherwise nothing is written and a 409 lists them (`extra.conflicts`).
   */
  install(projectPath: string, input: InstallInput): InstallResult {
    const templateRoot = join(this.templatesDir, input.templateId);
    if (!/^[a-z0-9-]+$/.test(input.templateId) || !existsSync(join(templateRoot, TEAM_FILE))) {
      throw new ServiceError(404, `"${input.templateId}" diye bir şablon yok`);
    }
    const template = loadTeam(templateRoot);
    if (!template) throw new ServiceError(404, `"${input.templateId}" diye bir şablon yok`);

    const ids = template.team.agents.map((a) => a.id);
    const enabled = input.agents ?? ids;
    const unknown = enabled.filter((id) => !ids.includes(id));
    if (unknown.length > 0) {
      throw new ServiceError(400, `Şablonda olmayan ajan: ${unknown.join(', ')}`);
    }
    if (enabled.length === 0) throw new ServiceError(400, 'Ekipte en az bir ajan açık olmalı');

    const raw = structuredClone(template.raw);
    const rawAgents = raw.agents as Record<string, unknown>[];
    for (const agent of rawAgents) agent.enabled = enabled.includes(String(agent.id));
    raw.settings = { ...template.team.settings, ...input.settings };
    // The project's test/lint/typecheck commands, written out so the user sees and edits them.
    if (raw.permissions === undefined) raw.permissions = { allow: detectAllowRules(projectPath) };
    const checked = TeamFile.safeParse(raw);
    if (!checked.success) {
      throw new ServiceError(400, `Ayarlar geçersiz: ${describeZodError(checked.error)}`);
    }

    const files = [
      { rel: TEAM_FILE, content: `${JSON.stringify(raw, null, 2)}\n` },
      ...template.team.agents.map((a) => ({
        rel: `${AGENTS_DIR}/${a.file}`,
        content: readText(agentFilePath(templateRoot, a.file)) ?? '',
      })),
    ];

    const conflicts: string[] = [];
    const unchanged: string[] = [];
    const toWrite: typeof files = [];
    for (const file of files) {
      const existing = readText(join(projectPath, file.rel));
      if (existing !== null && sameText(existing, file.content)) unchanged.push(file.rel);
      else {
        if (existing !== null) conflicts.push(file.rel);
        toWrite.push(file);
      }
    }
    if (conflicts.length > 0 && !input.overwrite) {
      throw new ServiceError(
        409,
        `Bu dosyalar zaten var ve içerikleri farklı: ${conflicts.join(', ')}. Üzerine yazılsın mı?`,
        { extra: { conflicts } },
      );
    }
    for (const file of toWrite) writeText(join(projectPath, file.rel), file.content);
    return { written: toWrite.map((f) => f.rel), unchanged };
  }

  updateSettings(projectPath: string, patch: Partial<ProjectSettings>): TeamView {
    const loaded = this.mustLoad(projectPath);
    const raw = structuredClone(loaded.raw);
    raw.settings = { ...loaded.team.settings, ...patch };
    this.writeTeamJson(projectPath, raw);
    return this.mustView(projectPath);
  }

  /** Saves the Ekip page's edit panel: switch and names to team.json, prompt and model to the .md. */
  updateAgent(projectPath: string, agentId: string, patch: AgentPatch): TeamView {
    const loaded = this.mustLoad(projectPath);
    const current = loaded.agents.find((a) => a.id === agentId);
    if (!current) throw new ServiceError(404, `Ekipte "${agentId}" diye bir ajan yok`);

    if (patch.enabled !== undefined || patch.names) {
      const raw = structuredClone(loaded.raw);
      const entry = (raw.agents as Record<string, unknown>[]).find((a) => a.id === agentId);
      if (!entry) throw new ServiceError(404, `Ekipte "${agentId}" diye bir ajan yok`);
      if (patch.enabled !== undefined) entry.enabled = patch.enabled;
      if (patch.names) entry.names = { ...current.names, ...patch.names };
      const enabledLeft = (raw.agents as Record<string, unknown>[]).some(
        (a) => a.enabled !== false,
      );
      if (!enabledLeft) throw new ServiceError(400, 'Ekipte en az bir ajan açık kalmalı');
      this.writeTeamJson(projectPath, raw);
    }

    if (patch.prompt !== undefined || patch.model !== undefined) {
      const label = `${AGENTS_DIR}/${current.file}`;
      const path = agentFilePath(projectPath, current.file);
      const def = parseAgentFile(readText(path) ?? '', label);
      if (!def.ok) throw new ServiceError(400, def.error);
      const prompt = patch.prompt ?? def.value.prompt;
      if (!prompt.trim()) throw new ServiceError(400, 'Talimat boş olamaz');
      const frontmatter = { ...def.value.frontmatter };
      if (patch.model === null) delete frontmatter.model;
      else if (patch.model !== undefined) frontmatter.model = patch.model;
      const text = formatAgentFile({ frontmatter, prompt });
      const again = parseAgentFile(text, label);
      if (!again.ok) throw new ServiceError(400, again.error);
      writeText(path, text);
    }
    return this.mustView(projectPath);
  }

  /**
   * How to run `agentId` in this project: from its definition, or `none` (use the default).
   * `extraRules` are the task's own grants (permission card "İzin ver" / "Bir kez").
   */
  runConfig(
    projectPath: string,
    agentId: string,
    extraRules: readonly string[] = [],
  ): AgentRunConfig {
    const state = this.read(projectPath);
    if (state.status !== 'ok') return { status: 'none' };
    const agent = state.team.agents.find((a) => a.id === agentId);
    if (!agent) return { status: 'none' };
    if (!agent.enabled) return { status: 'disabled', agent };
    const tools = withQuestionTool(agent.tools ?? DEFAULT_TOOLS);
    const options: AgentRunOptions = {
      permissionMode: agent.permissionMode ?? 'acceptEdits',
      // --tools is what really limits the agent (a read-only Reviewer gets only read tools).
      tools,
      // Its tools are auto-approved except Bash (a bare "Bash" would approve every shell command)
      // and AskUserQuestion (it must be denied to reach us); shell commands only by rule.
      allowedTools: buildAllowedTools(tools, [...state.team.permissions.allow, ...extraRules]),
      maxBudgetUsd: agent.budgetUsd,
      systemPrompt: agent.prompt,
    };
    if (agent.model) options.model = agent.model;
    return { status: 'ok', options, agent };
  }

  /**
   * "Hep izin ver": adds a rule to the project's `.team/team.json` (`permissions.allow`). When the
   * file has no list yet, the derived default list is written along with it, so nothing that was
   * allowed before stops being allowed.
   */
  addAllowRule(projectPath: string, rule: string): TeamView {
    const loaded = this.mustLoad(projectPath);
    const raw = structuredClone(loaded.raw);
    const current = loaded.team.permissions?.allow ?? detectAllowRules(projectPath);
    raw.permissions = {
      ...(typeof raw.permissions === 'object' ? raw.permissions : {}),
      allow: current.includes(rule) ? current : [...current, rule],
    };
    this.writeTeamJson(projectPath, raw);
    return this.mustView(projectPath);
  }

  // ---------- internals ----------

  private mustLoad(projectPath: string): LoadedTeam {
    let loaded: LoadedTeam | null;
    try {
      loaded = loadTeam(projectPath);
    } catch (err) {
      throw new ServiceError(400, (err as Error).message);
    }
    if (!loaded) throw new ServiceError(404, 'Bu projede henüz ekip kurulmamış');
    return loaded;
  }

  private mustView(projectPath: string): TeamView {
    return view(this.mustLoad(projectPath), projectPath);
  }

  private writeTeamJson(projectPath: string, raw: Record<string, unknown>): void {
    const checked = TeamFile.safeParse(raw);
    if (!checked.success) {
      throw new ServiceError(
        400,
        `${TEAM_FILE} geçersiz olurdu: ${describeZodError(checked.error)}`,
      );
    }
    writeText(join(projectPath, TEAM_FILE), `${JSON.stringify(raw, null, 2)}\n`);
  }
}
