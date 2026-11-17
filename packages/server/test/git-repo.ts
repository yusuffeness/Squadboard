import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Runs git in `cwd` with a fixed identity (CI machines have no global user.name/email). */
export function gitSync(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

export interface TestRepo {
  /** Parent temp dir (holds the repo and the worktrees dir). */
  dir: string;
  /** The "user's" repository. */
  repo: string;
  /** Where Squadboard puts worktrees, outside the repo. */
  worktrees: string;
}

/** Turns an existing folder into a repo on `main` with one commit. */
export function initRepo(dir: string): void {
  gitSync(dir, 'init', '--quiet', '--initial-branch=main');
  gitSync(dir, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(dir, 'README.md'), '# Test project\n');
  gitSync(dir, 'add', '--all');
  gitSync(dir, 'commit', '--quiet', '-m', 'init');
}

/** A repo on `main` with one commit, like a user's project. */
export function makeTestRepo(files: Record<string, string> = {}): TestRepo {
  const dir = mkdtempSync(join(tmpdir(), 'squadboard-git-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  gitSync(repo, 'init', '--quiet', '--initial-branch=main');
  // Tests compare file contents byte for byte; a global core.autocrlf=true would add \r.
  gitSync(repo, 'config', 'core.autocrlf', 'false');
  const all = { 'README.md': '# Test project\n', 'src/app.ts': 'export const x = 1;\n', ...files };
  for (const [name, content] of Object.entries(all)) {
    mkdirSync(dirname(join(repo, name)), { recursive: true });
    writeFileSync(join(repo, name), content);
  }
  gitSync(repo, 'add', '--all');
  gitSync(repo, 'commit', '--quiet', '-m', 'init');
  return { dir, repo, worktrees: join(dir, 'worktrees') };
}

/** Everything a user would notice about their checkout. */
export function snapshotUserRepo(repo: string) {
  return {
    branch: gitSync(repo, 'symbolic-ref', '--short', 'HEAD'),
    head: gitSync(repo, 'rev-parse', 'HEAD'),
    mainRef: gitSync(repo, 'rev-parse', 'refs/heads/main'),
    status: gitSync(repo, 'status', '--porcelain', '--untracked-files=all'),
  };
}
