import { describe, expect, it } from 'vitest';
import type { QuestionView } from '../api';
import {
  answerOf,
  answersOf,
  pendingLabel,
  permissionLine,
  permissionVerb,
  pick,
  unansweredQuestions,
  waitingTasks,
} from './decision';

const q = (id: string, multiSelect = false): QuestionView => ({
  id,
  question: `${id}?`,
  options: ['A', 'B', 'C'],
  multiSelect,
  problem: null,
});

describe('answers', () => {
  it('radio replaces, checkbox toggles, own words win', () => {
    let d = pick(undefined, 'A', false);
    d = pick(d, 'B', false);
    expect(answerOf(d)).toBe('B');

    let m = pick(undefined, 'A', true);
    m = pick(m, 'C', true);
    expect(answerOf(m)).toBe('A, C');
    m = pick(m, 'A', true);
    expect(answerOf(m)).toBe('C');

    expect(answerOf({ selected: ['A'], free: '  kendi cevabım ' })).toBe('kendi cevabım');
    expect(answerOf(undefined)).toBe('');
  });

  it('lists what is still open and builds the request body', () => {
    const questions = [q('a'), q('b', true)];
    const drafts = { a: { selected: ['A'], free: '' } };
    expect(unansweredQuestions(questions, drafts).map((x) => x.id)).toEqual(['b']);
    expect(answersOf(questions, drafts)).toEqual({ a: 'A' });
  });
});

describe('board helpers', () => {
  it('only idle waiting tasks need an answer', () => {
    const tasks = [
      { id: '1', status: 'waiting_decision' as const, active: false },
      { id: '2', status: 'waiting_decision' as const, active: true },
      { id: '3', status: 'in_review' as const, active: false },
    ];
    expect(waitingTasks(tasks).map((t) => t.id)).toEqual(['1']);
  });

  it('labels what is pending', () => {
    const permission = {
      id: 'p',
      tool: 'Bash',
      command: 'npm test',
      path: null,
      rule: 'Bash(npm test)',
    };
    expect(pendingLabel({ questions: [q('a'), q('b')], permissions: [], round: 1 })).toBe('2 soru');
    expect(pendingLabel({ questions: [q('a')], permissions: [permission], round: 1 })).toBe(
      '1 soru · 1 izin',
    );
    expect(pendingLabel({ questions: [], permissions: [], round: 0 })).toBe('');
    expect(permissionVerb(permission)).toBe('bir komut çalıştırmak istiyor');
    expect(permissionLine(permission)).toBe('npm test');
    expect(
      permissionLine({ tool: 'Write', command: null, path: '/etc/hosts', rule: 'Write' }),
    ).toBe('Write /etc/hosts');
  });
});
