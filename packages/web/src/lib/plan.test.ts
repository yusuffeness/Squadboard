import { describe, expect, it } from 'vitest';
import type { PlanView } from '../api';
import {
  addedOrder,
  blockedLine,
  planNeedingAttention,
  stagesSentence,
  stepSeconds,
  tasksByStage,
  unanswered,
} from './plan';

const plan = (id: string, status: PlanView['status']) => ({ id, status }) as PlanView;

describe('plan helpers', () => {
  it('measures only finished steps', () => {
    expect(
      stepSeconds({ startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:04.4Z' }),
    ).toBe(4);
    expect(stepSeconds({ startedAt: '2026-01-01T00:00:00Z', endedAt: null })).toBeNull();
  });

  it('finds unanswered decisions (blank text does not count)', () => {
    const decisions = [
      { id: 'a', question: 'A?', options: ['1', '2'], taskIds: [] },
      { id: 'b', question: 'B?', options: ['1', '2'], taskIds: [] },
    ];
    expect(unanswered(decisions, { a: '1', b: '  ' }).map((d) => d.id)).toEqual(['b']);
  });

  it('groups tasks by stage and tells added order apart', () => {
    const t = (id: string, dependsOn: string[], runsAfter: string[]) => ({
      id,
      title: id,
      agent: 'backend',
      prompt: '',
      dependsOn,
      runsAfter,
      expectedFiles: [],
      stage: 0,
      outsideOwns: [],
      agentUnavailable: false,
    });
    const tasks = [t('a', [], []), t('b', [], ['a']), t('c', [], [])];
    expect(
      tasksByStage({ tasks, stages: [['a', 'c'], ['b']] }).map((s) => s.map((x) => x.id)),
    ).toEqual([['a', 'c'], ['b']]);
    expect(addedOrder(tasks[1] ?? t('x', [], []))).toEqual(['a']);
    expect(stagesSentence(1)).toBe('Ekip tek aşamada çalışacak.');
    expect(stagesSentence(3)).toBe('Ekip 3 aşamada çalışacak.');
  });

  it('points the board at the plan that needs the user', () => {
    expect(planNeedingAttention([plan('1', 'done'), plan('2', 'awaiting_approval')])?.id).toBe('2');
    expect(planNeedingAttention([plan('1', 'interrupted')])?.id).toBe('1');
    expect(planNeedingAttention([plan('1', 'failed')])?.id).toBe('1');
    expect(planNeedingAttention([plan('2', 'done'), plan('1', 'failed')])).toBeNull();
  });

  it('explains why a task waits', () => {
    const all = [
      { id: 'a', title: 'API', status: 'failed' as const },
      { id: 'b', title: 'UI', status: 'running' as const },
      { id: 'c', title: 'DB', status: 'in_review' as const },
    ];
    expect(
      blockedLine({ status: 'blocked', dependsOn: ['a', 'b'], blockedReason: null }, all),
    ).toEqual({
      tone: 'warn',
      text: '“API” tamamlanmadı; o düzelmeden bu iş başlamaz',
    });
    expect(
      blockedLine({ status: 'blocked', dependsOn: ['b', 'c'], blockedReason: null }, all),
    ).toEqual({
      tone: 'muted',
      text: '“UI” bitince başlar',
    });
    expect(
      blockedLine({ status: 'blocked', dependsOn: ['c'], blockedReason: 'Dallar çatıştı' }, all),
    ).toEqual({ tone: 'danger', text: 'Dallar çatıştı' });
    expect(
      blockedLine({ status: 'running', dependsOn: ['a'], blockedReason: null }, all),
    ).toBeNull();
  });
});
