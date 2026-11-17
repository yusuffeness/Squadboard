# Squadboard

> 🚧 **Under construction.** Nothing usable yet — the project is in its skeleton stage.

Squadboard is an open-source local web UI for running a small team of Claude Code agents on your own machine. You describe what you want, a planner splits it into tasks, agents (Frontend, Backend, Database, Test, Reviewer) each work on their own git branch, and **you approve the plan and every merge**.

It drives the official Claude Code CLI installed on your computer (`claude -p`), using your own login. Squadboard never sees or stores your credentials.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full technical design (Turkish).

## Development

Requirements: Node.js 20+, pnpm 10.

```bash
pnpm install
pnpm dev      # server on http://127.0.0.1:4317, web on http://127.0.0.1:5173
pnpm test
pnpm lint
pnpm build
```

## Repository layout

```
packages/
  core/     shared types and schemas
  server/   local Fastify server (127.0.0.1 only)
  web/      React + Vite + Tailwind UI
templates/  ready-made team templates
docs/       architecture and design notes
```

## License

[MIT](LICENSE)
