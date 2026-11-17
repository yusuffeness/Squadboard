import { spawn, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Recordings live in core so its adapter tests keep working even if this spike is deleted.
export const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'core',
  'test',
  'fixtures',
  'claude-cli',
);

/**
 * On Windows the npm `claude` / `claude.cmd` shim just forwards to a native `claude.exe`.
 * Spawning the .exe directly avoids `shell: true` and its argument-quoting problems.
 */
export function findClaudeBin(): string {
  if (process.env.SQUADBOARD_CLAUDE_BIN) return process.env.SQUADBOARD_CLAUDE_BIN;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    const exe = join(
      appData,
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe',
    );
    if (existsSync(exe)) return exe;
  }
  return 'claude';
}

/**
 * Env for the child. Strips variables a parent Claude Code session injects (CLAUDECODE,
 * CLAUDE_CODE_*, ...), otherwise the child thinks it is a nested session.
 */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLAUDE|MCP_|OTEL_)/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}

// ---------- sandbox project ----------

export const SANDBOX_DIR = join(tmpdir(), 'squadboard-spike-sandbox');

const SANDBOX_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    { name: 'sandbox', version: '1.0.0', type: 'module', scripts: { test: 'node test.js' } },
    null,
    2,
  ),
  'math.js': 'export function add(a, b) {\n  return a + b;\n}\n',
  'test.js':
    "import { add } from './math.js';\nif (add(2, 3) !== 5) throw new Error('add failed');\nconsole.log('ok');\n",
  'README.md': '# Sandbox\n\nA tiny project used to explore `claude -p`.\n',
};

/** (Re)creates a small git repo that the agent is allowed to modify. */
export function resetSandbox(dir = SANDBOX_DIR): string {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(SANDBOX_FILES)) {
    writeFileSync(join(dir, name), content);
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git(
    '-c',
    'user.name=spike',
    '-c',
    'user.email=spike@example.invalid',
    'commit',
    '-q',
    '-m',
    'init',
  );
  return dir;
}

export function sandboxDiff(dir = SANDBOX_DIR): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
}

// ---------- sanitising (fixtures are committed to a public repo) ----------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const replacements: [RegExp, string][] = (() => {
  const list: [RegExp, string][] = [];
  const pathVariants = (p: string) => {
    const fwd = p.replace(/\\/g, '/');
    return [
      p.replace(/\\/g, '\\\\'),
      p,
      fwd,
      fwd.replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`),
    ];
  };
  // Longest first so the sandbox path wins over the home path.
  for (const [p, label] of [
    [SANDBOX_DIR, '<SANDBOX>'],
    [tmpdir(), '<TMP>'],
    [homedir(), '<HOME>'],
  ] as const) {
    for (const v of pathVariants(p)) list.push([new RegExp(escapeRegExp(v), 'gi'), label]);
  }
  // Claude's project-memory folder name is the path with every non-alphanumeric char turned into '-'.
  const slug = (p: string) => p.replace(/[^A-Za-z0-9]/g, '-');
  list.push([new RegExp(escapeRegExp(slug(SANDBOX_DIR)), 'gi'), '<SANDBOX_SLUG>']);
  list.push([new RegExp(escapeRegExp(slug(homedir())), 'gi'), '<HOME_SLUG>']);
  // Partial-message deltas split paths into fragments, so the bare user name can appear alone.
  const user = userInfo().username;
  if (user.length >= 3) list.push([new RegExp(`\\b${escapeRegExp(user)}\\b`, 'g'), '<USER>']);
  list.push([/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<EMAIL>']);
  // Thinking signatures are opaque base64 blobs that embed account/org identifiers.
  list.push([/"signature":"[^"]*"/g, '"signature":"<SIGNATURE>"']);
  list.push([
    /"signature_delta","signature":"[^"]*"/g,
    '"signature_delta","signature":"<SIGNATURE>"',
  ]);
  return list;
})();

export function sanitize(text: string): string {
  let out = text;
  for (const [re, label] of replacements) out = out.replace(re, label);
  return out;
}

// ---------- running ----------

export interface RunOptions {
  /** Fixture base name: writes fixtures/<name>.jsonl (or .json/.txt) and <name>.meta.json */
  name: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  /** Called for every stdout line; may return 'kill' to stop the process. */
  onLine?: (line: string, child: ChildProcess) => void;
  save?: boolean;
}

export interface RunResult {
  name: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** stdout lines with arrival time (ms since spawn) */
  lines: { t: number; line: string }[];
  pid: number | undefined;
}

export function runClaude(opts: RunOptions): Promise<RunResult> {
  const bin = findClaudeBin();
  const start = Date.now();
  const child = spawn(bin, opts.args, {
    cwd: opts.cwd ?? SANDBOX_DIR,
    env: cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const lines: { t: number; line: string }[] = [];
  let stdout = '';
  let stderr = '';
  let buf = '';
  let timedOut = false;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.length === 0) continue;
      lines.push({ t: Date.now() - start, line });
      opts.onLine?.(line, child);
    }
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child.pid);
  }, opts.timeoutMs ?? 180_000);

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      if (buf.trim().length > 0) lines.push({ t: Date.now() - start, line: buf.trim() });
      const result: RunResult = {
        name: opts.name,
        args: opts.args,
        exitCode,
        signal,
        durationMs: Date.now() - start,
        timedOut,
        stdout,
        stderr,
        lines,
        pid: child.pid,
      };
      if (opts.save !== false) saveFixture(result);
      resolve(result);
    });
  });
}

export function saveFixture(r: RunResult): void {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const fmtIdx = r.args.indexOf('--output-format');
  const fmt = fmtIdx >= 0 ? r.args[fmtIdx + 1] : 'text';
  const ext = fmt === 'stream-json' ? 'jsonl' : fmt === 'json' ? 'json' : 'txt';
  writeFileSync(join(FIXTURES_DIR, `${r.name}.${ext}`), sanitize(r.stdout));
  const meta = {
    name: r.name,
    claudeVersion: claudeVersion(),
    platform: process.platform,
    args: r.args.map((a) => (a.length > 400 ? `${a.slice(0, 400)}…` : a)),
    exitCode: r.exitCode,
    signal: r.signal,
    durationMs: r.durationMs,
    timedOut: r.timedOut,
    stderr: r.stderr,
    lineTimingsMs: r.lines.map((l) => l.t),
  };
  writeFileSync(
    join(FIXTURES_DIR, `${r.name}.meta.json`),
    sanitize(JSON.stringify(meta, null, 2)) + '\n',
  );
}

let cachedVersion: string | undefined;
export function claudeVersion(): string {
  cachedVersion ??= execFileSync(findClaudeBin(), ['--version'], {
    encoding: 'utf8',
    env: cleanEnv(),
  }).trim();
  return cachedVersion;
}

/** Kills a process and all its descendants. Windows needs taskkill /T; POSIX uses the process group. */
export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    // already gone
  }
}

export function parseJsonLines(r: RunResult): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const { line } of r.lines) {
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // non-JSON line; keep raw text visible in fixtures only
    }
  }
  return out;
}
