import { z } from 'zod';
import type { AgentEvent, AgentEventOf, PermissionDenial } from './agent-event.js';

/**
 * Turns `claude -p --output-format stream-json --verbose` lines into AgentEvents.
 * Shapes are documented in docs/claude-cli-notes.md and recorded in packages/core/test/fixtures/claude-cli.
 *
 * Rules: never throw on input; anything not understood becomes an `unknown` event
 * (or `error` for unparsable lines) so the UI can still show it.
 */

// ---------- raw CLI shapes (lenient: extra fields are ignored) ----------

const str = z.string();
const optStr = z.string().nullish();
const optNum = z.number().nullish();
const record = z.record(z.string(), z.unknown());

const RawInit = z.looseObject({
  session_id: str,
  model: optStr,
  cwd: optStr,
  claude_code_version: optStr,
  permissionMode: optStr,
  tools: z.array(z.string()).nullish(),
});

const RawStatus = z.looseObject({ status: str });

const RawRateLimit = z.looseObject({
  rate_limit_info: z
    .looseObject({ status: optStr, rateLimitType: optStr, resetsAt: optNum })
    .nullish(),
});

const RawTextBlock = z.looseObject({ type: z.literal('text'), text: str });
const RawThinkingBlock = z.looseObject({ type: z.literal('thinking'), thinking: str });
const RawToolUseBlock = z.looseObject({
  type: z.literal('tool_use'),
  id: str,
  name: str,
  input: record,
});

const RawAssistant = z.looseObject({
  message: z.looseObject({ id: optStr, content: z.array(z.unknown()) }),
  parent_tool_use_id: optStr,
});

const RawToolResultBlock = z.looseObject({
  type: z.literal('tool_result'),
  tool_use_id: str,
  is_error: z.boolean().nullish(),
  content: z.union([str, z.array(z.unknown())]).nullish(),
});

const RawUser = z.looseObject({
  message: z.looseObject({ content: z.union([str, z.array(z.unknown())]) }),
  parent_tool_use_id: optStr,
});

const RawStreamEvent = z.looseObject({
  event: z.looseObject({
    type: str,
    // `message_delta` carries a delta without `type` (stop_reason etc.).
    delta: z.looseObject({ type: optStr, text: optStr }).nullish(),
  }),
  parent_tool_use_id: optStr,
});

const RawResult = z.looseObject({
  subtype: str,
  is_error: z.boolean().nullish(),
  session_id: optStr,
  // Both may be missing (no --json-schema; error_max_turns has no `result`). Zod 4 treats a bare
  // z.unknown() key as required, so mark them optional explicitly.
  result: z.unknown().optional(),
  structured_output: z.unknown().optional(),
  total_cost_usd: optNum,
  num_turns: optNum,
  duration_ms: optNum,
  permission_denials: z
    .array(z.looseObject({ tool_name: str, tool_use_id: optStr, tool_input: record.nullish() }))
    .nullish(),
  errors: z.array(z.unknown()).nullish(),
});

/** Inner `stream_event` types that carry nothing we need (full blocks arrive as `assistant`). */
const IGNORED_STREAM_EVENTS = new Set([
  'message_start',
  'message_delta',
  'message_stop',
  'content_block_start',
  'content_block_stop',
]);
const IGNORED_DELTAS = new Set(['thinking_delta', 'signature_delta', 'input_json_delta']);

/** Tools that write files, and where their target path lives in `input`. */
const FILE_TOOLS: Record<string, { operation: 'edit' | 'write'; pathKey: string }> = {
  Edit: { operation: 'edit', pathKey: 'file_path' },
  MultiEdit: { operation: 'edit', pathKey: 'file_path' },
  Write: { operation: 'write', pathKey: 'file_path' },
  NotebookEdit: { operation: 'edit', pathKey: 'notebook_path' },
};

// ---------- adapter ----------

export interface ClaudeStreamAdapter {
  /** Feed one stdout line (without the trailing newline). Returns 0..n events. */
  push(line: string): AgentEvent[];
}

export function createClaudeStreamAdapter(): ClaudeStreamAdapter {
  // File-writing tool calls waiting for their result: toolUseId → change.
  const pendingFileChanges = new Map<string, Omit<AgentEventOf<'file_change'>, 'kind'>>();

  const unknown = (rawType: string | null, raw: unknown): AgentEvent => ({
    kind: 'unknown',
    rawType,
    raw,
  });

  function fromAssistant(raw: Record<string, unknown>): AgentEvent[] {
    const parsed = RawAssistant.safeParse(raw);
    if (!parsed.success) return [unknown('assistant', raw)];
    const messageId = parsed.data.message.id ?? null;
    const parentToolUseId = parsed.data.parent_tool_use_id ?? null;
    const events: AgentEvent[] = [];
    for (const block of parsed.data.message.content) {
      const text = RawTextBlock.safeParse(block);
      if (text.success) {
        events.push({ kind: 'text', messageId, parentToolUseId, text: text.data.text });
        continue;
      }
      const thinking = RawThinkingBlock.safeParse(block);
      if (thinking.success) {
        events.push({ kind: 'thinking', messageId, parentToolUseId, text: thinking.data.thinking });
        continue;
      }
      const toolUse = RawToolUseBlock.safeParse(block);
      if (toolUse.success) {
        const { id: toolUseId, name, input } = toolUse.data;
        events.push({ kind: 'tool_use', messageId, parentToolUseId, toolUseId, name, input });
        const fileTool = FILE_TOOLS[name];
        const path = fileTool ? input[fileTool.pathKey] : undefined;
        if (fileTool && typeof path === 'string') {
          pendingFileChanges.set(toolUseId, {
            toolUseId,
            tool: name,
            operation: fileTool.operation,
            path,
          });
        }
        continue;
      }
      events.push(unknown('assistant.content', block));
    }
    return events;
  }

  function fromUser(raw: Record<string, unknown>): AgentEvent[] {
    const parsed = RawUser.safeParse(raw);
    if (!parsed.success) return [unknown('user', raw)];
    const parentToolUseId = parsed.data.parent_tool_use_id ?? null;
    const content = parsed.data.message.content;
    if (typeof content === 'string') return [unknown('user.text', raw)];
    const events: AgentEvent[] = [];
    for (const block of content) {
      const result = RawToolResultBlock.safeParse(block);
      if (!result.success) {
        events.push(unknown('user.content', block));
        continue;
      }
      const { tool_use_id: toolUseId } = result.data;
      const isError = result.data.is_error ?? false;
      events.push({
        kind: 'tool_result',
        parentToolUseId,
        toolUseId,
        isError,
        content: toolResultText(result.data.content),
      });
      const change = pendingFileChanges.get(toolUseId);
      if (change) {
        pendingFileChanges.delete(toolUseId);
        if (!isError) events.push({ kind: 'file_change', ...change });
      }
    }
    return events;
  }

  function fromStreamEvent(raw: Record<string, unknown>): AgentEvent[] {
    const parsed = RawStreamEvent.safeParse(raw);
    if (!parsed.success) return [unknown('stream_event', raw)];
    const { event } = parsed.data;
    if (IGNORED_STREAM_EVENTS.has(event.type)) return [];
    if (event.type === 'content_block_delta' && event.delta) {
      if (event.delta.type === 'text_delta' && typeof event.delta.text === 'string') {
        return [
          {
            kind: 'text_delta',
            parentToolUseId: parsed.data.parent_tool_use_id ?? null,
            text: event.delta.text,
          },
        ];
      }
      if (event.delta.type && IGNORED_DELTAS.has(event.delta.type)) return [];
    }
    return [unknown(`stream_event:${event.type}`, raw)];
  }

  function fromResult(raw: Record<string, unknown>): AgentEvent[] {
    const parsed = RawResult.safeParse(raw);
    if (!parsed.success) return [unknown('result', raw)];
    const r = parsed.data;
    const permissionDenials: PermissionDenial[] = (r.permission_denials ?? []).map((d) => ({
      toolName: d.tool_name,
      toolUseId: d.tool_use_id ?? null,
      input: d.tool_input ?? {},
    }));
    const event: AgentEventOf<'result'> = {
      kind: 'result',
      subtype: r.subtype,
      isError: r.is_error ?? r.subtype !== 'success',
      sessionId: r.session_id ?? null,
      text: typeof r.result === 'string' ? r.result : null,
      costUsd: r.total_cost_usd ?? null,
      numTurns: r.num_turns ?? null,
      durationMs: r.duration_ms ?? null,
      permissionDenials,
      errors: (r.errors ?? []).map(String),
    };
    if (r.structured_output !== undefined) event.structuredOutput = r.structured_output;
    pendingFileChanges.clear();
    return [event];
  }

  function fromSystem(raw: Record<string, unknown>, subtype: unknown): AgentEvent[] {
    if (subtype === 'init') {
      const init = RawInit.safeParse(raw);
      if (!init.success) return [unknown('system/init', raw)];
      const d = init.data;
      return [
        {
          kind: 'session_started',
          sessionId: d.session_id,
          model: d.model ?? null,
          cwd: d.cwd ?? null,
          cliVersion: d.claude_code_version ?? null,
          permissionMode: d.permissionMode ?? null,
          tools: d.tools ?? [],
        },
      ];
    }
    if (subtype === 'status') {
      const status = RawStatus.safeParse(raw);
      if (status.success) return [{ kind: 'status', status: status.data.status }];
    }
    return [unknown(`system/${String(subtype)}`, raw)];
  }

  function fromRateLimit(raw: Record<string, unknown>): AgentEvent[] {
    const parsed = RawRateLimit.safeParse(raw);
    if (!parsed.success) return [unknown('rate_limit_event', raw)];
    const info = parsed.data.rate_limit_info;
    return [
      {
        kind: 'rate_limit',
        status: info?.status ?? null,
        rateLimitType: info?.rateLimitType ?? null,
        resetsAt: info?.resetsAt ?? null,
      },
    ];
  }

  return {
    push(line: string): AgentEvent[] {
      const trimmed = line.trim();
      if (trimmed === '') return [];
      let raw: unknown;
      try {
        raw = JSON.parse(trimmed);
      } catch {
        return [{ kind: 'error', code: 'invalid_json', message: truncate(trimmed, 500) }];
      }
      if (!isRecord(raw)) return [unknown(null, raw)];
      switch (raw.type) {
        case 'system':
          return fromSystem(raw, raw.subtype);
        case 'assistant':
          return fromAssistant(raw);
        case 'user':
          return fromUser(raw);
        case 'stream_event':
          return fromStreamEvent(raw);
        case 'result':
          return fromResult(raw);
        case 'rate_limit_event':
          return fromRateLimit(raw);
        default:
          return [unknown(typeof raw.type === 'string' ? raw.type : null, raw)];
      }
    },
  };
}

/** Parses a whole stream-json transcript, or the single object from `--output-format json`. */
export function parseClaudeOutput(text: string): AgentEvent[] {
  const adapter = createClaudeStreamAdapter();
  return text.split(/\r?\n/).flatMap((line) => adapter.push(line));
}

/**
 * The CLI reports some failures only on stderr with no JSON at all
 * (see fixtures 02-stream-no-verbose and 10-resume-unknown).
 */
export function classifyCliStderr(stderr: string): AgentEventOf<'error'> | null {
  const message = stderr.trim();
  if (message === '') return null;
  if (/No conversation found with session ID/i.test(message)) {
    return { kind: 'error', code: 'session_not_found', message };
  }
  if (/stream-json requires --verbose/i.test(message)) {
    return { kind: 'error', code: 'stream_json_requires_verbose', message };
  }
  return { kind: 'error', code: 'cli_error', message: truncate(message, 2000) };
}

// ---------- helpers ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolResultText(content: string | unknown[] | null | undefined): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
