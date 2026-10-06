#!/usr/bin/env bash
# Claude Code status line.
#
# Claude Code runs this script after every message and pipes a JSON object
# describing the session into it (model, working directory, token usage, rate
# limits, ...). Whatever the script prints becomes the status line.
# Docs: https://code.claude.com/docs/en/statusline
#
# Output (colored):
#   my-project on  main via Opus 4.5 41.2k tokens · 5h 23% · 7d 61%
#   ^ directory   ^ git branch ^ model  ^ context     ^ rate limits (subscribers only)
#
# Wired up by zaun: ~/.claude/statusline.sh is a symlink to this file and
# ~/.claude/settings.json contains
#   "statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }
#
# Needs: jq, git, awk. The branch symbol (U+E0A0) needs a Nerd Font in your terminal.
#
# Try it without Claude Code:
#   echo '{"cwd":"/tmp","model":{"display_name":"Opus"}}' | ~/.claude/statusline.sh
#
# No `set -e` here on purpose: a status line should print what it can, not die
# because one field is missing.

input=$(cat)

# Read one field from the session JSON. `// empty` turns null/missing into "".
field() { jq -r "$1" <<<"$input"; }

# ANSI colors: bold cyan / magenta / yellow, plus plain red / yellow / green.
paint() { printf '\033[%sm%s\033[0m' "$1" "$2"; }

dir=$(field '.workspace.current_dir // .cwd')
model=$(field '.model.display_name // empty')

# --- Tokens currently in the context window ---------------------------------
# Newer Claude Code versions send context_window.total_input_tokens. It's 0
# before the first answer (and absent in old versions); then fall back to the
# usage of the last assistant message in the session transcript (a JSONL file).
tokens=$(field '.context_window.total_input_tokens // empty')
if [[ -z "$tokens" || "$tokens" == 0 ]]; then
  transcript=$(field '.transcript_path // empty')
  if [[ -n "$transcript" && -f "$transcript" ]]; then
    tokens=$(jq -rs '
      [.[] | select(.type == "assistant" and .message.usage)] | last | .message.usage
      | ((.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0))
    ' "$transcript" 2>/dev/null)
  fi
fi

# --- Rate limits (claude.ai Pro/Max only; each window may be missing) ---------
five_hour=$(field '.rate_limits.five_hour.used_percentage // empty | round')
seven_day=$(field '.rate_limits.seven_day.used_percentage // empty | round')

# Percentage colored by threshold: green < 50 ≤ yellow < 80 ≤ red.
percent() {
  local color=32
  if (( $1 >= 80 )); then color=31; elif (( $1 >= 50 )); then color=33; fi
  paint "$color" "$1%"
}

# --- Assemble the line ---------------------------------------------------------
out=$(paint '1;36' "$(basename "$dir")")

# Branch name, or the short commit hash on a detached HEAD. --no-optional-locks
# keeps git from taking index locks that could clash with git commands Claude runs.
branch=$(git --no-optional-locks -C "$dir" symbolic-ref --quiet --short HEAD 2>/dev/null \
  || git --no-optional-locks -C "$dir" rev-parse --short HEAD 2>/dev/null)
# \356\202\240 is U+E0A0, the Powerline/Nerd Font branch symbol, written as raw
# UTF-8 bytes so it works in any locale.
[[ -n "$branch" ]] && out+=" on $(paint '1;35' $'\356\202\240'" $branch")"

[[ -n "$model" ]] && out+=" via $(paint '1;33' "$model")"

if [[ -n "$tokens" && "$tokens" != null ]]; then
  # 41234 → 41.2k
  if (( tokens >= 1000 )); then
    tokens=$(awk -v n="$tokens" 'BEGIN { printf "%.1fk", n / 1000 }')
  fi
  out+=" $tokens tokens"
fi

[[ -n "$five_hour" ]] && out+=" · 5h $(percent "$five_hour")"
[[ -n "$seven_day" ]] && out+=" · 7d $(percent "$seven_day")"

printf '%s' "$out"
