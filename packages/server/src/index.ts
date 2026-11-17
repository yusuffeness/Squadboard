// Library entry. The `squadboard` command is src/cli.ts; development uses src/dev.ts.
export { buildApp, type AppOptions } from './app.js';
export { startServer, type RunningServer, type StartServerOptions } from './server.js';
export { openDatabase, defaultDbPath, type Db, type DbHandle } from './db/index.js';
export { Runner, type RunHandle, type RunOutcome } from './runner/runner.js';
export { resolveClaudeCommand, type ClaudeCommand } from './runner/claude-cli.js';
