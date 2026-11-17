import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClaudeCommand } from '../src/runner/claude-cli.js';

export const FAKE_CLAUDE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
export const FIXTURES = fileURLToPath(
  new URL('../../core/test/fixtures/claude-cli/', import.meta.url),
);

export const fakeClaude: ClaudeCommand = { file: process.execPath, args: [FAKE_CLAUDE] };

export interface TempWorkspace {
  dir: string;
  /** A directory to use as the agent's cwd. */
  cwd: string;
  dbPath: string;
  pidsFile: string;
}

export function makeWorkspace(prefix = 'squadboard-test-'): TempWorkspace {
  // realpath: on Windows CI tmpdir() is an 8.3 short path (RUNNER~1) while git reports long paths.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  const cwd = join(dir, 'project');
  mkdirSync(cwd);
  return { dir, cwd, dbPath: join(dir, 'test.db'), pidsFile: join(dir, 'pids.json') };
}

/** Environment for the fake CLI: which fixture to replay and how. */
export function fakeEnv(
  ws: TempWorkspace,
  fixture: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FAKE_CLAUDE_FIXTURE: join(FIXTURES, fixture),
    FAKE_CLAUDE_HOME: join(ws.dir, 'fake-home'),
    ...extra,
  };
}

/** Env for a run that never finishes and has a grandchild process (to test stopping). */
export function hangingEnv(ws: TempWorkspace): NodeJS.ProcessEnv {
  return fakeEnv(ws, '18-kill-taskkill-tree.jsonl', {
    FAKE_CLAUDE_HANG: '1',
    FAKE_CLAUDE_PIDS_FILE: ws.pidsFile,
  });
}

export async function waitFor<T>(fn: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

export function waitForPids(ws: TempWorkspace): Promise<{ self: number; grandchild: number }> {
  return waitFor(() =>
    existsSync(ws.pidsFile)
      ? (JSON.parse(readFileSync(ws.pidsFile, 'utf8')) as { self: number; grandchild: number })
      : undefined,
  );
}

export interface SseFrame {
  id?: string;
  event: string;
  data: unknown;
}

/** Parses a text/event-stream body into frames (comments ignored). */
export function parseSse(body: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of body.split('\n\n')) {
    const frame: Partial<SseFrame> & { dataLines: string[] } = { dataLines: [] };
    for (const line of block.split('\n')) {
      if (line.startsWith('id: ')) frame.id = line.slice(4);
      else if (line.startsWith('event: ')) frame.event = line.slice(7);
      else if (line.startsWith('data: ')) frame.dataLines.push(line.slice(6));
    }
    if (frame.event) {
      const parsed: SseFrame = {
        event: frame.event,
        data: JSON.parse(frame.dataLines.join('\n')) as unknown,
      };
      if (frame.id !== undefined) parsed.id = frame.id;
      frames.push(parsed);
    }
  }
  return frames;
}
