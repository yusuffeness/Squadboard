import { z } from 'zod';

/**
 * KARAR block: how a running agent asks the user for a decision.
 *
 * Primary path is the Planner's `openDecisions` (asked during plan approval). This block is the
 * fallback when an agent hits an unexpected choice mid-task. Agents are told to ask **all** open
 * decisions in one block (multi-question form), because asking one at a time chains questions
 * (docs/claude-cli-notes.md §5).
 *
 * ```karar
 * {"questions": [{"question": "...", "options": ["...", "..."]}]}
 * ```
 *
 * The single-question form `{"question": "...", "options": [...]}` is accepted too.
 */

export const KararQuestion = z.object({
  question: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).min(2).max(4),
});
export type KararQuestion = z.infer<typeof KararQuestion>;

const MultiPayload = z.object({ questions: z.array(KararQuestion).min(1) });

// Picks the form explicitly (instead of z.union) so validation errors point at the real field.
function parsePayload(json: unknown) {
  const isMulti = typeof json === 'object' && json !== null && 'questions' in json;
  if (isMulti) return MultiPayload.safeParse(json);
  const single = KararQuestion.safeParse(json);
  return single.success ? { success: true as const, data: { questions: [single.data] } } : single;
}

export type KararParseResult =
  | { status: 'none' }
  | {
      status: 'ok';
      questions: KararQuestion[];
      /** False when the agent kept writing after the block (it was told not to). */
      atEnd: boolean;
    }
  | { status: 'invalid'; reason: string; raw: string };

// ```karar ... ``` — label is case-insensitive (karar / KARAR).
const BLOCK_RE = /```[ \t]*karar[ \t]*\r?\n([\s\S]*?)```/gi;

/** Finds the last KARAR block in an agent's final message and validates it. */
export function parseKarar(text: string): KararParseResult {
  const matches = [...text.matchAll(BLOCK_RE)];
  const last = matches.at(-1);
  if (!last) return { status: 'none' };

  const raw = (last[1] ?? '').trim();
  const atEnd = text.slice((last.index ?? 0) + last[0].length).trim() === '';

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { status: 'invalid', reason: 'Block is not valid JSON', raw };
  }
  const parsed = parsePayload(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
    return { status: 'invalid', reason: `${issue?.message ?? 'Invalid block'}${where}`, raw };
  }
  return { status: 'ok', questions: parsed.data.questions, atEnd };
}
