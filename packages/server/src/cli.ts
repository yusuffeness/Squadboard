/**
 * `squadboard` command: starts the local server, prints the URL (with the session token in the
 * fragment) and opens the browser. Ctrl+C stops every running agent before exiting.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DEFAULT_PORT, DEFAULT_WEB_DIR, startServer } from './server.js';
import { installShutdownHandlers } from './shutdown.js';

const HELP = `Usage: squadboard [--port <n>] [--no-open]

  --port <n>   Port on 127.0.0.1 (default ${DEFAULT_PORT}, or SQUADBOARD_PORT)
  --no-open    Do not open the browser
  -h, --help   Show this help

Data: ~/.squadboard/squadboard.db (override with SQUADBOARD_DB)`;

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    'no-open': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const port = Number(values.port ?? process.env.SQUADBOARD_PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  console.error(`Invalid port: ${String(values.port)}`);
  process.exit(2);
}

let server;
try {
  server = await startServer({ port });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Is Squadboard already running? Try --port.`);
  } else {
    console.error(err);
  }
  process.exit(1);
}

installShutdownHandlers(server.close);

console.log(`
  Squadboard is running.

  Open: ${server.url}

  The link contains a one-time key for this session; anyone with it can control your agents.
  Press Ctrl+C to stop (running agents are stopped too).
`);
if (!existsSync(DEFAULT_WEB_DIR)) {
  console.warn('  The web UI is not built yet. Run `pnpm build` first.\n');
}
if (!values['no-open'] && !process.env.SQUADBOARD_NO_OPEN) openBrowser(server.url);

function openBrowser(url: string): void {
  // `start` is a cmd built-in; the empty "" is the window title. The token is base64url,
  // so the URL contains no characters cmd would interpret.
  const [command, args, verbatim] =
    process.platform === 'win32'
      ? ['cmd', ['/c', `start "" "${url}"`], true]
      : process.platform === 'darwin'
        ? ['open', [url], false]
        : ['xdg-open', [url], false];
  try {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
    });
    child.on('error', () => console.log('  (Could not open the browser; open the link above.)'));
    child.unref();
  } catch {
    console.log('  (Could not open the browser; open the link above.)');
  }
}
