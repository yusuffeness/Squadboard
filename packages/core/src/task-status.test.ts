import { describe, expect, it } from 'vitest';
import { TASK_STATUSES, type TaskStatus } from './schemas.js';
import {
  InvalidTransitionError,
  TASK_TRANSITIONS,
  assertTransition,
  canTransition,
  isTerminal,
  transitionTask,
} from './task-status.js';

describe('task status machine', () => {
  it('defines transitions for every status', () => {
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it.each<[TaskStatus, TaskStatus]>([
    ['planned', 'running'],
    ['planned', 'blocked'],
    ['blocked', 'planned'],
    ['running', 'waiting_decision'],
    ['waiting_decision', 'running'],
    ['running', 'in_review'],
    ['in_review', 'done'],
    ['in_review', 'changes_requested'],
    ['changes_requested', 'running'],
    ['running', 'failed'],
    ['failed', 'running'],
    ['running', 'stopped'],
    ['stopped', 'running'],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each<[TaskStatus, TaskStatus]>([
    ['planned', 'done'],
    ['running', 'done'], // must pass review first
    ['blocked', 'running'], // dependencies first
    ['done', 'running'],
    ['done', 'stopped'],
    ['in_review', 'running'],
    ['waiting_decision', 'in_review'],
    ['running', 'running'],
  ])('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it('nothing reaches done except through in_review', () => {
    const into = TASK_STATUSES.filter((s) => TASK_TRANSITIONS[s].includes('done'));
    expect(into).toEqual(['in_review']);
  });

  it('transitionTask returns a new object and keeps other fields', () => {
    const task = { id: 't1', status: 'planned' as TaskStatus };
    const next = transitionTask(task, 'running');
    expect(next).toEqual({ id: 't1', status: 'running' });
    expect(task.status).toBe('planned');
  });

  it('transitionTask error says what was attempted', () => {
    try {
      transitionTask({ status: 'done' as TaskStatus }, 'running');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      expect(err).toMatchObject({ from: 'done', to: 'running' });
      expect((err as Error).message).toBe('Invalid task status transition: done → running');
    }
  });

  it('only done is terminal', () => {
    expect(TASK_STATUSES.filter(isTerminal)).toEqual(['done']);
  });
});
