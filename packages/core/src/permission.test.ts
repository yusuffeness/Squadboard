import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEventOf } from './agent-event.js';
import { parseClaudeOutput } from './claude-adapter.js';
import {
  buildAllowedTools,
  defaultAllowRules,
  permissionRequestsFrom,
  ruleFor,
  ruleTool,
} from './permission.js';

const FIXTURES = fileURLToPath(new URL('../test/fixtures/claude-cli/', import.meta.url));
const denialsOf = (name: string) =>
  parseClaudeOutput(readFileSync(FIXTURES + name, 'utf8')).find(
    (e): e is AgentEventOf<'result'> => e.kind === 'result',
  )?.permissionDenials ?? [];

describe('permissionRequestsFrom', () => {
  it('turns the real Bash denial into one request (the CLI listed it twice)', () => {
    expect(denialsOf('24-perm-bash-denied.jsonl')).toHaveLength(2);
    expect(permissionRequestsFrom(denialsOf('24-perm-bash-denied.jsonl'))).toEqual([
      {
        tool: 'Bash',
        command: 'npm test',
        path: null,
        rule: 'Bash(npm test)',
        input: { command: 'npm test', timeout: 60000 },
      },
    ]);
  });

  it('leaves AskUserQuestion out: it is a question, not a permission', () => {
    expect(permissionRequestsFrom(denialsOf('22-ask-user-question.jsonl'))).toEqual([]);
  });

  it('shows the file of a denied file tool', () => {
    const [req] = permissionRequestsFrom([
      { toolName: 'Write', toolUseId: null, input: { file_path: '/etc/hosts', content: 'x' } },
    ]);
    expect(req).toMatchObject({ tool: 'Write', path: '/etc/hosts', command: null, rule: 'Write' });
  });
});

describe('rules', () => {
  it('uses the exact command for Bash', () => {
    expect(ruleFor('Bash', { command: ' npm run lint ' })).toBe('Bash(npm run lint)');
    expect(ruleFor('Bash', {})).toBe('Bash');
    expect(ruleTool('Bash(npm test:*)')).toBe('Bash');
    expect(ruleTool('Read')).toBe('Read');
  });

  it('never auto-approves bare Bash or AskUserQuestion, and drops rules for missing tools', () => {
    expect(
      buildAllowedTools(
        ['Read', 'Edit', 'Bash', 'AskUserQuestion'],
        ['Bash(npm test:*)', 'Bash', 'WebFetch(domain:x.com)', 'Read', 'Bash(npm test:*)'],
      ),
    ).toEqual(['Read', 'Edit', 'Bash(npm test:*)']);
    // A read-only agent: --tools has no Bash, so shell rules do not apply to it.
    expect(buildAllowedTools(['Read', 'Glob', 'Grep'], ['Bash(npm test:*)'])).toEqual([
      'Read',
      'Glob',
      'Grep',
    ]);
  });

  it('derives the default allowlist from the scripts and the package manager', () => {
    expect(
      defaultAllowRules({ scripts: ['test', 'lint', 'build'], packageManager: 'npm' }),
    ).toEqual(['Bash(npm test:*)', 'Bash(npm run test:*)', 'Bash(npm run lint:*)']);
    expect(defaultAllowRules({ scripts: ['typecheck'], packageManager: 'pnpm' })).toEqual([
      'Bash(pnpm typecheck:*)',
      'Bash(pnpm run typecheck:*)',
    ]);
    expect(defaultAllowRules({ scripts: ['build'], packageManager: 'npm' })).toEqual([]);
  });
});
