/**
 * Turns the git failures users actually hit into short Turkish sentences. The raw git output is
 * kept as `detail` so the UI can still show it under "Ayrıntı".
 */

export interface ExplainedError {
  message: string;
  detail: string;
}

const RULES: { test: RegExp; message: (raw: string) => string }[] = [
  {
    test: /does not have any commits yet|ambiguous argument 'HEAD'|bad default revision 'HEAD'/i,
    message: () => "Depoda henüz commit yok. Görev başlatmadan önce ilk commit'i at.",
  },
  {
    test: /needed a single revision|unknown revision|invalid reference|not a valid object name|not a valid ref/i,
    message: (raw) => {
      const ref =
        /--verify\s+([^\s^]+)\^\{commit\}/.exec(raw)?.[1] ??
        /(?:unknown revision|invalid reference|not a valid object name|not a valid ref)[: ]+'?([^'\s^]+)/i.exec(
          raw,
        )?.[1];
      return ref
        ? `"${ref}" diye bir dal bulunamadı. Dal silinmiş ya da adı değişmiş olabilir.`
        : 'İstenen dal bulunamadı. Dal silinmiş ya da adı değişmiş olabilir.';
    },
  },
  {
    test: /not a git repository/i,
    message: () => 'Bu klasör bir git deposu değil.',
  },
  {
    test: /would be overwritten|contains modified or untracked files|please commit your changes or stash/i,
    message: () =>
      "Çalışma ağacında commit'lenmemiş değişiklik var. Önce commit'le ya da kenara al.",
  },
  {
    test: /is already checked out at|is already used by worktree/i,
    message: () => 'Bu dal başka bir çalışma klasöründe açık.',
  },
  {
    test: /already exists/i,
    message: () => 'Aynı adda bir dal ya da çalışma klasörü zaten var.',
  },
];

/** Returns the Turkish explanation, or null when the error is not one we recognise. */
export function explainGitError(raw: string): ExplainedError | null {
  for (const rule of RULES) {
    if (rule.test.test(raw)) return { message: rule.message(raw), detail: raw };
  }
  return null;
}
