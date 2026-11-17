import { BRANCH_PREFIX } from './git.js';

const TURKISH: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  İ: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  Ç: 'c',
  Ğ: 'g',
  Ö: 'o',
  Ş: 's',
  Ü: 'u',
};

/** ASCII, lower-case, dash-separated, at most `max` characters: "Giriş API'si" → "giris-api-si". */
export function slugify(text: string, max = 40): string {
  const slug = text
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => TURKISH[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return slug || 'task';
}

/**
 * Branch and worktree folder name for a task: `team/<slug>-<4 chars of the id>`.
 * The id suffix keeps two tasks with the same title apart.
 */
export function taskBranchName(title: string, taskId: string): string {
  const suffix =
    taskId
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 4)
      .toLowerCase() || '0000';
  return `${BRANCH_PREFIX}${slugify(title)}-${suffix}`;
}

/** Folder name for the worktree (the branch without the `team/` prefix). */
export function worktreeFolderName(branch: string): string {
  return branch.slice(BRANCH_PREFIX.length);
}
