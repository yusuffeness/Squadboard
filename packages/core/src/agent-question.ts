import type { PermissionDenial } from './agent-event.js';
import { parseKarar } from './karar.js';

/**
 * How a running agent asks the user something (docs/claude-cli-notes.md §17).
 *
 * Main path: Claude Code's own `AskUserQuestion` tool. Headless `claude -p` cannot show it, so the
 * call is denied and lands in `result.permission_denials[]` with its full input, already in the
 * multi-question shape the CLI validates. Fallback: a KARAR block at the end of the final message
 * (agent files written before the tool was offered, or by hand).
 */

export const ASK_USER_QUESTION = 'AskUserQuestion';

/** At most this many options are kept per question (the tool allows 4; be lenient). */
const MAX_OPTIONS = 6;

export interface AgentQuestion {
  question: string;
  /** Option labels. May be empty: the user answers in free text. */
  options: string[];
  /** The agent accepts several options (AskUserQuestion `multiSelect`). */
  multiSelect: boolean;
}

export type AgentQuestionsResult =
  | { status: 'none' }
  | { status: 'ok'; source: 'ask' | 'karar'; questions: AgentQuestion[] }
  /** The agent tried to ask but the question cannot be read. Never treat this as "finished". */
  | { status: 'invalid'; source: 'ask' | 'karar'; reason: string; raw: string };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function optionLabel(option: unknown): string {
  if (typeof option === 'string') return option.trim();
  if (typeof option === 'object' && option !== null && 'label' in option) {
    return text((option as { label: unknown }).label);
  }
  return '';
}

/** Reads one AskUserQuestion input: `{questions: [{question, header, options[{label}], multiSelect}]}`. */
export function parseAskUserQuestion(
  input: Record<string, unknown>,
): { ok: true; questions: AgentQuestion[] } | { ok: false; reason: string } {
  const list = input.questions;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, reason: 'AskUserQuestion input has no questions' };
  }
  const questions: AgentQuestion[] = [];
  for (const [i, raw] of list.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, reason: `questions[${i}] is not an object` };
    }
    const q = raw as Record<string, unknown>;
    const question = text(q.question) || text(q.header);
    if (!question) return { ok: false, reason: `questions[${i}] has no question text` };
    const options = Array.isArray(q.options)
      ? [...new Set(q.options.map(optionLabel).filter((o) => o !== ''))].slice(0, MAX_OPTIONS)
      : [];
    questions.push({ question, options, multiSelect: q.multiSelect === true });
  }
  return { ok: true, questions };
}

/**
 * The agent's questions at the end of a run: the last denied AskUserQuestion call, else the KARAR
 * block in its final message.
 *
 * Only the last call counts: the denial looks like an error to the model, and it often retries
 * with the same questions reworded (a real run asked the same two questions three times: in
 * Turkish, without Turkish letters, then in English). Each retry carries the whole set.
 */
export function extractAgentQuestions(result: {
  text: string | null;
  permissionDenials: readonly PermissionDenial[];
}): AgentQuestionsResult {
  const asks = result.permissionDenials.filter((d) => d.toolName === ASK_USER_QUESTION);
  const last = asks.at(-1);
  if (last) {
    const parsed = parseAskUserQuestion(last.input);
    if (parsed.ok) return { status: 'ok', source: 'ask', questions: parsed.questions };
    return {
      status: 'invalid',
      source: 'ask',
      reason: parsed.reason,
      raw: JSON.stringify(last.input),
    };
  }

  const karar = parseKarar(result.text ?? '');
  if (karar.status === 'none') return { status: 'none' };
  if (karar.status === 'invalid') {
    return { status: 'invalid', source: 'karar', reason: karar.reason, raw: karar.raw };
  }
  return {
    status: 'ok',
    source: 'karar',
    questions: karar.questions.map((q) => ({ ...q, multiSelect: false })),
  };
}
