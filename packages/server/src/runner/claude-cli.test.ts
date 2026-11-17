import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, cleanEnv, resolveClaudeCommand } from './claude-cli.js';

describe('buildClaudeArgs', () => {
  it('always streams with --verbose and never skips permissions', () => {
    const args = buildClaudeArgs('hi', { sessionId: 's1' });
    expect(args).toEqual([
      '-p',
      'hi',
      '--output-format',
      'stream-json',
      '--verbose',
      '--strict-mcp-config',
      '--session-id',
      's1',
      '--permission-mode',
      'acceptEdits',
      '--max-turns',
      '40',
    ]);
  });

  it('uses --resume instead of --session-id when resuming', () => {
    const args = buildClaudeArgs('go on', { resume: 's1' });
    expect(args).toContain('--resume');
    expect(args).not.toContain('--session-id');
  });

  it('adds optional flags', () => {
    const args = buildClaudeArgs(
      'plan',
      { sessionId: 's1' },
      {
        tools: ['Read', 'Glob'],
        model: 'sonnet',
        maxTurns: 5,
        maxBudgetUsd: 1.25,
        jsonSchema: { type: 'object' },
        permissionMode: 'dontAsk',
      },
    );
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value('--tools')).toBe('Read,Glob');
    expect(value('--model')).toBe('sonnet');
    expect(value('--max-turns')).toBe('5');
    expect(value('--max-budget-usd')).toBe('1.25');
    expect(value('--json-schema')).toBe('{"type":"object"}');
    expect(value('--permission-mode')).toBe('dontAsk');
    expect(args).not.toContain('--allowedTools');
  });
});

describe('cleanEnv', () => {
  it('drops variables injected by a parent Claude Code session, keeps user config', () => {
    const env = cleanEnv({
      PATH: '/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk',
      CLAUDE_CODE_SESSION_ID: 'x',
      MCP_CONNECTION_NONBLOCKING: '1',
      CLAUDE_CONFIG_DIR: '/cfg',
      CLAUDE_CODE_USE_BEDROCK: '1',
      ANTHROPIC_API_KEY: 'k',
    });
    expect(env).toEqual({
      PATH: '/bin',
      CLAUDE_CONFIG_DIR: '/cfg',
      CLAUDE_CODE_USE_BEDROCK: '1',
      ANTHROPIC_API_KEY: 'k',
    });
  });
});

describe('resolveClaudeCommand', () => {
  it('honours SQUADBOARD_CLAUDE_BIN', () => {
    expect(resolveClaudeCommand({ SQUADBOARD_CLAUDE_BIN: '/opt/claude' })).toEqual({
      file: '/opt/claude',
      args: [],
    });
  });
});
