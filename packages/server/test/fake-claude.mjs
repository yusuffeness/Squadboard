#!/usr/bin/env node
// Fake `claude` CLI for runner tests: replays a recorded stream-json fixture so CI never needs
// the real CLI or credits. It mimics the behaviours recorded in docs/claude-cli-notes.md:
//
// - `--output-format stream-json` without `--verbose` → stderr error, exit 1
// - sessions are bound to the cwd: `--resume <id>` from another directory → "No conversation found"
// - `--session-id <uuid>` is used as the session id; `--resume <id>` keeps the same id
//
// Controlled with environment variables:
//   FAKE_CLAUDE_FIXTURE    path of the .jsonl to replay (required)
//   FAKE_CLAUDE_HOME       where sessions are remembered (required for --resume)
//   FAKE_CLAUDE_DELAY_MS   delay between lines (default 2)
//   FAKE_CLAUDE_ARGS_FILE  write the received argv here as JSON
//   FAKE_CLAUDE_HANG       "1": after replaying, start a grandchild process and never exit
//   FAKE_CLAUDE_PIDS_FILE  with HANG: write {"self": pid, "grandchild": pid} here
//   FAKE_CLAUDE_WRITE      JSON {"relative/path": "content"}: files to write in the cwd, like
//                          an agent's edits (written before the replay starts)
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const env = process.env;

if (argv[0] === '--version') {
  process.stdout.write('0.0.0-fake (Claude Code)\n');
  process.exit(0);
}

if (env.FAKE_CLAUDE_ARGS_FILE) {
  writeFileSync(
    env.FAKE_CLAUDE_ARGS_FILE,
    JSON.stringify({ argv, cwd: process.cwd(), env: Object.keys(env) }),
  );
}

if (flag('--output-format') === 'stream-json' && !argv.includes('--verbose')) {
  process.stderr.write(
    'Error: When using --print, --output-format=stream-json requires --verbose\n',
  );
  process.exit(1);
}

// Sessions live per working directory, like ~/.claude/projects/<cwd-slug>/.
const sessionsDir = join(
  env.FAKE_CLAUDE_HOME ?? '.fake-claude',
  process.cwd().replace(/[^A-Za-z0-9]/g, '-'),
);
const resumeId = flag('--resume');
let sessionId;
if (resumeId) {
  if (!existsSync(join(sessionsDir, resumeId))) {
    process.stderr.write(`No conversation found with session ID: ${resumeId}\n`);
    process.exit(1);
  }
  sessionId = resumeId;
} else {
  sessionId = flag('--session-id') ?? randomUUID();
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, sessionId), '');
}

const fixture = env.FAKE_CLAUDE_FIXTURE;
if (!fixture) {
  process.stderr.write('fake-claude: FAKE_CLAUDE_FIXTURE is not set\n');
  process.exit(2);
}
const lines = readFileSync(fixture, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => l.replace(/"session_id":"[0-9a-f-]{36}"/g, `"session_id":"${sessionId}"`));

if (env.FAKE_CLAUDE_WRITE) {
  for (const [file, content] of Object.entries(JSON.parse(env.FAKE_CLAUDE_WRITE))) {
    const target = join(process.cwd(), file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

const delay = Number(env.FAKE_CLAUDE_DELAY_MS ?? 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let isError = false;
for (const line of lines) {
  process.stdout.write(line + '\n');
  if (line.includes('"type":"result"') && line.includes('"is_error":true')) isError = true;
  await sleep(delay);
}

if (env.FAKE_CLAUDE_HANG === '1') {
  // Like an agent waiting on a long Bash command: claude → shell → command.
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  if (env.FAKE_CLAUDE_PIDS_FILE) {
    writeFileSync(
      env.FAKE_CLAUDE_PIDS_FILE,
      JSON.stringify({ self: process.pid, grandchild: grandchild.pid }),
    );
  }
  setInterval(() => {}, 1000);
} else {
  process.exit(isError ? 1 : 0);
}
