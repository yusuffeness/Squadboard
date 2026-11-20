import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '@squadboard/core';
import { agentState, columnOf, costToday, groupByColumn, needsYou, titleFromPrompt } from './board';

const t = (status: TaskStatus, active = false, agent = 'frontend') => ({ status, active, agent });

describe('columnOf', () => {
  it.each<[TaskStatus, string]>([
    ['planned', 'waiting'],
    ['blocked', 'waiting'],
    ['running', 'working'],
    ['changes_requested', 'working'],
    ['failed', 'working'],
    ['stopped', 'working'],
    ['waiting_decision', 'attention'],
    ['in_review', 'attention'],
    ['done', 'done'],
  ])('%s → %s', (status, column) => {
    expect(columnOf(t(status))).toBe(column);
  });

  it('puts any task with a live process in "working"', () => {
    expect(columnOf(t('in_review', true))).toBe('working');
    expect(columnOf(t('done', true))).toBe('working');
  });

  it('groups every task into exactly one column', () => {
    const groups = groupByColumn([t('planned'), t('done'), t('in_review'), t('running', true)]);
    expect(Object.values(groups).flat()).toHaveLength(4);
    expect(groups.attention).toHaveLength(1);
  });
});

describe('needsYou', () => {
  it('counts questions and reviews that are not running', () => {
    expect(needsYou([t('waiting_decision'), t('in_review'), t('in_review', true), t('done')])).toBe(
      2,
    );
  });
});

describe('agentState', () => {
  it('is idle without tasks', () => {
    expect(agentState('frontend', [])).toEqual({ tone: 'idle', label: 'Boşta' });
  });

  it('prefers running over decision over review over waiting', () => {
    const tasks = [t('planned'), t('in_review'), t('waiting_decision'), t('running', true)];
    expect(agentState('frontend', tasks).label).toBe('Çalışıyor');
    expect(agentState('frontend', tasks.slice(0, 3)).label).toBe('Karar bekliyor');
    expect(agentState('frontend', [t('in_review'), t('in_review')]).label).toBe('2 inceleme');
    expect(agentState('frontend', [t('blocked')]).label).toBe('Bekliyor');
  });

  it("ignores other agents' tasks", () => {
    expect(agentState('backend', [t('running', true, 'frontend')]).label).toBe('Boşta');
  });
});

describe('costToday', () => {
  const now = new Date(2026, 10, 20, 15, 0);
  const at = (d: Date) => d.toISOString();

  it('sums only real costs of runs started today (local time)', () => {
    const runs = [
      { costUsd: 0.12, startedAt: at(new Date(2026, 10, 20, 0, 5)) },
      { costUsd: 0.3, startedAt: at(new Date(2026, 10, 20, 14, 0)) },
      { costUsd: null, startedAt: at(new Date(2026, 10, 20, 14, 30)) },
      { costUsd: 5, startedAt: at(new Date(2026, 10, 19, 23, 59)) },
    ];
    expect(costToday(runs, now)).toBeCloseTo(0.42);
  });

  it('is 0 without runs', () => {
    expect(costToday([], now)).toBe(0);
  });
});

describe('titleFromPrompt', () => {
  it('takes the first sentence without its final dot', () => {
    expect(titleFromPrompt('Giriş sayfası ekle. Form ve hata mesajları olsun.')).toBe(
      'Giriş sayfası ekle',
    );
  });

  it('takes the first line', () => {
    expect(titleFromPrompt('  REST API yaz\nuç noktalar ve testler')).toBe('REST API yaz');
  });

  it('cuts long text at a word boundary with an ellipsis', () => {
    const title = titleFromPrompt('kelime '.repeat(20), 30);
    expect(title.length).toBeLessThanOrEqual(31);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });

  it('keeps version numbers together', () => {
    expect(titleFromPrompt('Node 20.1 desteği ekle')).toBe('Node 20.1 desteği ekle');
  });
});
