/**
 * Manual check for Stage 3: runs ONE real `claude -p` task through the Runner and shows what
 * ended up in the database. Uses the real CLI and your Claude login, so it spends a little of
 * the headless-usage credit (haiku, read-only tools, hard budget cap).
 *
 *   pnpm --filter @squadboard/server try                      # default prompt
 *   pnpm --filter @squadboard/server try "your prompt here"
 *
 * Database: ~/.squadboard/squadboard.db (override with SQUADBOARD_DB).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/index.js';
import {
  createProject,
  createRequest,
  createTask,
  getRun,
  listEvents,
} from '../src/db/repository.js';
import { resolveClaudeCommand } from '../src/runner/claude-cli.js';
import { Runner } from '../src/runner/runner.js';

const prompt =
  process.argv[2] ?? 'Read math.js and explain in one sentence what it does. Do not modify files.';

// A throwaway project so the agent cannot touch your real code.
const sandbox = mkdtempSync(join(tmpdir(), 'squadboard-try-'));
writeFileSync(join(sandbox, 'math.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
execFileSync('git', ['init', '-q'], { cwd: sandbox });

const { db, path, close } = openDatabase();
const project = createProject(db, { path: sandbox });
const request = createRequest(db, { projectId: project.id, text: prompt });
const task = createTask(db, {
  requestId: request.id,
  title: 'Try runner',
  agent: 'backend',
  worktreePath: sandbox,
});

const claude = resolveClaudeCommand();
console.log(`claude:   ${claude.file}`);
console.log(`database: ${path}`);
console.log(`sandbox:  ${sandbox}`);
console.log(`prompt:   ${prompt}\n`);

const runner = new Runner({ db });
runner.on('event', ({ seq, event }) => {
  const detail =
    event.kind === 'text' || event.kind === 'thinking'
      ? event.text.slice(0, 100).replace(/\s+/g, ' ')
      : event.kind === 'tool_use'
        ? `${event.name} ${JSON.stringify(event.input).slice(0, 80)}`
        : event.kind === 'result'
          ? `${event.subtype} cost=$${String(event.costUsd)} turns=${String(event.numTurns)}`
          : event.kind === 'error'
            ? `${event.code}: ${event.message}`
            : '';
  console.log(`#${String(seq).padStart(3)} ${event.kind.padEnd(16)} ${detail}`);
});

// Ctrl+C stops the run (and its whole process tree) instead of leaving it behind.
process.once('SIGINT', () => {
  console.log('\nStopping…');
  void runner.stopAll();
});

const handle = runner.start({
  taskId: task.id,
  prompt,
  cwd: sandbox,
  model: 'haiku',
  tools: ['Read', 'Glob', 'Grep'],
  maxTurns: 10,
  maxBudgetUsd: 0.25,
});
const outcome = await handle.done;

const run = getRun(db, handle.runId);
const stored = listEvents(db, handle.runId);
const byKind: Record<string, number> = {};
for (const e of stored) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;

console.log('\n--- from the database ---');
console.log(`run ${handle.runId}`);
console.log(
  `  status=${String(run?.status)} task=${outcome.taskStatus} exit=${String(run?.exitCode)} cost=$${String(run?.costUsd)} turns=${String(run?.numTurns)}`,
);
console.log(`  session=${handle.sessionId} cwd=${String(run?.cwd)}`);
if (outcome.error) console.log(`  error: ${outcome.error}`);
console.log(
  `  ${stored.length} events, seq ${stored[0]?.seq ?? '-'}..${stored.at(-1)?.seq ?? '-'}:`,
  byKind,
);
if (outcome.result?.text) console.log(`\nAnswer: ${outcome.result.text}`);

close();
