import { z } from 'zod';

/**
 * App-level events derived from the Claude CLI stream. UI and storage only see these,
 * never raw CLI lines, so CLI format changes stay inside the adapter.
 *
 * `parentToolUseId` is set when the event comes from a sub-agent (Task tool).
 */

const parentToolUseId = z.string().nullable();

export const SessionStartedEvent = z.object({
  kind: z.literal('session_started'),
  sessionId: z.string(),
  model: z.string().nullable(),
  cwd: z.string().nullable(),
  cliVersion: z.string().nullable(),
  permissionMode: z.string().nullable(),
  tools: z.array(z.string()),
});

export const TextEvent = z.object({
  kind: z.literal('text'),
  messageId: z.string().nullable(),
  parentToolUseId,
  text: z.string(),
});

export const ThinkingEvent = z.object({
  kind: z.literal('thinking'),
  messageId: z.string().nullable(),
  parentToolUseId,
  text: z.string(),
});

/** Streaming text chunk (`--include-partial-messages` only). The full `text` event still follows. */
export const TextDeltaEvent = z.object({
  kind: z.literal('text_delta'),
  parentToolUseId,
  text: z.string(),
});

export const ToolUseEvent = z.object({
  kind: z.literal('tool_use'),
  messageId: z.string().nullable(),
  parentToolUseId,
  toolUseId: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

export const ToolResultEvent = z.object({
  kind: z.literal('tool_result'),
  parentToolUseId,
  toolUseId: z.string(),
  isError: z.boolean(),
  content: z.string(),
});

/** Emitted only after a file-writing tool succeeded (denied or failed edits produce none). */
export const FileChangeEvent = z.object({
  kind: z.literal('file_change'),
  toolUseId: z.string(),
  tool: z.string(),
  operation: z.enum(['edit', 'write']),
  path: z.string(),
});

export const PermissionDenial = z.object({
  toolName: z.string(),
  toolUseId: z.string().nullable(),
  input: z.record(z.string(), z.unknown()),
});
export type PermissionDenial = z.infer<typeof PermissionDenial>;

/** Last event of a run. A run killed mid-way has none. */
export const ResultEvent = z.object({
  kind: z.literal('result'),
  /** CLI `subtype`: `success`, `error_max_turns`, … */
  subtype: z.string(),
  isError: z.boolean(),
  sessionId: z.string().nullable(),
  /** Final assistant text. Absent on some errors (e.g. `error_max_turns`). */
  text: z.string().nullable(),
  structuredOutput: z.unknown().optional(),
  costUsd: z.number().nullable(),
  numTurns: z.number().nullable(),
  durationMs: z.number().nullable(),
  /** Tools the CLI refused. Non-empty means the run "succeeded" without doing everything. */
  permissionDenials: z.array(PermissionDenial),
  errors: z.array(z.string()),
});

export const RateLimitEvent = z.object({
  kind: z.literal('rate_limit'),
  status: z.string().nullable(),
  rateLimitType: z.string().nullable(),
  resetsAt: z.number().nullable(),
});

export const StatusEvent = z.object({
  kind: z.literal('status'),
  status: z.string(),
});

export const ErrorCode = z.enum([
  'invalid_json',
  'session_not_found',
  'stream_json_requires_verbose',
  'cli_error',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Something went wrong outside the model: unparsable line, CLI error on stderr, … */
export const ErrorEvent = z.object({
  kind: z.literal('error'),
  code: ErrorCode,
  message: z.string(),
});

/** A line we could parse but do not understand. Kept raw so the UI can still show it. */
export const UnknownEvent = z.object({
  kind: z.literal('unknown'),
  rawType: z.string().nullable(),
  raw: z.unknown(),
});

export const AgentEvent = z.discriminatedUnion('kind', [
  SessionStartedEvent,
  TextEvent,
  ThinkingEvent,
  TextDeltaEvent,
  ToolUseEvent,
  ToolResultEvent,
  FileChangeEvent,
  ResultEvent,
  RateLimitEvent,
  StatusEvent,
  ErrorEvent,
  UnknownEvent,
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
export type AgentEventKind = AgentEvent['kind'];
export type AgentEventOf<K extends AgentEventKind> = Extract<AgentEvent, { kind: K }>;
