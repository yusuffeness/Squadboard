import { describe, expect, it } from 'vitest';
import { parseKarar } from './karar.js';

const block = (body: string, label = 'karar') => '```' + label + '\n' + body + '\n```';

describe('parseKarar', () => {
  it('returns none when there is no block', () => {
    expect(parseKarar('Done. I added subtract().')).toEqual({ status: 'none' });
    expect(parseKarar('```json\n{"question":"x","options":["a","b"]}\n```')).toEqual({
      status: 'none',
    });
  });

  it('parses the single-question form', () => {
    const text = `I need a decision.\n\n${block('{"question": "Which storage?", "options": ["JSON file", "SQLite"]}')}`;
    expect(parseKarar(text)).toEqual({
      status: 'ok',
      atEnd: true,
      questions: [{ question: 'Which storage?', options: ['JSON file', 'SQLite'] }],
    });
  });

  it('parses the multi-question form (preferred: ask everything at once)', () => {
    const body = JSON.stringify({
      questions: [
        { question: 'Which storage?', options: ['JSON file', 'SQLite'] },
        { question: 'Which fields?', options: ['a, b, result', 'a, b, result, timestamp'] },
      ],
    });
    const result = parseKarar(block(body));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.questions.map((q) => q.question)).toHaveLength(2);
  });

  it('accepts an upper-case label and CRLF line endings', () => {
    const text = '```KARAR\r\n{"question":"Q?","options":["a","b"]}\r\n```';
    expect(parseKarar(text).status).toBe('ok');
  });

  it('uses the last block when there are several', () => {
    const text = `${block('{"question":"old","options":["a","b"]}')}\nthen\n${block('{"question":"new","options":["c","d"]}')}`;
    const result = parseKarar(text);
    expect(result.status === 'ok' && result.questions[0]?.question).toBe('new');
  });

  it('flags text after the block with atEnd: false', () => {
    const text = `${block('{"question":"Q?","options":["a","b"]}')}\n\nLet me know!`;
    expect(parseKarar(text)).toMatchObject({ status: 'ok', atEnd: false });
  });

  it('trims whitespace in questions and options', () => {
    const result = parseKarar(block('{"question":"  Q?  ","options":[" a ","b"]}'));
    expect(result).toMatchObject({
      status: 'ok',
      questions: [{ question: 'Q?', options: ['a', 'b'] }],
    });
  });

  it.each([
    ['broken JSON', '{"question": "Q?", "options": ["a", "b"]', 'Block is not valid JSON'],
    ['one option', '{"question":"Q?","options":["a"]}', 'options'],
    ['five options', '{"question":"Q?","options":["a","b","c","d","e"]}', 'options'],
    ['empty question', '{"question":"","options":["a","b"]}', 'question'],
    ['empty questions list', '{"questions":[]}', ''],
    ['wrong shape', '{"ask":"Q?"}', ''],
  ])('rejects %s', (_label, body, reasonPart) => {
    const result = parseKarar(block(body));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.reason).toContain(reasonPart);
      expect(result.raw).toBe(body);
    }
  });
});
