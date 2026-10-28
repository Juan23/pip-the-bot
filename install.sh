#!/bin/zsh
# Sets up the bot's home (~/bot, or $BOT_HOME) to run from this repo, and builds the menu bar app. Safe to re-run.
# The home keeps everything private (conversation id, memory/, log, Telegram token); this repo only holds code.
set -e
code=${0:A:h}
home=${BOT_HOME:-$HOME/bot}
mkdir -p $home/.claude $home/memory

link() {  # link <file in home> <target in repo>, moving a real file out of the way first
  if [[ -e $home/$1 && ! -L $home/$1 ]]; then
    mkdir -p $home/.before-repo/${1:h}
    mv $home/$1 $home/.before-repo/$1
  fi
  ln -sfn $2 $home/$1
}
link CLAUDE.md $code/home/CLAUDE.md
link .claude/settings.json $code/home/.claude/settings.json
link bot $code/bot
link notify $code/notify
link worker $code/worker

mkdir -p ~/.local/bin && ln -sfn $home/bot ~/.local/bin/bot
$code/ui/mac/build.sh
print "Installed. Chat: bot · menu bar app: bot ui · background wake-ups and Telegram: see README.md"
