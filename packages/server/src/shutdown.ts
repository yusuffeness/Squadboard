/**
 * Stops agent processes when Squadboard exits, so none are left orphaned.
 *
 * On macOS/Linux runs are spawned `detached` (own process group, needed to kill the whole tree),
 * which also means they would NOT die with the server. Windows: Ctrl+C arrives as SIGINT,
 * Ctrl+Break as SIGBREAK, closing the console window as SIGHUP.
 *
 * A second signal while shutting down exits immediately.
 */
export function installShutdownHandlers(
  close: () => Promise<void>,
  log: (message: string) => void = (m) => console.log(m),
): () => void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  if (process.platform === 'win32') signals.push('SIGBREAK');

  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      log(`${signal} again: exiting now.`);
      process.exit(130);
    }
    shuttingDown = true;
    log(`${signal} received: stopping running agents…`);
    close().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error(err);
        process.exit(1);
      },
    );
  };

  for (const signal of signals) process.on(signal, onSignal);
  return () => {
    for (const signal of signals) process.off(signal, onSignal);
  };
}
