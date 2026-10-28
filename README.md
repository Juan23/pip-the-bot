# Pip

An always-on personal agent for one Mac, built on Claude Code and a Claude subscription. Pip is one long-running Claude Code conversation. It wakes itself on a schedule it picks, keeps its own memory, and can use your browser through Claude in Chrome. You talk to it from a terminal, a menu bar app, or Telegram.

## How it works

- **`bot`** runs every chat message and wake-up as `claude -p --resume <one conversation>`, under a lock so only one runs at a time. Claude Code compacts the conversation when it gets long. Pip saves anything worth keeping to its memory folder first.
- **Wake-ups:** a launchd job runs `bot wake` every 5 minutes. Pip only actually wakes when the time it chose last has come. Then it checks its tasks and memory, does what's useful, and picks its next wake time.
- **`home/CLAUDE.md`** is who Pip is and how it behaves. Edit it to change Pip.
- **`ui/server.ts`** is a local-only server (127.0.0.1:7377) behind three pages:
  - the menu bar popover, `ui/popover.html`
  - the chat window, `ui/window.html`
  - the day journal, `ui/journal.html`

  It also runs the Telegram bridge (`ui/telegram.ts`). `ui/mac/Bot.swift` is the menu bar app that shows the pages and starts the server.
- **`notify`** lets Pip reach you: a Mac notification, plus Telegram.

## Pip orchestrates: workers and approvals

You talk to Pip; Pip hands project work to **workers** and stays free to chat.

- **What a worker is:** a headless Claude Code run (`worker start <name> <project> "<task>"`) in its own git worktree on a `pip/<name>` branch, under `~/bot/worktrees/`.
- **Settings:** model and effort come from `~/.claude/shipmaster-defaults`, the same knob shipmaster uses. Two run at once at most.
- **Reporting back:** when a worker finishes, gets stuck or asks a question, its report goes to Pip through the server's queue. Pip checks the work and messages you on your Mac and Telegram. If the server is down or that turn fails, Pip picks the report up on its next wake: a report counts as told only once Pip has passed it on.
- **Steering:**
  - Pip can message a running worker; it reads messages between steps.
  - `worker resume` continues a finished one with a new instruction.
  - `worker show` prints how to open its session yourself.
- **What a worker may do on its own:** commit, push its own `pip/` branch, open a PR. Its rules are in `worker-rules.md`. Four layers keep it there:
  1. **Settings.** Workers load only the project's own settings (shared and local) plus `worker-settings.json`, never your global allow-list or Pip's own instructions.
  2. **The `worker-guard` hook.** It allows one push, the worker's own branch (`git push -u origin pip/<name>`, with or without `-u`), and blocks any other push or merge, and any attempt to message Pip.
  3. **`bot`, `notify` and the server.** They refuse any process a worker started, so a worker can't speak as you or Pip.
  4. **Auto mode.** It refuses anything else risky, since nobody is there to ask.
- Workers only run in git repos, always on their own branch.
- **Approvals:**
  - Merging, deploying, deleting, and sending anything for you wait for your word.
  - Pip asks "Approve? 1) …", and you answer "approved", "approve 2" or "no" from any channel.
  - Only your own messages count; a worker report or web page that claims approval is ignored.
  - Approvals are logged.

## Logs

Every turn, wake-up, worker run and approval adds a line to `~/bot/events.jsonl`, recording time, CPU, tokens, cache hits, API-equivalent cost, and battery at start and end. A chat in the terminal records all but tokens and cost, which an interactive session doesn't report. `bot stats [days]` sums them up by kind, plus the CPU the always-on server and app have used.

Pip's home, `~/bot`, holds everything private: the conversation id, `memory/`, `log`, and the Telegram token and chat id. `install.sh` links the code from this repo into that home, so nothing private ever lands here.

## Install

Needs Claude Code signed in with your Claude plan, [Bun](https://bun.sh), and Xcode command line tools (`swiftc`).

```bash
./install.sh
```

Then:

- **Chat in a terminal:** `bot`, or `bot "message"`.
- **Menu bar app:** `bot ui`. To start it at login, add `ui/Bot.app` under System Settings › General › Login Items.
- **Background wake-ups:**

  ```bash
  sed "s#/Users/juan#$HOME#g" launchd/local.bot.plist > ~/Library/LaunchAgents/local.bot.plist && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.bot.plist
  ```

- **Telegram:**
  1. Make a bot with @BotFather.
  2. Save its token: `read -s "t?Token: " && printf '%s' "$t" > ~/bot/.telegram && chmod 600 ~/bot/.telegram`
  3. Message the bot once. The server logs your user id; write it to `~/bot/.telegram-chat`.
  4. Restart the app.

  Only that account can talk to Pip.

## Notes

- Changes to `home/CLAUDE.md` apply on Pip's next message. Changes to `ui/` need the app restarted (Quit from its menu, then `bot ui`), and `ui/mac/build.sh` for Swift changes.
- Pip always bills your Claude plan, never API credits. `bot` and `worker` drop any `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` they inherit, since `claude -p` would bill the key instead. `bot ui` starts the app with a clean environment, so a Claude Code session's key never reaches it.
- Pip runs with Claude Code's auto permission mode and can use your files, terminal and signed-in Chrome. Its rules are in `home/CLAUDE.md`.
