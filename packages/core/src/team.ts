import { z } from 'zod';
import { ALLOW_RULE_RE } from './permission.js';
import { ProjectSettings } from './schemas.js';

/**
 * Team definition kept in the user's repository (docs/ARCHITECTURE.md → "Ajan ve ekip şablonu
 * formatı"):
 *
 * - `.team/team.json`: who is in the team, both display names, colour, owned paths, settings.
 * - `.claude/agents/<file>.md`: Claude Code subagent format (YAML front matter + system prompt).
 *
 * Users may edit both by hand, so every error message here is Turkish and names the field.
 */

export const TEAM_FILE = '.team/team.json';
export const AGENTS_DIR = '.claude/agents';

/** Model aliases offered in the UI; a full model name is accepted too. */
export const AGENT_MODELS = ['haiku', 'sonnet', 'opus'] as const;

/** Tools that cannot change files. An agent with only these is read-only. */
export const READ_ONLY_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep'];

export const PERMISSION_MODES = ['acceptEdits', 'default', 'dontAsk', 'plan'] as const;
export type AgentPermissionMode = (typeof PERMISSION_MODES)[number];

const nonEmpty = (what: string, max: number) =>
  z
    .string({ error: `${what} yazı olmalı` })
    .trim()
    .min(1, `${what} boş olamaz`)
    .max(max, `${what} en fazla ${max} karakter olabilir`);

/** Claude Code subagent name rule: lowercase and hyphens; must not contain "claude"/"anthropic". */
export const AgentId = z
  .string({ error: 'Ajan kimliği yazı olmalı' })
  .regex(
    /^[a-z][a-z0-9-]{0,39}$/,
    'Ajan kimliği küçük harf, rakam ve tireden oluşmalı (ör. "backend")',
  )
  .refine((id) => !/claude|anthropic/.test(id), {
    error: 'Ajan kimliği "claude" ya da "anthropic" içeremez',
  });

const ToolName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Araç adı yalnızca harf ve rakam olmalı (ör. "Read")');

export const TeamAgent = z.object({
  id: AgentId,
  /** File name inside `.claude/agents/`. */
  file: z
    .string({ error: 'file yazı olmalı' })
    .regex(/^[a-z0-9][a-z0-9._-]*\.md$/i, 'file bir .md dosya adı olmalı (ör. "backend.md")'),
  names: z.object(
    { tech: nonEmpty('Teknik ad', 40), friendly: nonEmpty('Sade ad', 40) },
    { error: 'names alanı { "tech": …, "friendly": … } olmalı' },
  ),
  color: z
    .string({ error: 'color yazı olmalı' })
    .regex(/^#[0-9a-fA-F]{6}$/, 'color "#RRGGBB" biçiminde bir renk olmalı'),
  /** Paths the agent is expected to touch (glob patterns). */
  owns: z.array(z.string().trim().min(1, 'owns içinde boş yol olamaz')).default([]),
  /** Switched off in the Ekip page: not offered for new tasks. */
  enabled: z.boolean({ error: 'enabled true ya da false olmalı' }).default(true),
  /** Spending limit per run in USD (`--max-budget-usd`). Default 1. */
  budgetUsd: z
    .number({ error: 'budgetUsd sayı olmalı' })
    .positive('budgetUsd sıfırdan büyük olmalı')
    .max(100, 'budgetUsd en fazla 100 olabilir')
    .optional(),
});
export type TeamAgent = z.infer<typeof TeamAgent>;

export const TeamFile = z
  .object({
    id: z
      .string({ error: 'id yazı olmalı' })
      .regex(/^[a-z0-9][a-z0-9-]{0,49}$/, 'id küçük harf, rakam ve tireden oluşmalı'),
    name: nonEmpty('name', 80),
    description: z.string().trim().max(200).optional(),
    agents: z
      .array(TeamAgent, { error: 'agents bir liste olmalı' })
      .min(1, 'Ekipte en az bir ajan olmalı'),
    settings: ProjectSettings,
    /**
     * Project-wide allow rules (`--allowedTools`), e.g. `Bash(npm test:*)`. Only matter for agents
     * whose `tools` include the rule's tool. Missing = derived from the project's scripts.
     */
    permissions: z
      .object(
        {
          allow: z.array(
            z
              .string({ error: 'permissions.allow içinde yazı olmalı' })
              .trim()
              .max(1000, 'Kural en fazla 1000 karakter olabilir')
              .regex(
                ALLOW_RULE_RE,
                'Kural "Araç" ya da "Araç(…)" biçiminde olmalı (ör. "Bash(npm test:*)")',
              )
              .refine((rule) => rule !== 'Bash', {
                error: 'Çıplak "Bash" her kabuk komutuna izin verir; "Bash(npm test:*)" gibi yaz',
              }),
            { error: 'permissions.allow bir liste olmalı' },
          ),
        },
        { error: 'permissions alanı { "allow": [...] } olmalı' },
      )
      .optional(),
  })
  .superRefine((team, ctx) => {
    const ids = new Set<string>();
    const files = new Set<string>();
    team.agents.forEach((agent, i) => {
      if (ids.has(agent.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['agents', i, 'id'],
          message: `"${agent.id}" kimliği iki kez kullanılmış`,
        });
      }
      if (files.has(agent.file.toLowerCase())) {
        ctx.addIssue({
          code: 'custom',
          path: ['agents', i, 'file'],
          message: `"${agent.file}" dosyası iki ajana verilmiş`,
        });
      }
      ids.add(agent.id);
      files.add(agent.file.toLowerCase());
    });
  });
export type TeamFile = z.infer<typeof TeamFile>;
export type TeamFileInput = z.input<typeof TeamFile>;

/** Front matter of `.claude/agents/<file>.md` (Claude Code subagent fields we use). */
export const AgentFrontmatter = z.object({
  name: AgentId,
  description: nonEmpty('description', 300),
  /** Missing = Squadboard's safe default (no shell). Empty list = no tools at all. */
  tools: z.array(ToolName).optional(),
  model: z.string().trim().min(1).max(80).optional(),
  permissionMode: z
    .enum(PERMISSION_MODES, {
      error: `permissionMode şunlardan biri olmalı: ${PERMISSION_MODES.join(', ')}`,
    })
    .optional(),
});
export type AgentFrontmatter = z.infer<typeof AgentFrontmatter>;

export interface AgentDefinition {
  frontmatter: AgentFrontmatter;
  /** The system prompt (Markdown body under the front matter). */
  prompt: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** "agents[1].color: color "#RRGGBB" biçiminde…" (first few issues). */
export function describeZodError(error: z.ZodError, max = 3): string {
  return error.issues
    .slice(0, max)
    .map((issue) => {
      const path = issue.path
        .map((p, i) => (typeof p === 'number' ? `[${p}]` : `${i > 0 ? '.' : ''}${String(p)}`))
        .join('');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/** Parses and validates the text of `.team/team.json`. */
export function parseTeamFile(text: string): Parsed<TeamFile> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `${TEAM_FILE} geçerli bir JSON değil (${(err as Error).message})` };
  }
  const result = TeamFile.safeParse(json);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: `${TEAM_FILE} geçersiz: ${describeZodError(result.error)}` };
}

// ---------- agent Markdown (YAML front matter subset) ----------

/**
 * Reads the front matter Claude Code writes and documents: `key: value` lines, values optionally
 * quoted; lists either as `a, b`, `[a, b]` or `- a` lines. Not a full YAML parser on purpose.
 */
function parseFrontmatterBlock(block: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const list = out[listKey];
      const value = unquote(item[1] ?? '');
      if (Array.isArray(list)) list.push(value);
      else out[listKey] = [value];
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`başlıkta anlaşılmayan satır: "${line.trim()}"`);
    const key = kv[1] ?? '';
    const value = (kv[2] ?? '').trim();
    listKey = value === '' ? key : null;
    if (value === '') out[key] = [];
    else if (value.startsWith('[') && value.endsWith(']')) out[key] = splitList(value.slice(1, -1));
    else out[key] = unquote(value);
  }
  return out;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return String(JSON.parse(v));
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'"))
    return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map(unquote)
    .filter((v) => v !== '');
}

/** Parses `.claude/agents/<file>.md`. `label` names the file in error messages. */
export function parseAgentFile(text: string, label: string): Parsed<AgentDefinition> {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) {
    return {
      ok: false,
      error: `${label}: dosya "---" ile başlayan bir başlık bölümüyle başlamalı`,
    };
  }
  let fields: Record<string, string | string[]>;
  try {
    fields = parseFrontmatterBlock(match[1] ?? '');
  } catch (err) {
    return { ok: false, error: `${label}: ${(err as Error).message}` };
  }
  const tools = fields.tools;
  const candidate = {
    ...fields,
    tools: typeof tools === 'string' ? splitList(tools) : tools,
  };
  const result = AgentFrontmatter.safeParse(candidate);
  if (!result.success) {
    return { ok: false, error: `${label} geçersiz: ${describeZodError(result.error)}` };
  }
  const prompt = (match[2] ?? '').trim();
  if (!prompt)
    return { ok: false, error: `${label}: başlığın altında talimat (sistem prompt'u) yok` };
  return { ok: true, value: { frontmatter: result.data, prompt } };
}

function yamlValue(value: string): string {
  // Quote only when YAML would misread the value.
  return /^[\s"'[\]{}>|*&!%@`#,?:-]|:\s|\s#|\s$/.test(value) ? JSON.stringify(value) : value;
}

/** Writes an agent file in the format Claude Code documents. */
export function formatAgentFile({ frontmatter, prompt }: AgentDefinition): string {
  const lines = [
    '---',
    `name: ${frontmatter.name}`,
    `description: ${yamlValue(frontmatter.description)}`,
  ];
  if (frontmatter.tools) lines.push(`tools: ${frontmatter.tools.join(', ')}`);
  if (frontmatter.model) lines.push(`model: ${yamlValue(frontmatter.model)}`);
  if (frontmatter.permissionMode) lines.push(`permissionMode: ${frontmatter.permissionMode}`);
  lines.push('---', '', prompt.trim(), '');
  return lines.join('\n');
}

/** True when the agent cannot change files (shown as "Salt okuma"). */
export function isReadOnly(tools: readonly string[] | undefined): boolean {
  return tools !== undefined && tools.every((t) => READ_ONLY_TOOLS.includes(t));
}
