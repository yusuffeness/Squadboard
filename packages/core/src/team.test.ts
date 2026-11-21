import { describe, expect, it } from 'vitest';
import {
  formatAgentFile,
  isReadOnly,
  parseAgentFile,
  parseTeamFile,
  type TeamFileInput,
} from './team.js';

const team = (over: Partial<TeamFileInput> = {}): TeamFileInput => ({
  id: 'fullstack-web',
  name: 'Full-stack web',
  agents: [
    {
      id: 'backend',
      file: 'backend.md',
      names: { tech: 'Arka Yüz', friendly: 'Motor' },
      color: '#8FB3FF',
      owns: ['src/api/**'],
    },
  ],
  settings: { concurrency: 3, worktrees: true, requirePlanApproval: true, requireReview: true },
  ...over,
});

const parse = (value: unknown) => parseTeamFile(JSON.stringify(value));

describe('parseTeamFile', () => {
  it('accepts a valid team and fills defaults', () => {
    const result = parse(team());
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.agents[0]).toMatchObject({ enabled: true, owns: ['src/api/**'] });
  });

  it('explains broken JSON in Turkish', () => {
    const result = parseTeamFile('{ "id": "x", ');
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/^\.team\/team\.json geçerli bir JSON değil/);
  });

  it('names the field and the problem', () => {
    const bad = team();
    const first = bad.agents[0];
    if (!first) throw new Error('fixture');
    const result = parse({ ...bad, agents: [{ ...first, color: 'mavi' }] });
    expect(result).toEqual({
      ok: false,
      error: '.team/team.json geçersiz: agents[0].color: color "#RRGGBB" biçiminde bir renk olmalı',
    });
  });

  it('rejects missing fields, duplicate ids and forbidden agent names', () => {
    const noSettings = { ...team(), settings: undefined };
    expect(parse(noSettings)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/settings/),
    });

    const first = team().agents[0];
    if (!first) throw new Error('fixture');
    const dup = parse(team({ agents: [first, { ...first, file: 'other.md' }] }));
    expect(dup).toMatchObject({ ok: false, error: expect.stringMatching(/iki kez/) });

    const claude = parse(team({ agents: [{ ...first, id: 'claude-helper' }] }));
    expect(claude).toMatchObject({ ok: false, error: expect.stringMatching(/claude/) });

    expect(parse(team({ agents: [] }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/en az bir ajan/),
    });
  });

  it('reads the allowlist and refuses bare Bash', () => {
    const ok = parse({ ...team(), permissions: { allow: ['Bash(npm test:*)', 'Read'] } });
    expect(ok).toMatchObject({
      ok: true,
      value: { permissions: { allow: ['Bash(npm test:*)', 'Read'] } },
    });

    expect(parse({ ...team(), permissions: { allow: ['Bash'] } })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/permissions\.allow\[0\]: Çıplak "Bash"/),
    });
    expect(parse({ ...team(), permissions: { allow: ['npm test'] } })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Araç\(…\)/),
    });
  });
});

describe('agent files', () => {
  const file = `---
name: reviewer
description: "Biten işi inceler: risk ve özet"
tools: Read, Glob, Grep
model: sonnet
---

Sen bu projenin İnceleyici ajanısın.
Dosya değiştirme.
`;

  it('parses front matter and prompt', () => {
    const result = parseAgentFile(file, 'reviewer.md');
    expect(result).toEqual({
      ok: true,
      value: {
        frontmatter: {
          name: 'reviewer',
          description: 'Biten işi inceler: risk ve özet',
          tools: ['Read', 'Glob', 'Grep'],
          model: 'sonnet',
        },
        prompt: 'Sen bu projenin İnceleyici ajanısın.\nDosya değiştirme.',
      },
    });
  });

  it('reads YAML lists and CRLF files', () => {
    const crlf =
      '---\r\nname: test\r\ndescription: Test yazar\r\ntools:\r\n  - Read\r\n  - Edit\r\n---\r\nTalimat\r\n';
    const result = parseAgentFile(crlf, 'test.md');
    expect(result.ok && result.value.frontmatter.tools).toEqual(['Read', 'Edit']);
    const bracket = parseAgentFile(
      '---\nname: a\ndescription: d\ntools: [Read, Grep]\n---\nx',
      'a.md',
    );
    expect(bracket.ok && bracket.value.frontmatter.tools).toEqual(['Read', 'Grep']);
  });

  it('round-trips through formatAgentFile', () => {
    const parsed = parseAgentFile(file, 'reviewer.md');
    if (!parsed.ok) throw new Error(parsed.error);
    const again = parseAgentFile(formatAgentFile(parsed.value), 'reviewer.md');
    expect(again).toEqual(parsed);
  });

  it('explains what is wrong, in Turkish, with the file name', () => {
    expect(parseAgentFile('Talimat', 'x.md')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^x\.md: dosya "---"/),
    });
    expect(parseAgentFile('---\nname: x\n---\nTalimat', 'x.md')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^x\.md geçersiz: description/),
    });
    expect(parseAgentFile('---\nname: x\ndescription: d\n---\n', 'x.md')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/talimat/),
    });
    expect(
      parseAgentFile('---\nname: x\ndescription: d\npermissionMode: yolo\n---\nT', 'x.md'),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/permissionMode/) });
  });

  it('knows read-only tool sets', () => {
    expect(isReadOnly(['Read', 'Grep'])).toBe(true);
    expect(isReadOnly(['Read', 'Edit'])).toBe(false);
    expect(isReadOnly(undefined)).toBe(false);
  });
});
