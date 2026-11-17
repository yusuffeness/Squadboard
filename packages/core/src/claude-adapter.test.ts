import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AgentEvent, type AgentEventKind, type AgentEventOf } from './agent-event.js';
import {
  classifyCliStderr,
  createClaudeStreamAdapter,
  parseClaudeOutput,
} from './claude-adapter.js';
import { parseKarar } from './karar.js';

// Real CLI recordings from Stage 1 (docs/claude-cli-notes.md).
const FIXTURES = fileURLToPath(new URL('../test/fixtures/claude-cli/', import.meta.url));
const read = (name: string) => readFileSync(FIXTURES + name, 'utf8');
const events = (name: string) => parseClaudeOutput(read(name));
const ofKind = <K extends AgentEventKind>(list: AgentEvent[], kind: K) =>
  list.filter((e): e is AgentEventOf<K> => e.kind === kind);
const resultOf = (list: AgentEvent[]) => {
  const results = ofKind(list, 'result');
  expect(results).toHaveLength(1);
  const [result] = results;
  if (!result) throw new Error('no result event');
  return result;
};

const outputFixtures = readdirSync(FIXTURES).filter(
  // *.meta.json / *-results.json / *.result.json are spike summaries, not CLI output.
  (f) => /\.(jsonl|json)$/.test(f) && !/(\.meta|-results|\.result)\.json$/.test(f),
);

describe('claude stream adapter – every recorded fixture', () => {
  it('found the fixtures', () => {
    expect(outputFixtures.length).toBeGreaterThan(20);
  });

  it.each(outputFixtures)('%s parses without errors or unknown events', (name) => {
    const list = events(name);
    for (const event of list) expect(AgentEvent.safeParse(event).success).toBe(true);
    expect(ofKind(list, 'error')).toEqual([]);
    expect(ofKind(list, 'unknown')).toEqual([]);
  });

  it.each(outputFixtures.filter((f) => f.endsWith('.jsonl') && read(f).trim() !== ''))(
    '%s starts with session_started and ids match the result',
    (name) => {
      const list = events(name);
      const first = list[0];
      expect(first?.kind).toBe('session_started');
      const result = ofKind(list, 'result')[0];
      if (first?.kind === 'session_started' && result) {
        expect(result.sessionId).toBe(first.sessionId);
      }
    },
  );
});

describe('claude stream adapter – specific behaviour', () => {
  it('json output: single result with cost, turns and session id', () => {
    const result = resultOf(events('01-json.json'));
    expect(result).toMatchObject({ subtype: 'success', isError: false });
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.numTurns).toBeGreaterThan(0);
    expect(result.text).toContain('add');
  });

  it('stream: session info, tool calls with results, final text', () => {
    const list = events('03-stream-verbose.jsonl');
    const started = ofKind(list, 'session_started')[0];
    expect(started).toMatchObject({ model: 'claude-haiku-4-5-20251001', cliVersion: '2.1.150' });
    expect(started?.tools).toContain('Read');

    const toolUses = ofKind(list, 'tool_use');
    expect(toolUses.map((t) => t.name)).toEqual(['Glob', 'Read']);
    const toolResults = ofKind(list, 'tool_result');
    expect(toolResults.map((r) => r.toolUseId)).toEqual(toolUses.map((t) => t.toolUseId));

    expect(ofKind(list, 'thinking').length).toBeGreaterThan(0);
    expect(ofKind(list, 'rate_limit')[0]).toMatchObject({ rateLimitType: 'five_hour' });

    const text = ofKind(list, 'text').at(-1)?.text;
    expect(text).toBe(resultOf(list).text);
  });

  it('partial messages: text deltas add up to the final text; other deltas are dropped', () => {
    const list = events('04-stream-partial.jsonl');
    const streamed = ofKind(list, 'text_delta')
      .map((d) => d.text)
      .join('');
    expect(streamed).toBe(resultOf(list).text);
    expect(ofKind(list, 'status').length).toBe(2);
  });

  it('successful Edit produces a file_change', () => {
    const changes = ofKind(events('12-perm-acceptEdits-bash-npm-test.jsonl'), 'file_change');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ tool: 'Edit', operation: 'edit' });
    expect(changes[0]?.path).toMatch(/math\.js$/);
  });

  it('denied Edit produces no file_change; denials are on the result', () => {
    const list = events('13-perm-default.jsonl');
    expect(ofKind(list, 'tool_use').some((t) => t.name === 'Edit')).toBe(true);
    expect(ofKind(list, 'file_change')).toEqual([]);
    expect(ofKind(list, 'tool_result').some((r) => r.isError)).toBe(true);
    const result = resultOf(list);
    expect(result.subtype).toBe('success');
    expect(result.permissionDenials.map((d) => d.toolName)).toContain('Edit');
  });

  it('a denied tool does not stop the run: result is success with permissionDenials', () => {
    const result = resultOf(events('11-perm-acceptEdits-no-bash.jsonl'));
    expect(result.isError).toBe(false);
    expect(result.permissionDenials).toEqual([
      expect.objectContaining({
        toolName: 'Bash',
        input: expect.objectContaining({ command: 'npm test' }),
      }),
    ]);
  });

  it('max turns: error result without text', () => {
    const result = resultOf(events('15-max-turns.jsonl'));
    expect(result).toMatchObject({ subtype: 'error_max_turns', isError: true, text: null });
    expect(result.errors).toEqual(['Reached maximum number of turns (1)']);
  });

  it('json schema: structured output is exposed', () => {
    for (const name of ['16-json-schema.json', '17-json-schema-stream.jsonl']) {
      const output = resultOf(events(name)).structuredOutput as { tasks: unknown[] };
      expect(output.tasks.length).toBeGreaterThan(1);
    }
  });

  it('killed run: events stop without a result', () => {
    for (const name of ['18-kill-child.kill.jsonl', '18-kill-taskkill-tree.jsonl']) {
      const list = events(name);
      expect(ofKind(list, 'result')).toEqual([]);
      expect(ofKind(list, 'tool_use').at(-1)?.name).toBe('Bash');
    }
  });

  it('KARAR fixtures: strict run ends with a valid block, base run has none', () => {
    const strict = parseKarar(resultOf(events('karar-strict-ambiguous-01.jsonl')).text ?? '');
    expect(strict).toMatchObject({ status: 'ok', atEnd: true });
    const base = parseKarar(resultOf(events('karar-base-ambiguous-01.jsonl')).text ?? '');
    expect(base.status).toBe('none');
  });

  it('resume after KARAR asks a follow-up decision (chained question)', () => {
    const text = resultOf(events('19-karar-resume-answer.jsonl')).text ?? '';
    expect(parseKarar(text).status).toBe('ok');
  });
});

describe('claude stream adapter – robustness', () => {
  it('turns unparsable lines into invalid_json errors and keeps going', () => {
    const adapter = createClaudeStreamAdapter();
    expect(adapter.push('not json {')).toEqual([
      { kind: 'error', code: 'invalid_json', message: 'not json {' },
    ]);
    expect(adapter.push('')).toEqual([]);
    expect(adapter.push('{"type":"system","subtype":"status","status":"requesting"}')).toEqual([
      { kind: 'status', status: 'requesting' },
    ]);
  });

  it('passes unknown event types through as unknown', () => {
    const adapter = createClaudeStreamAdapter();
    const raw = { type: 'brand_new_event', foo: 1 };
    expect(adapter.push(JSON.stringify(raw))).toEqual([
      { kind: 'unknown', rawType: 'brand_new_event', raw },
    ]);
    expect(adapter.push('[1,2]')).toEqual([{ kind: 'unknown', rawType: null, raw: [1, 2] }]);
  });

  it('passes known types with unexpected shape or new content blocks as unknown', () => {
    const adapter = createClaudeStreamAdapter();
    expect(adapter.push('{"type":"result"}')[0]?.kind).toBe('unknown');
    const block = { type: 'redacted_thinking', data: 'x' };
    const out = adapter.push(
      JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [block] } }),
    );
    expect(out).toEqual([{ kind: 'unknown', rawType: 'assistant.content', raw: block }]);
  });

  it('accepts tool_result content given as an array of text parts', () => {
    const adapter = createClaudeStreamAdapter();
    adapter.push(
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'm1',
          content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'a.txt' } }],
        },
      }),
    );
    const out = adapter.push(
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }] },
          ],
        },
      }),
    );
    expect(out).toEqual([
      {
        kind: 'tool_result',
        parentToolUseId: null,
        toolUseId: 't1',
        isError: false,
        content: 'ok',
      },
      { kind: 'file_change', toolUseId: 't1', tool: 'Write', operation: 'write', path: 'a.txt' },
    ]);
  });
});

describe('classifyCliStderr', () => {
  const stderrOf = (name: string) => (JSON.parse(read(name)) as { stderr: string }).stderr;

  it('recognises recorded CLI failures', () => {
    expect(classifyCliStderr(stderrOf('02-stream-no-verbose.meta.json'))?.code).toBe(
      'stream_json_requires_verbose',
    );
    expect(classifyCliStderr(stderrOf('10-resume-unknown.meta.json'))?.code).toBe(
      'session_not_found',
    );
    expect(classifyCliStderr(stderrOf('20-resume-other-cwd.meta.json'))?.code).toBe(
      'session_not_found',
    );
  });

  it('returns null for empty stderr and cli_error otherwise', () => {
    expect(classifyCliStderr('  \n')).toBeNull();
    expect(classifyCliStderr('boom')).toEqual({
      kind: 'error',
      code: 'cli_error',
      message: 'boom',
    });
  });
});
