import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEventOf, PermissionDenial } from './agent-event.js';
import { extractAgentQuestions, parseAskUserQuestion } from './agent-question.js';
import { parseClaudeOutput } from './claude-adapter.js';
import { parseKarar } from './karar.js';

const FIXTURES = fileURLToPath(new URL('../test/fixtures/claude-cli/', import.meta.url));
const resultOf = (name: string) => {
  const result = parseClaudeOutput(readFileSync(FIXTURES + name, 'utf8')).find(
    (e): e is AgentEventOf<'result'> => e.kind === 'result',
  );
  if (!result) throw new Error(`no result in ${name}`);
  return result;
};
const ask = (input: Record<string, unknown>): PermissionDenial => ({
  toolName: 'AskUserQuestion',
  toolUseId: 't1',
  input,
});

describe('extractAgentQuestions', () => {
  it('reads the denied AskUserQuestion call of a real run (several questions at once)', () => {
    const found = extractAgentQuestions(resultOf('22-ask-user-question.jsonl'));
    expect(found.status).toBe('ok');
    if (found.status !== 'ok') return;
    expect(found.source).toBe('ask');
    expect(found.questions.map((q) => q.question)).toEqual([
      'Which storage technology should be used for persistence?',
      'What data should be stored per addition?',
      'What should the public API look like?',
    ]);
    expect(found.questions[0]).toMatchObject({
      options: ['JSON file (Recommended)', 'SQLite', 'In-memory array'],
      multiSelect: false,
    });
  });

  it('finds nothing in a run that only had a shell command denied', () => {
    expect(extractAgentQuestions(resultOf('24-perm-bash-denied.jsonl'))).toEqual({
      status: 'none',
    });
  });

  it('uses the last call: a denied call is retried with the same questions reworded', () => {
    const q = (question: string) => ({ question, options: [{ label: 'A' }, { label: 'B' }] });
    const found = extractAgentQuestions({
      text: 'Waiting.',
      permissionDenials: [
        ask({ questions: [q('Renk paleti için hangi stil?'), q('Yazı tipi?')] }),
        ask({ questions: [q('Renk paleti icin hangi stil?'), q('Yazi tipi?')] }),
        ask({ questions: [q('Which palette?'), q('Which font?')] }),
      ],
    });
    expect(found).toMatchObject({
      status: 'ok',
      questions: [{ question: 'Which palette?' }, { question: 'Which font?' }],
    });
  });

  it('falls back to the KARAR block when the agent did not use the tool', () => {
    const text =
      'Need input.\n```karar\n{"questions":[{"question":"DB?","options":["SQLite","PG"]}]}\n```';
    expect(extractAgentQuestions({ text, permissionDenials: [] })).toEqual({
      status: 'ok',
      source: 'karar',
      questions: [{ question: 'DB?', options: ['SQLite', 'PG'], multiSelect: false }],
    });
  });

  it('reports a broken question instead of none', () => {
    const broken = extractAgentQuestions({
      text: '```karar\n{"question": "DB?", "options": ["only one"]}\n```',
      permissionDenials: [],
    });
    expect(broken).toMatchObject({ status: 'invalid', source: 'karar' });

    const unclosed = extractAgentQuestions({
      text: 'Before I go on:\n```karar\n{"question": "DB?", "options": ["A", "B"]}',
      permissionDenials: [],
    });
    expect(unclosed).toMatchObject({ status: 'invalid', reason: 'Block is not closed' });

    const badTool = extractAgentQuestions({
      text: 'Waiting for your answers.',
      permissionDenials: [ask({ questions: [] })],
    });
    expect(badTool).toMatchObject({ status: 'invalid', source: 'ask' });
  });
});

describe('parseAskUserQuestion', () => {
  it('keeps labels, multiSelect and falls back to the header', () => {
    expect(
      parseAskUserQuestion({
        questions: [
          {
            header: 'Fonts',
            options: [{ label: 'System', description: 'x' }, 'Inter', { label: ' ' }],
            multiSelect: true,
          },
        ],
      }),
    ).toEqual({
      ok: true,
      questions: [{ question: 'Fonts', options: ['System', 'Inter'], multiSelect: true }],
    });
  });

  it('accepts a question without options (free-text answer)', () => {
    expect(parseAskUserQuestion({ questions: [{ question: 'Which colour?' }] })).toEqual({
      ok: true,
      questions: [{ question: 'Which colour?', options: [], multiSelect: false }],
    });
  });

  it('rejects input without question text', () => {
    expect(parseAskUserQuestion({ questions: [{ options: ['a'] }] }).ok).toBe(false);
    expect(parseAskUserQuestion({}).ok).toBe(false);
  });
});

describe('parseKarar – unclosed block', () => {
  it('is invalid, not none', () => {
    expect(parseKarar('text\n```karar\n{"question":"x"')).toMatchObject({ status: 'invalid' });
  });
});
