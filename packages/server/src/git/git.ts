import { execa } from 'execa';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Thin wrapper around the `git` command (docs/ARCHITECTURE.md → "Git worktree stratejisi").
 *
 * The user's repository is only ever touched through `git worktree` and branch refs under
 * `team/`: nothing here checks out, resets, commits to or writes files in the user's own
 * working tree, and their current branch is never moved.
 */

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly stderr: string,
    readonly exitCode: number | undefined,
  ) {
    super(`git ${args.join(' ')} failed: ${stderr.trim() || `exit code ${String(exitCode)}`}`);
    this.name = 'GitError';
  }
}

/** Identity for Squadboard's own snapshot commits when the repo has no user.name/email. */
export const FALLBACK_IDENTITY = { name: 'Squadboard', email: 'squadboard@localhost' };

export const BRANCH_PREFIX = 'team/';

async function git(cwd: string, args: string[], allowFailure = false) {
  const result = await execa('git', args, {
    cwd,
    reject: false,
    stripFinalNewline: true,
    windowsHide: true,
    // Never wait for credentials or an editor.
    env: { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
  });
  if (result.exitCode !== 0 && !allowFailure) {
    throw new GitError(args, String(result.stderr), result.exitCode);
  }
  return {
    ok: result.exitCode === 0,
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

// ---------- per-repository lock ----------
// Parallel `git worktree add` / commits in one repo can collide on .git lock files.

const locks = new Map<string, Promise<unknown>>();

export function withRepoLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(repo).toLowerCase();
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return next;
}

// ---------- repository ----------

export interface RepoInfo {
  /** Top-level directory of the repository (normalised by git). */
  root: string;
  /** Currently checked-out branch, or null when HEAD is detached. */
  branch: string | null;
  /** False for a repository without any commit yet. */
  hasCommits: boolean;
}

/** Returns repository info, or null if `dir` is not inside a git work tree. */
export async function getRepoInfo(dir: string): Promise<RepoInfo | null> {
  const top = await git(dir, ['rev-parse', '--show-toplevel'], true);
  if (!top.ok) return null;
  const root = resolve(top.stdout.trim());
  const branch = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true);
  const head = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], true);
  return { root, branch: branch.ok ? branch.stdout.trim() : null, hasCommits: head.ok };
}

/** Clean = no staged, unstaged or untracked (non-ignored) changes. */
export async function isClean(dir: string): Promise<boolean> {
  const status = await git(dir, ['status', '--porcelain']);
  return status.stdout.trim() === '';
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  return (await git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], true)).ok;
}

export async function resolveCommit(repo: string, ref: string): Promise<string> {
  return (await git(repo, ['rev-parse', '--verify', `${ref}^{commit}`])).stdout.trim();
}

/**
 * The branch new tasks start from, detected fresh every time (a stored name can go stale: the
 * user renames `master` to `main`, or the project was registered with a guess). In order:
 * the stored branch if it still exists, the remote's default branch (`origin/HEAD`), the
 * checked-out branch, then `main` / `master`. Only branches that have a commit count.
 * Returns null when the repository has no branch with a commit at all.
 */
export async function detectMainBranch(
  repo: string,
  stored: string | null,
): Promise<string | null> {
  const candidates: string[] = [];
  if (stored) candidates.push(stored);
  const remote = await git(
    repo,
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    true,
  );
  if (remote.ok) candidates.push(remote.stdout.trim().replace(/^origin\//, ''));
  const current = await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true);
  if (current.ok) candidates.push(current.stdout.trim());
  candidates.push('main', 'master');
  for (const branch of new Set(candidates.filter(Boolean))) {
    if (await branchExists(repo, branch)) return branch;
  }
  return null;
}

/** Number of changed, staged or untracked entries in the user's checkout. */
export async function countChanges(dir: string): Promise<number> {
  const status = await git(dir, ['status', '--porcelain']);
  return status.stdout.split(/\r?\n/).filter((l) => l.trim() !== '').length;
}

export async function isValidBranchName(repo: string, branch: string): Promise<boolean> {
  return (await git(repo, ['check-ref-format', '--branch', branch], true)).ok;
}

// ---------- worktrees ----------

export interface CreateWorktreeOptions {
  /** New branch, e.g. `team/auth-api-1a2b`. */
  branch: string;
  /** Absolute directory for the worktree; must not exist yet. */
  path: string;
  /** Branch or commit to start from: the project's main branch, or a dependency's branch (stacked). */
  base: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  /** Commit the branch started from; changes are measured against it. */
  baseCommit: string;
}

/**
 * Creates `branch` at `base` and checks it out in a new worktree at `path`.
 * If the branch already exists (worktree was cleaned up earlier), it is checked out as is.
 */
export function createWorktree(
  repo: string,
  options: CreateWorktreeOptions,
): Promise<WorktreeInfo> {
  return withRepoLock(repo, async () => {
    if (!options.branch.startsWith(BRANCH_PREFIX)) {
      throw new Error(`Squadboard only creates branches under ${BRANCH_PREFIX}: ${options.branch}`);
    }
    const baseCommit = await resolveCommit(repo, options.base);
    mkdirSync(dirname(options.path), { recursive: true });
    if (await branchExists(repo, options.branch)) {
      await git(repo, ['worktree', 'add', options.path, options.branch]);
    } else {
      await git(repo, ['worktree', 'add', '-b', options.branch, options.path, baseCommit]);
    }
    return { path: options.path, branch: options.branch, baseCommit };
  });
}

export interface ListedWorktree {
  path: string;
  branch: string | null;
  head: string | null;
}

export async function listWorktrees(repo: string): Promise<ListedWorktree[]> {
  const out = (await git(repo, ['worktree', 'list', '--porcelain'])).stdout;
  const list: ListedWorktree[] = [];
  let current: ListedWorktree | null = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: resolve(line.slice('worktree '.length)), branch: null, head: null };
      list.push(current);
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  return list;
}

/**
 * Removes the worktree directory (even with uncommitted changes) and prunes git's metadata.
 * With `deleteBranch`, the `team/` branch goes too; otherwise the committed work stays on it.
 */
export function removeWorktree(
  repo: string,
  options: { path: string; branch?: string; deleteBranch?: boolean },
): Promise<void> {
  return withRepoLock(repo, async () => {
    await git(repo, ['worktree', 'remove', '--force', options.path], true);
    await git(repo, ['worktree', 'prune']);
    if (options.deleteBranch && options.branch) {
      if (!options.branch.startsWith(BRANCH_PREFIX)) {
        throw new Error(`Refusing to delete a branch outside ${BRANCH_PREFIX}: ${options.branch}`);
      }
      if (await branchExists(repo, options.branch)) {
        await git(repo, ['branch', '-D', options.branch]);
      }
    }
  });
}

// ---------- changes inside a worktree ----------

function splitNul(text: string): string[] {
  return text.split('\0').filter((p) => p !== '');
}

/**
 * Files changed in the worktree relative to `baseCommit`: committed and uncommitted changes to
 * tracked files plus new untracked (non-ignored) files. Paths are repo-relative with `/`.
 */
export async function changedFiles(worktree: string, baseCommit: string): Promise<string[]> {
  const tracked = await git(worktree, ['diff', '--name-only', '-z', baseCommit]);
  const untracked = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']);
  return [...new Set([...splitNul(tracked.stdout), ...splitNul(untracked.stdout)])].sort();
}

/**
 * Commits everything in the worktree to its own branch (a snapshot of the agent's work, so a
 * dependent task can start from it). Returns the new commit, or null if there was nothing to
 * commit. Uses the repo's identity, falling back to Squadboard's when none is configured.
 */
export function commitAll(repo: string, worktree: string, message: string): Promise<string | null> {
  return withRepoLock(repo, async () => {
    const branch = await git(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true);
    if (!branch.ok || !branch.stdout.trim().startsWith(BRANCH_PREFIX)) {
      throw new Error(`Refusing to commit outside a ${BRANCH_PREFIX} branch in ${worktree}`);
    }
    await git(worktree, ['add', '--all']);
    if ((await git(worktree, ['diff', '--cached', '--quiet'], true)).ok) return null;

    const identity = await identityArgs(worktree);
    await git(worktree, [...identity, 'commit', '--quiet', '-m', message]);
    return (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  });
}

/** `-c user.name=… -c user.email=…` when the repo has no identity of its own. */
async function identityArgs(worktree: string): Promise<string[]> {
  const hasEmail = (await git(worktree, ['config', 'user.email'], true)).stdout.trim() !== '';
  return hasEmail
    ? []
    : ['-c', `user.name=${FALLBACK_IDENTITY.name}`, '-c', `user.email=${FALLBACK_IDENTITY.email}`];
}

// ---------- base branch for a task with several dependencies ----------

export class MergeConflictError extends Error {
  constructor(
    /** The branch that could not be merged into the others. */
    readonly branch: string,
    /** Files both sides changed (from git's unmerged list). */
    readonly files: string[],
    readonly gitOutput: string,
  ) {
    super(`Merging ${branch} conflicts in: ${files.join(', ') || '(unknown files)'}`);
    this.name = 'MergeConflictError';
  }
}

export interface MergedBaseOptions {
  /** New branch under `team/` holding the merge, e.g. `team/test-1a2b-base`. */
  branch: string;
  /** Temporary worktree used for merging; removed again before returning. */
  path: string;
  /** Branches to combine (the dependencies' branches), in order. At least two. */
  sources: string[];
}

/**
 * Creates `branch` from the first source and merges the others into it (one merge commit each),
 * in a temporary worktree outside the user's repo. The user's checkout and main branch are not
 * touched. If the branch already exists (made for an earlier start) it is reused as is.
 *
 * On a conflict the merge is aborted, the temporary worktree and branch are removed and a
 * MergeConflictError names the branch and files.
 */
export function createMergedBase(
  repo: string,
  options: MergedBaseOptions,
): Promise<{ branch: string; commit: string }> {
  return withRepoLock(repo, async () => {
    const { branch, path, sources } = options;
    if (!branch.startsWith(BRANCH_PREFIX)) {
      throw new Error(`Squadboard only creates branches under ${BRANCH_PREFIX}: ${branch}`);
    }
    const [first, ...rest] = sources;
    if (!first || rest.length === 0)
      throw new Error('createMergedBase needs at least two branches');
    if (await branchExists(repo, branch)) {
      return { branch, commit: await resolveCommit(repo, branch) };
    }

    mkdirSync(dirname(path), { recursive: true });
    await git(repo, ['worktree', 'add', '-b', branch, path, await resolveCommit(repo, first)]);
    const cleanup = async (deleteBranch: boolean) => {
      await git(repo, ['worktree', 'remove', '--force', path], true);
      await git(repo, ['worktree', 'prune'], true);
      if (deleteBranch) await git(repo, ['branch', '-D', branch], true);
    };

    try {
      const identity = await identityArgs(path);
      for (const source of rest) {
        const merge = await git(
          path,
          [
            ...identity,
            'merge',
            '--no-ff',
            '--no-edit',
            '-m',
            `squadboard: merge ${source}`,
            source,
          ],
          true,
        );
        if (!merge.ok) {
          const unmerged = await git(path, ['diff', '--name-only', '--diff-filter=U', '-z'], true);
          await git(path, ['merge', '--abort'], true);
          throw new MergeConflictError(
            source,
            splitNul(unmerged.stdout).sort(),
            [merge.stdout, merge.stderr].join('\n').trim(),
          );
        }
      }
      const commit = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
      await cleanup(false);
      return { branch, commit };
    } catch (err) {
      await cleanup(true);
      throw err;
    }
  });
}

/** Deletes a `team/` branch if it exists (e.g. a merged base nobody needs any more). */
export function deleteTeamBranch(repo: string, branch: string): Promise<void> {
  return withRepoLock(repo, async () => {
    if (!branch.startsWith(BRANCH_PREFIX)) {
      throw new Error(`Refusing to delete a branch outside ${BRANCH_PREFIX}: ${branch}`);
    }
    if (await branchExists(repo, branch)) await git(repo, ['branch', '-D', branch]);
  });
}
