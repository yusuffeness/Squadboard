import type { PermissionDenial } from './agent-event.js';
import { ASK_USER_QUESTION } from './agent-question.js';

/**
 * Permission requests and allow rules (docs/claude-cli-notes.md §17).
 *
 * `--tools` is the agent's tool set (the real limit); `--allowedTools` picks, from that set, what
 * runs without asking. A rule is either a bare tool name (`Read`) or a tool with a specifier:
 * `Bash(npm test:*)` (prefix) or `Bash(npm test)` (exact command). A bare `Bash` would approve
 * every shell command, so it is never auto-approved.
 */

/** `Read`, `Bash(npm test:*)`, `Bash(node -e "f(1,2)")`. */
export const ALLOW_RULE_RE = /^[A-Za-z][A-Za-z0-9_]*(\(.+\))?$/s;

/** The tool a rule is about: `Bash(npm test:*)` → `Bash`. */
export function ruleTool(rule: string): string {
  const i = rule.indexOf('(');
  return i < 0 ? rule : rule.slice(0, i);
}

/** Tools that must never be auto-approved as a whole. */
const NEVER_BARE: readonly string[] = ['Bash', ASK_USER_QUESTION];

/**
 * `--allowedTools` for an agent: its own tools (except Bash and AskUserQuestion, which must be
 * denied so the question reaches us) plus the rules whose tool the agent actually has. Rules for
 * other tools would do nothing (`--allowedTools` never adds a tool), so they are left out.
 */
export function buildAllowedTools(tools: readonly string[], rules: readonly string[]): string[] {
  const out = tools.filter((t) => !NEVER_BARE.includes(t));
  for (const rule of rules) {
    const tool = ruleTool(rule);
    if (!tools.includes(tool)) continue;
    if (NEVER_BARE.includes(rule)) continue;
    if (!out.includes(rule)) out.push(rule);
  }
  return out;
}

/** One thing the agent was not allowed to do, as the permission card shows it. */
export interface PermissionRequest {
  tool: string;
  /** Bash: the command line. */
  command: string | null;
  /** File tools: the file. */
  path: string | null;
  /** The rule that allows exactly this call again. */
  rule: string;
  input: Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** The narrowest rule that allows this exact call: the full command for Bash. */
export function ruleFor(toolName: string, input: Record<string, unknown>): string {
  const command = toolName === 'Bash' ? str(input.command) : null;
  return command ? `Bash(${command.trim()})` : toolName;
}

/**
 * Permission requests from a run's denials: AskUserQuestion is a question, not a permission;
 * the same call denied twice (the agent retried) is one request.
 */
export function permissionRequestsFrom(denials: readonly PermissionDenial[]): PermissionRequest[] {
  const out: PermissionRequest[] = [];
  for (const denial of denials) {
    if (denial.toolName === ASK_USER_QUESTION) continue;
    const rule = ruleFor(denial.toolName, denial.input);
    if (out.some((r) => r.rule === rule)) continue;
    out.push({
      tool: denial.toolName,
      command: denial.toolName === 'Bash' ? (str(denial.input.command)?.trim() ?? null) : null,
      path:
        str(denial.input.file_path) ?? str(denial.input.path) ?? str(denial.input.notebook_path),
      rule,
      input: denial.input,
    });
  }
  return out;
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** Scripts treated as "run the checks": tests, lint, type checking. */
export const CHECK_SCRIPTS: readonly string[] = [
  'test',
  'lint',
  'typecheck',
  'type-check',
  'check-types',
];

/**
 * The default allowlist of a project: its test, lint and typecheck scripts, as prefix rules for
 * the package manager it uses (both `<pm> <script>` and `<pm> run <script>`).
 */
export function defaultAllowRules(project: {
  scripts: readonly string[];
  packageManager: PackageManager;
}): string[] {
  const pm = project.packageManager;
  const rules: string[] = [];
  for (const script of CHECK_SCRIPTS) {
    if (!project.scripts.includes(script)) continue;
    // `npm lint` is not a thing; `npm test` is.
    if (pm !== 'npm' || script === 'test') rules.push(`Bash(${pm} ${script}:*)`);
    rules.push(`Bash(${pm} run ${script}:*)`);
  }
  return rules;
}
