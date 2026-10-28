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
- Pip runs with Claude Code's auto permission mode and can use your files, terminal and signed-in Chrome. Its rules are in `home/CLAUDE.md`.
