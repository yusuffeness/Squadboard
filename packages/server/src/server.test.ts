import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fakeClaude,
  fakeEnv,
  hangingEnv,
  makeWorkspace,
  parseSse,
  waitFor,
  waitForPids,
  type TempWorkspace,
} from '../test/helpers.js';
import type { RunView } from './routes/runs.js';
import { isProcessAlive } from './runner/kill-tree.js';
import { startServer, type RunningServer } from './server.js';

let ws: TempWorkspace;
let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(ws.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function start(env: NodeJS.ProcessEnv): Promise<RunningServer> {
  server = await startServer({ port: 0, dbPath: ws.dbPath, claude: fakeClaude, env });
  return server;
}

async function postRun(s: RunningServer): Promise<RunView> {
  const res = await fetch(`http://127.0.0.1:${s.port}/api/runs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Add a line to README', cwd: ws.cwd }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as RunView;
}

describe('startServer', () => {
  it('binds to 127.0.0.1 and prints a URL with the token in the fragment', async () => {
    ws = makeWorkspace();
    const s = await start(fakeEnv(ws, '03-stream-verbose.jsonl'));
    expect(s.app.server.address()).toMatchObject({ address: '127.0.0.1' });
    expect(s.url).toBe(`http://127.0.0.1:${s.port}/#token=${s.token}`);
    expect(s.token.length).toBeGreaterThanOrEqual(40);
    // Its own origin is allowed once the port is known.
    const res = await fetch(`http://127.0.0.1:${s.port}/api/runs`, {
      headers: { authorization: `Bearer ${s.token}`, origin: `http://127.0.0.1:${s.port}` },
    });
    expect(res.status).toBe(200);
  });

  it('SSE streams events live, before the run has finished', async () => {
    ws = makeWorkspace();
    // ~11 lines × 80 ms: the run takes about a second.
    const s = await start(fakeEnv(ws, '03-stream-verbose.jsonl', { FAKE_CLAUDE_DELAY_MS: '80' }));
    const run = await postRun(s);

    const res = await fetch(
      `http://127.0.0.1:${s.port}/api/runs/${run.id}/events?token=${s.token}`,
    );
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const decoder = new TextDecoder();
    let body = '';
    let firstAgentWhileRunning: boolean | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
      if (firstAgentWhileRunning === undefined && body.includes('event: agent')) {
        firstAgentWhileRunning = s.runner.isRunning(run.id);
      }
    }
    expect(firstAgentWhileRunning).toBe(true);
    const frames = parseSse(body);
    expect(frames.filter((f) => f.event === 'agent')).toHaveLength(11);
    expect(frames.at(-1)).toMatchObject({ event: 'end', data: { status: 'succeeded' } });
  }, 20_000);

  it('close() stops running agents first, so no process is left behind', async () => {
    ws = makeWorkspace();
    const s = await start(hangingEnv(ws));
    let endedAs: string | undefined;
    s.runner.on('end', (outcome) => (endedAs = outcome.runStatus));
    await postRun(s);
    const pids = await waitForPids(ws);

    await s.close();
    server = undefined;
    expect(endedAs).toBe('stopped');
    await waitFor(() =>
      isProcessAlive(pids.self) || isProcessAlive(pids.grandchild) ? undefined : true,
    );
  }, 20_000);
});
