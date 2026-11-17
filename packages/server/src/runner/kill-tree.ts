import { execFile } from 'node:child_process';

/**
 * Kills a process and everything it started (docs/claude-cli-notes.md §6).
 *
 * - Windows: `child.kill()` only ends claude.exe; the shells and commands the agent started keep
 *   running as orphans. `taskkill /T /F` walks the tree by parent PID and kills all of it.
 * - macOS/Linux: the child is spawned with `detached: true`, so it leads its own process group;
 *   signalling `-pid` reaches the whole group. SIGTERM first, SIGKILL after `graceMs`.
 *
 * Resolves once the signal/command has been sent; the caller waits for the process to close.
 */
export async function killProcessTree(pid: number, graceMs = 3000): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      // Errors are expected when the process is already gone.
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () =>
        resolve(),
      );
    });
    return;
  }

  if (!signalGroup(pid, 'SIGTERM')) return;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await sleep(50);
    if (!groupAlive(pid)) return;
  }
  signalGroup(pid, 'SIGKILL');
}

function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: exists but owned by someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
