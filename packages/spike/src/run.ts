/**
 * Spike runner. Usage: pnpm --filter @squadboard/spike spike <experiment>
 * Experiments: basic | resume | perms | schema | karar | kill | all
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FIXTURES_DIR,
  killTree,
  parseJsonLines,
  resetSandbox,
  runClaude,
  sandboxDiff,
  sanitize,
  type RunResult,
} from './claude.js';

/** Common flags: cheap model, no MCP servers from user config, hard budget cap per run. */
const CHEAP = ['--model', 'haiku', '--strict-mcp-config', '--max-budget-usd', '0.50'];
const STREAM = ['--output-format', 'stream-json', '--verbose'];

function summarize(r: RunResult): void {
  const events = parseJsonLines(r);
  const types = events.map((e) => [e.type, e.subtype].filter(Boolean).join('/'));
  const counts: Record<string, number> = {};
  for (const t of types) counts[t] = (counts[t] ?? 0) + 1;
  const result = events.find((e) => e.type === 'result');
  console.log(`\n=== ${r.name}  exit=${r.exitCode} ${r.durationMs}ms lines=${r.lines.length}`);
  if (Object.keys(counts).length) console.log('  events:', JSON.stringify(counts));
  if (result) {
    const { result: text, ...rest } = result;
    console.log('  result fields:', Object.keys(result).join(', '));
    console.log(
      '  result:',
      sanitize(JSON.stringify({ ...rest, result: String(text).slice(0, 200) })).slice(0, 1500),
    );
  }
  if (r.stderr.trim()) console.log('  stderr:', sanitize(r.stderr.trim()).slice(0, 800));
  if (!events.length && r.stdout.trim())
    console.log('  stdout:', sanitize(r.stdout.trim()).slice(0, 800));
}

function sessionIdOf(r: RunResult): string | undefined {
  for (const e of parseJsonLines(r)) {
    if (typeof e.session_id === 'string') return e.session_id;
  }
  return undefined;
}

// ---------- 1. output formats ----------
async function basic(): Promise<void> {
  resetSandbox();
  const prompt = 'Read math.js and tell me in one sentence what it does.';
  summarize(
    await runClaude({ name: '01-json', args: ['-p', prompt, '--output-format', 'json', ...CHEAP] }),
  );
  summarize(
    await runClaude({
      name: '02-stream-no-verbose',
      args: ['-p', prompt, '--output-format', 'stream-json', ...CHEAP],
    }),
  );
  summarize(
    await runClaude({ name: '03-stream-verbose', args: ['-p', prompt, ...STREAM, ...CHEAP] }),
  );
  summarize(
    await runClaude({
      name: '04-stream-partial',
      args: ['-p', prompt, ...STREAM, '--include-partial-messages', ...CHEAP],
    }),
  );
}

// ---------- 2. resume ----------
async function resume(): Promise<void> {
  resetSandbox();
  const first = await runClaude({
    name: '05-resume-first',
    args: [
      '-p',
      "Remember the secret word 'pelican'. Reply with only: OK",
      '--output-format',
      'json',
      ...CHEAP,
    ],
  });
  summarize(first);
  const sid = sessionIdOf(first);
  if (!sid) throw new Error('no session_id in first run');

  const second = await runClaude({
    name: '06-resume-json',
    args: [
      '-p',
      'What was the secret word? Reply with only the word.',
      '--resume',
      sid,
      '--output-format',
      'json',
      ...CHEAP,
    ],
  });
  summarize(second);
  console.log(
    `  session_id first=${sid} second=${sessionIdOf(second) ?? '-'} same=${sid === sessionIdOf(second)}`,
  );

  const third = await runClaude({
    name: '07-resume-stream',
    args: [
      '-p',
      'Spell the secret word backwards. Reply with only that.',
      '--resume',
      sid,
      ...STREAM,
      ...CHEAP,
    ],
  });
  summarize(third);
  console.log(`  third session_id=${sessionIdOf(third) ?? '-'} same=${sid === sessionIdOf(third)}`);

  const fork = await runClaude({
    name: '08-resume-fork',
    args: [
      '-p',
      'What was the secret word?',
      '--resume',
      sid,
      '--fork-session',
      '--output-format',
      'json',
      ...CHEAP,
    ],
  });
  summarize(fork);
  console.log(`  fork session_id=${sessionIdOf(fork) ?? '-'} same=${sid === sessionIdOf(fork)}`);

  const custom = randomUUID();
  const own = await runClaude({
    name: '09-session-id',
    args: [
      '-p',
      'Reply with only: OK',
      '--session-id',
      custom,
      '--output-format',
      'json',
      ...CHEAP,
    ],
  });
  summarize(own);
  console.log(
    `  requested=${custom} got=${sessionIdOf(own) ?? '-'} same=${custom === sessionIdOf(own)}`,
  );

  const bogus = await runClaude({
    name: '10-resume-unknown',
    args: ['-p', 'hi', '--resume', randomUUID(), '--output-format', 'json', ...CHEAP],
  });
  summarize(bogus);
}

// ---------- 3. permissions ----------
async function perms(): Promise<void> {
  const task =
    'Add an exported `subtract(a, b)` function to math.js. Then run `npm test` with the Bash tool and report its output. Do not ask me anything.';
  const cases: { name: string; flags: string[] }[] = [
    {
      name: '11-perm-acceptEdits-no-bash',
      flags: ['--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write'],
    },
    {
      name: '12-perm-acceptEdits-bash-npm-test',
      flags: [
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        'Read,Edit,Write,Bash(npm test:*)',
      ],
    },
    { name: '13-perm-default', flags: ['--permission-mode', 'default'] },
    {
      name: '14-perm-dontAsk',
      flags: ['--permission-mode', 'dontAsk', '--allowedTools', 'Read,Edit'],
    },
    { name: '15-max-turns', flags: ['--permission-mode', 'acceptEdits', '--max-turns', '1'] },
  ];
  for (const c of cases) {
    resetSandbox();
    const r = await runClaude({
      name: c.name,
      args: ['-p', task, ...STREAM, ...c.flags, ...CHEAP],
    });
    summarize(r);
    console.log('  sandbox changes:', JSON.stringify(sandboxDiff()));
    const denied = parseJsonLines(r)
      .filter((e) => e.type === 'user')
      .map((e) => JSON.stringify(e.message))
      .filter((m) => /permission|denied|not allowed|requested permissions/i.test(m));
    if (denied.length)
      console.log('  denial tool_results:', sanitize(denied.join('\n')).slice(0, 1200));
  }
}

// ---------- 4. structured output ----------
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'agent', 'dependsOn', 'expectedFiles'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          agent: { type: 'string', enum: ['frontend', 'backend', 'database', 'test'] },
          dependsOn: { type: 'array', items: { type: 'string' } },
          expectedFiles: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

async function schema(): Promise<void> {
  resetSandbox();
  const prompt =
    'You are a planner. Split this request into 2-4 tasks for agents (frontend, backend, database, test): ' +
    '"Add user sign-up with email and password: a users table, a POST /signup endpoint, a sign-up form, and tests." ' +
    'Do not modify any files.';
  const schemaArg = JSON.stringify(PLAN_SCHEMA);
  summarize(
    await runClaude({
      name: '16-json-schema',
      args: [
        '-p',
        prompt,
        '--json-schema',
        schemaArg,
        '--output-format',
        'json',
        '--tools',
        'Read,Glob,Grep',
        ...CHEAP,
      ],
    }),
  );
  summarize(
    await runClaude({
      name: '17-json-schema-stream',
      args: [
        '-p',
        prompt,
        '--json-schema',
        schemaArg,
        ...STREAM,
        '--tools',
        'Read,Glob,Grep',
        ...CHEAP,
      ],
    }),
  );
}

// ---------- 5. KARAR reliability ----------
const KARAR_SYSTEM = `You are the Backend agent of this project.
If the task leaves an important choice open that the user should make (e.g. which library, which approach, a product decision),
DO NOT guess and DO NOT modify any files. Stop immediately and end your final message with exactly one block in this format:

\`\`\`karar
{"question": "<one sentence question for the user>", "options": ["<option 1>", "<option 2>", "..."]}
\`\`\`

The block must be valid JSON with 2-4 options. Write nothing after the block.
If no decision is needed, just do the task and do not write a karar block.`;

/** Variant with explicit criteria for what counts as a decision. */
const KARAR_SYSTEM_STRICT = `You are the Backend agent of this project.
Before you modify ANY file, check whether the task leaves any of these unspecified:
- storage technology or file format
- adding a new dependency or library
- public API shape or function names
- data schema
- behaviour visible to end users
If ANY of them is unspecified, you must NOT pick a default yourself and must NOT modify files.
Stop immediately and end your final message with exactly one block in this format:

\`\`\`karar
{"question": "<one sentence question for the user>", "options": ["<option 1>", "<option 2>", "..."]}
\`\`\`

The block must be valid JSON with 2-4 options. Write nothing after the block.
Only if the task specifies all of the above, do the task without a karar block.`;

const KARAR_AMBIGUOUS =
  'Add persistence to this project so that results of add() are stored and can be listed later.';
const KARAR_CLEAR = 'Add an exported subtract(a, b) function to math.js that returns a - b.';

interface KararVerdict {
  hasBlock: boolean;
  validJson: boolean;
  optionsOk: boolean;
  atEnd: boolean;
  noEdits: boolean;
  ok: boolean;
  question?: string;
}

function judgeKarar(resultText: string, changes: string): KararVerdict {
  const match = /```karar\s*\n([\s\S]*?)\n?```\s*$/.exec(resultText.trim());
  const anyBlock = /```karar/.test(resultText);
  let validJson = false;
  let optionsOk = false;
  let question: string | undefined;
  if (match?.[1]) {
    try {
      const parsed = JSON.parse(match[1]) as { question?: unknown; options?: unknown };
      validJson = typeof parsed.question === 'string';
      if (validJson) question = parsed.question as string;
      optionsOk =
        Array.isArray(parsed.options) &&
        parsed.options.length >= 2 &&
        parsed.options.length <= 4 &&
        parsed.options.every((o) => typeof o === 'string');
    } catch {
      validJson = false;
    }
  }
  const noEdits = changes.trim() === '';
  const verdict: KararVerdict = {
    hasBlock: anyBlock,
    validJson,
    optionsOk,
    atEnd: match !== null,
    noEdits,
    ok: match !== null && validJson && optionsOk && noEdits,
  };
  if (question !== undefined) verdict.question = question;
  return verdict;
}

async function karar(): Promise<void> {
  const runs = Number(process.env.KARAR_RUNS ?? 10);
  const controls = Number(process.env.KARAR_CONTROLS ?? 3);
  const model = process.env.KARAR_MODEL ?? 'sonnet';
  const variant = process.env.KARAR_VARIANT === 'strict' ? 'strict' : 'base';
  const system = variant === 'strict' ? KARAR_SYSTEM_STRICT : KARAR_SYSTEM;
  const flags = [
    ...STREAM,
    '--model',
    model,
    '--strict-mcp-config',
    '--max-budget-usd',
    '1.00',
    '--append-system-prompt',
    system,
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    'Read,Edit,Write,Glob,Grep',
  ];
  const rows: Record<string, unknown>[] = [];

  const one = async (kind: 'ambiguous' | 'clear', i: number) => {
    const dir = resetSandbox(join(tmpdir(), `squadboard-spike-karar-${variant}-${kind}-${i}`));
    const r = await runClaude({
      name: `karar-${variant}-${kind}-${String(i).padStart(2, '0')}`,
      args: ['-p', kind === 'ambiguous' ? KARAR_AMBIGUOUS : KARAR_CLEAR, ...flags],
      cwd: dir,
      save: i === 1, // keep one full fixture per kind; others summarised below
    });
    const res = parseJsonLines(r).find((e) => e.type === 'result');
    const text = typeof res?.result === 'string' ? res.result : '';
    const changes = sandboxDiff(dir);
    const v = judgeKarar(text, changes);
    const row = {
      kind,
      run: i,
      model,
      ...v,
      changes: changes.trim(),
      numTurns: res?.num_turns,
      costUsd: res?.total_cost_usd,
      durationMs: r.durationMs,
      tail: text.slice(-400),
    };
    rows.push(row);
    console.log(
      `${variant} ${kind} #${i}: ok=${v.ok} block=${v.hasBlock} json=${v.validJson} end=${v.atEnd} noEdits=${v.noEdits} turns=${String(res?.num_turns)}`,
    );
  };

  // Small concurrency pool (3) to keep wall time reasonable.
  const jobs: (() => Promise<void>)[] = [];
  for (let i = 1; i <= runs; i++) jobs.push(() => one('ambiguous', i));
  for (let i = 1; i <= controls; i++) jobs.push(() => one('clear', i));
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) await job();
  };
  await Promise.all([worker(), worker(), worker()]);

  rows.sort(
    (a, b) => String(a.kind).localeCompare(String(b.kind)) || Number(a.run) - Number(b.run),
  );
  const amb = rows.filter((r) => r.kind === 'ambiguous');
  const clr = rows.filter((r) => r.kind === 'clear');
  const summary = {
    model,
    variant,
    system,
    ambiguousPrompt: KARAR_AMBIGUOUS,
    clearPrompt: KARAR_CLEAR,
    ambiguousOk: `${amb.filter((r) => r.ok).length}/${amb.length}`,
    clearFalsePositives: `${clr.filter((r) => r.hasBlock).length}/${clr.length}`,
    rows,
  };
  writeFileSync(
    join(FIXTURES_DIR, `karar-${variant}-results.json`),
    sanitize(JSON.stringify(summary, null, 2)) + '\n',
  );
  console.log(
    `\nKARAR ambiguous ok: ${summary.ambiguousOk}, clear false positives: ${summary.clearFalsePositives}`,
  );
}

// ---------- 6. kill ----------
const MARKER = 'squadboard-spike-marker';

function survivors(): string[] {
  if (process.platform !== 'win32') {
    try {
      return execFileSync('pgrep', ['-af', MARKER], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
    } catch {
      return [];
    }
  }
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${MARKER}*' -and $_.Name -ne 'powershell.exe' } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`,
    ],
    { encoding: 'utf8' },
  );
  return out.trim().split(/\r?\n/).filter(Boolean);
}

async function killExperiment(mode: 'child.kill' | 'taskkill-tree'): Promise<void> {
  resetSandbox();
  const prompt = `Run this exact command with the Bash tool and wait for it to finish: node -e "setTimeout(()=>{}, 120000)" ${MARKER}`;
  let killedAt: number | undefined;
  const start = Date.now();
  const r = await runClaude({
    name: `18-kill-${mode}`,
    args: [
      '-p',
      prompt,
      ...STREAM,
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Bash',
      ...CHEAP,
    ],
    timeoutMs: 150_000,
    onLine: (line, child) => {
      if (killedAt !== undefined) return;
      if (line.includes('"tool_use"') && line.includes(MARKER)) {
        // give the shell a moment to actually spawn node
        setTimeout(() => {
          console.log(`  [${mode}] before kill, marker processes:`, survivors());
          killedAt = Date.now() - start;
          if (mode === 'child.kill') child.kill();
          else killTree(child.pid);
        }, 4000);
      }
    },
  });
  summarize(r);
  await new Promise((res) => setTimeout(res, 2000));
  const left = survivors();
  console.log(
    `  [${mode}] killedAt=${killedAt ?? '-'}ms closedAt=${r.durationMs}ms survivors after 2s:`,
    left,
  );
  // clean up whatever leaked so the next experiment starts clean
  for (const s of left) killTree(Number(s.split(' ')[0]));
  writeFileSync(
    join(FIXTURES_DIR, `18-kill-${mode}.result.json`),
    JSON.stringify(
      {
        mode,
        killedAtMs: killedAt,
        closedAtMs: r.durationMs,
        exitCode: r.exitCode,
        signal: r.signal,
        survivors: left,
      },
      null,
      2,
    ) + '\n',
  );
}

async function kill(): Promise<void> {
  await killExperiment('child.kill');
  await killExperiment('taskkill-tree');
}

// ---------- 7. follow-ups: resume after KARAR, resume from another cwd, resume a killed run ----------
function sessionIdFromFixture(file: string): string {
  const m = /"session_id":"([0-9a-f-]{36})"/.exec(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
  if (!m?.[1]) throw new Error(`no session_id in ${file}`);
  return m[1];
}

async function followups(): Promise<void> {
  // a) answer a KARAR via --resume in the same worktree
  const kararDir = join(tmpdir(), 'squadboard-spike-karar-strict-ambiguous-1');
  const kararSid = sessionIdFromFixture('karar-strict-ambiguous-01.jsonl');
  const a = await runClaude({
    name: '19-karar-resume-answer',
    cwd: kararDir,
    args: [
      '-p',
      'Karar: JSON file (results.json). Continue the task.',
      '--resume',
      kararSid,
      ...STREAM,
      '--model',
      'sonnet',
      '--strict-mcp-config',
      '--max-budget-usd',
      '1.00',
      '--append-system-prompt',
      KARAR_SYSTEM_STRICT,
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Read,Edit,Write,Glob,Grep',
    ],
  });
  summarize(a);
  const aText = String(parseJsonLines(a).find((e) => e.type === 'result')?.result ?? '');
  console.log(
    '  same session:',
    sessionIdOf(a) === kararSid,
    ' changes:',
    JSON.stringify(sandboxDiff(kararDir)),
    ' new karar block:',
    aText.includes('```karar'),
  );

  // b) same session id, different cwd (a different worktree)
  resetSandbox();
  summarize(
    await runClaude({
      name: '20-resume-other-cwd',
      args: [
        '-p',
        'Reply with only: OK',
        '--resume',
        kararSid,
        '--output-format',
        'json',
        ...CHEAP,
      ],
    }),
  );

  // c) resume the run that was killed mid tool-call
  const killedSid = sessionIdFromFixture('18-kill-taskkill-tree.jsonl');
  const c = await runClaude({
    name: '21-resume-killed',
    args: [
      '-p',
      'The previous command was interrupted. Do not run it again. In one sentence: what were you doing?',
      '--resume',
      killedSid,
      '--output-format',
      'json',
      ...CHEAP,
    ],
  });
  summarize(c);
}

/** Re-applies sanitize() to every fixture (after improving the sanitizer). */
async function resanitize(): Promise<void> {
  for (const f of readdirSync(FIXTURES_DIR)) {
    const p = join(FIXTURES_DIR, f);
    writeFileSync(p, sanitize(readFileSync(p, 'utf8')));
  }
}

const experiments: Record<string, () => Promise<void>> = {
  basic,
  resume,
  perms,
  schema,
  karar,
  kill,
  followups,
  resanitize,
};

const name = process.argv[2] ?? '';
if (name === 'all') {
  for (const fn of Object.values(experiments)) await fn();
} else {
  const fn = experiments[name];
  if (!fn) {
    console.error(
      `Unknown experiment "${name}". Use one of: ${Object.keys(experiments).join(', ')}, all`,
    );
    process.exit(1);
  }
  await fn();
}
