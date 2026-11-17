import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitSync, makeTestRepo, snapshotUserRepo, type TestRepo } from '../../test/git-repo.js';
import {
  changedFiles,
  commitAll,
  createWorktree,
  getRepoInfo,
  isClean,
  listWorktrees,
  removeWorktree,
} from './git.js';
import { slugify, taskBranchName } from './naming.js';

let t: TestRepo | undefined;
let before: ReturnType<typeof snapshotUserRepo>;

function setup(files?: Record<string, string>): TestRepo {
  t = makeTestRepo(files);
  before = snapshotUserRepo(t.repo);
  return t;
}

afterEach(() => {
  if (!t) return;
  try {
    // The user's checkout must look exactly as before, whatever the test did.
    expect(snapshotUserRepo(t.repo)).toEqual(before);
  } finally {
    rmSync(t.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    t = undefined;
  }
});

describe('repository checks', () => {
  it('recognises a repo, its root and current branch, also from a subfolder', async () => {
    const t = setup();
    expect(await getRepoInfo(t.repo)).toEqual({ root: t.repo, branch: 'main', hasCommits: true });
    expect((await getRepoInfo(join(t.repo, 'src')))?.root).toBe(t.repo);
  });

  it('returns null outside a repo', async () => {
    const t = setup();
    expect(await getRepoInfo(t.dir)).toBeNull();
  });

  it('reports whether the working tree is clean', async () => {
    const t = setup();
    expect(await isClean(t.repo)).toBe(true);
    writeFileSync(join(t.repo, 'scratch.txt'), 'x');
    expect(await isClean(t.repo)).toBe(false);
    rmSync(join(t.repo, 'scratch.txt'));
  });
});

describe('worktrees', () => {
  it('creates team/<name> in a folder outside the repo, from main', async () => {
    const t = setup();
    const path = join(t.worktrees, 'api-1a2b');
    const wt = await createWorktree(t.repo, { branch: 'team/api-1a2b', path, base: 'main' });

    expect(wt).toEqual({ path, branch: 'team/api-1a2b', baseCommit: before.head });
    expect(readFileSync(join(path, 'README.md'), 'utf8')).toBe('# Test project\n');
    expect(gitSync(path, 'symbolic-ref', '--short', 'HEAD')).toBe('team/api-1a2b');
    const listed = await listWorktrees(t.repo);
    expect(listed.map((w) => w.branch)).toEqual(['main', 'team/api-1a2b']);
    expect(listed[1]?.path).toBe(path);
  });

  it('refuses branches outside team/', async () => {
    const t = setup();
    await expect(
      createWorktree(t.repo, { branch: 'main2', path: join(t.worktrees, 'x'), base: 'main' }),
    ).rejects.toThrow(/team\//);
  });

  it('measures changed files (edited, new, committed) against the base', async () => {
    const t = setup();
    const path = join(t.worktrees, 'a');
    const wt = await createWorktree(t.repo, { branch: 'team/a', path, base: 'main' });
    writeFileSync(join(path, 'README.md'), '# Test project\nmore\n');
    writeFileSync(join(path, 'notes.md'), 'new file');
    expect(await changedFiles(path, wt.baseCommit)).toEqual(['README.md', 'notes.md']);

    const commit = await commitAll(t.repo, path, 'squadboard: a');
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    // Same answer after committing; nothing left uncommitted.
    expect(await changedFiles(path, wt.baseCommit)).toEqual(['README.md', 'notes.md']);
    expect(await isClean(path)).toBe(true);
    expect(gitSync(t.repo, 'log', '-1', '--format=%s', 'team/a')).toBe('squadboard: a');
  });

  it('commitAll returns null when there is nothing to commit', async () => {
    const t = setup();
    const path = join(t.worktrees, 'a');
    await createWorktree(t.repo, { branch: 'team/a', path, base: 'main' });
    expect(await commitAll(t.repo, path, 'nothing')).toBeNull();
  });

  it('stacked: a dependent task starts from the previous task branch and sees its work', async () => {
    const t = setup();
    const first = join(t.worktrees, 'db');
    await createWorktree(t.repo, { branch: 'team/db', path: first, base: 'main' });
    writeFileSync(join(first, 'schema.sql'), 'create table users();');
    const dbCommit = await commitAll(t.repo, first, 'squadboard: db');

    const second = join(t.worktrees, 'api');
    const wt = await createWorktree(t.repo, { branch: 'team/api', path: second, base: 'team/db' });
    expect(wt.baseCommit).toBe(dbCommit);
    expect(existsSync(join(second, 'schema.sql'))).toBe(true);

    // The second task's changes are measured against the first task, not main.
    writeFileSync(join(second, 'api.ts'), 'export {}');
    expect(await changedFiles(second, wt.baseCommit)).toEqual(['api.ts']);
    expect(gitSync(t.repo, 'merge-base', '--is-ancestor', 'team/db', 'team/api')).toBe('');
  });

  it('two worktrees can be created in parallel (repo lock)', async () => {
    const t = setup();
    const results = await Promise.all(
      ['a', 'b', 'c'].map((n) =>
        createWorktree(t.repo, { branch: `team/${n}`, path: join(t.worktrees, n), base: 'main' }),
      ),
    );
    expect(results.map((r) => r.branch)).toEqual(['team/a', 'team/b', 'team/c']);
    expect(await listWorktrees(t.repo)).toHaveLength(4);
  });

  it('cleanup removes the worktree (even with uncommitted changes) and keeps or deletes the branch', async () => {
    const t = setup();
    const keep = join(t.worktrees, 'keep');
    await createWorktree(t.repo, { branch: 'team/keep', path: keep, base: 'main' });
    writeFileSync(join(keep, 'wip.txt'), 'uncommitted');
    await removeWorktree(t.repo, { path: keep, branch: 'team/keep' });
    expect(existsSync(keep)).toBe(false);
    expect(gitSync(t.repo, 'branch', '--list', 'team/keep')).toContain('team/keep');

    const drop = join(t.worktrees, 'drop');
    await createWorktree(t.repo, { branch: 'team/drop', path: drop, base: 'main' });
    await removeWorktree(t.repo, { path: drop, branch: 'team/drop', deleteBranch: true });
    expect(gitSync(t.repo, 'branch', '--list', 'team/drop')).toBe('');
    expect((await listWorktrees(t.repo)).map((w) => w.branch)).toEqual(['main']);
  });

  it('re-creating a worktree for an existing branch checks it out instead of failing', async () => {
    const t = setup();
    const path = join(t.worktrees, 'again');
    await createWorktree(t.repo, { branch: 'team/again', path, base: 'main' });
    writeFileSync(join(path, 'done.txt'), 'work');
    await commitAll(t.repo, path, 'work');
    await removeWorktree(t.repo, { path, branch: 'team/again' });

    await createWorktree(t.repo, { branch: 'team/again', path, base: 'main' });
    expect(existsSync(join(path, 'done.txt'))).toBe(true);
  });

  it('never deletes a branch outside team/', async () => {
    const t = setup();
    await expect(
      removeWorktree(t.repo, {
        path: join(t.worktrees, 'none'),
        branch: 'main',
        deleteBranch: true,
      }),
    ).rejects.toThrow(/Refusing/);
  });
});

describe('naming', () => {
  it('slugifies Turkish titles to ASCII', () => {
    expect(slugify("Giriş ve kayıt API'si")).toBe('giris-ve-kayit-api-si');
    expect(slugify('ÇĞİÖŞÜ çğıöşü')).toBe('cgiosu-cgiosu');
    expect(slugify('!!!')).toBe('task');
    expect(slugify('a'.repeat(100)).length).toBe(40);
  });

  it('builds team/<slug>-<id> branch names', () => {
    expect(taskBranchName('Giriş formu', '9f3c2e1a-0000')).toBe('team/giris-formu-9f3c');
  });
});
