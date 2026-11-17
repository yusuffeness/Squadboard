import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * How to invoke the Claude CLI. `args` are prepended to every call, which lets tests run
 * `node fake-claude.mjs` in place of the real binary.
 */
export interface ClaudeCommand {
  file: string;
  args: string[];
}

/**
 * Finds the real CLI. On Windows the npm `claude.cmd` shim only forwards to a native
 * `claude.exe`; running the .exe directly avoids the shell and its quoting problems
 * (docs/claude-cli-notes.md §8). Override with SQUADBOARD_CLAUDE_BIN.
 */
export function resolveClaudeCommand(env: NodeJS.ProcessEnv = process.env): ClaudeCommand {
  const override = env.SQUADBOARD_CLAUDE_BIN;
  if (override) return { file: override, args: [] };
  if (process.platform === 'win32') {
    const appData = env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    const candidates = [
      join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
      join(homedir(), '.local', 'bin', 'claude.exe'),
    ];
    for (const exe of candidates) if (existsSync(exe)) return { file: exe, args: [] };
  }
  // execa resolves PATH (and .cmd shims on Windows) for us.
  return { file: 'claude', args: [] };
}

/**
 * Variables a parent Claude Code session injects into its children. If Squadboard itself was
 * started from inside Claude Code they would leak into our runs and make the child behave like
 * a nested session (docs/claude-cli-notes.md §8). This is a deny-list on purpose: user
 * configuration such as CLAUDE_CONFIG_DIR, CLAUDE_CODE_USE_BEDROCK or ANTHROPIC_API_KEY stays.
 */
const INHERITED_SESSION_VARS = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_EMIT_STARTUP_TIMING',
  'CLAUDE_CODE_STARTUP_FAILURE_RESULTS',
  'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_CODE_ENABLE_TASKS',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_EFFORT',
  'CLAUDE_PID',
  'MCP_CONNECTION_NONBLOCKING',
]);

export function cleanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!INHERITED_SESSION_VARS.has(key.toUpperCase())) out[key] = value;
  }
  return out;
}

export type PermissionMode = 'acceptEdits' | 'default' | 'dontAsk' | 'plan';

export interface AgentRunOptions {
  /** Agent role instructions (`.team/<agent>.md` body), appended to Claude Code's system prompt. */
  systemPrompt?: string;
  /** Auto-approved tools, e.g. `['Read', 'Edit', 'Bash(npm test:*)']`. */
  allowedTools?: string[];
  /** Restricts the available tool set (read-only agents such as Planner and Reviewer). */
  tools?: string[];
  permissionMode?: PermissionMode;
  model?: string;
  /** Undocumented but working flag (claude-cli-notes §3); budget is the reliable limit. */
  maxTurns?: number;
  maxBudgetUsd?: number;
  /** `--json-schema`; the result then carries `structuredOutput`. */
  jsonSchema?: object;
}

export const DEFAULT_MAX_TURNS = 40;

export type SessionArg = { sessionId: string } | { resume: string };

/**
 * Builds the CLI arguments. Always stream-json + --verbose (required together, notes §1)
 * and --strict-mcp-config so the user's MCP servers do not join agent runs.
 * --dangerously-skip-permissions is never used.
 */
export function buildClaudeArgs(
  prompt: string,
  session: SessionArg,
  options: AgentRunOptions = {},
): string[] {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--strict-mcp-config'];
  if ('resume' in session) args.push('--resume', session.resume);
  else args.push('--session-id', session.sessionId);
  args.push('--permission-mode', options.permissionMode ?? 'acceptEdits');
  if (options.allowedTools?.length) args.push('--allowedTools', options.allowedTools.join(','));
  if (options.tools) args.push('--tools', options.tools.join(','));
  if (options.systemPrompt) args.push('--append-system-prompt', options.systemPrompt);
  if (options.model) args.push('--model', options.model);
  args.push('--max-turns', String(options.maxTurns ?? DEFAULT_MAX_TURNS));
  if (options.maxBudgetUsd !== undefined)
    args.push('--max-budget-usd', String(options.maxBudgetUsd));
  if (options.jsonSchema) args.push('--json-schema', JSON.stringify(options.jsonSchema));
  return args;
}
