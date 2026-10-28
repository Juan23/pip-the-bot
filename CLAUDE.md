# pip-the-bot

Pip is an always-on Claude Code agent for one Mac. README.md explains how it works. Pip's own instructions are `home/CLAUDE.md`; this file is for working on the code.

## This checkout is live

Pip runs from this folder. `~/bot` links to `bot`, `notify`, `worker` and `home/` here, and Bot.app runs `ui/server.ts` from here. So:

- Work in a worktree, never on the files in this folder.
- While developing, don't message Pip, run `bot`, `worker` or `notify` against `~/bot`, quit or open Bot.app, or change anything in `~/bot`. To try a script, give it a throwaway home: `BOT_HOME=$(mktemp -d) ./worker list`. Even then, `worker start` and `worker resume` run a real Claude session that reports to the server on port 7377, the live Pip: test those only with a copy of the code whose port you changed.
- A merged change reaches the live Pip only when Juan runs `git pull` here and reopens the app.

## Checks

Run these before every push:

- `zsh -n bot worker worker-guard notify install.sh`
- `bun build ui/server.ts stats.ts --target=bun --outdir "$(mktemp -d)"`
- `bun test`
- `swiftc -typecheck ui/mac/Bot.swift`, when it changed

## Issues

GitHub Issues on `Juan23/pip-the-bot`. See `docs/agents/issue-tracker.md`.
