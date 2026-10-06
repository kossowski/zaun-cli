# zaun.zsh: the shell setup zaun ships. Sourced from the zaun block in ~/.zshrc.
#
# Everything here is guarded: a tool that isn't installed is simply skipped,
# so this file never breaks your shell. Put your own settings in ~/.zshrc,
# outside the zaun block (this file is overwritten when zaun updates).

# --- Terminal type ------------------------------------------------------------
# Newer terminals (Ghostty, kitty, ...) send their own $TERM, and an SSH/orb
# session passes it on. Ubuntu 24.04 and Debian 12 don't know xterm-ghostty, so
# `clear`, less and vim fail with "unknown terminal type". Fall back to a type
# every machine has. For full support, copy the entry instead (on your Mac):
#   infocmp -x xterm-ghostty | ssh <machine>@orb -- tic -x -
if [[ -n "$TERM" ]] && ! infocmp "$TERM" &>/dev/null; then
  export TERM=xterm-256color
fi

# --- PATH ---------------------------------------------------------------------
# `typeset -U` keeps PATH free of duplicates, even if this file is sourced twice.
typeset -U path PATH
# ~/.local/bin: zaun, starship, uv, uv's Pythons, claude, ... live here.
path=("$HOME/.local/bin" $path)

# --- Node.js via fnm ----------------------------------------------------------
# fnm switches Node versions; --use-on-cd picks up .node-version / .nvmrc
# files automatically when you cd into a project.
export FNM_DIR="${FNM_DIR:-$HOME/.local/share/fnm}"
[[ -x "$FNM_DIR/fnm" ]] && path=("$FNM_DIR" $path)
if (( $+commands[fnm] )); then
  eval "$(fnm env --use-on-cd --shell zsh)"
fi

# --- History ------------------------------------------------------------------
HISTFILE="${HISTFILE:-$HOME/.zsh_history}"
HISTSIZE=50000
SAVEHIST=50000
setopt EXTENDED_HISTORY       # store timestamps
setopt SHARE_HISTORY          # share history between open terminals
setopt HIST_IGNORE_ALL_DUPS   # keep only the newest copy of a repeated command
setopt HIST_IGNORE_SPACE      # a command starting with a space isn't saved (secrets!)
setopt HIST_REDUCE_BLANKS

# --- Completion ---------------------------------------------------------------
# Only initialise if nothing else (e.g. oh-my-zsh) did it already.
if (( ! $+functions[compdef] )); then
  autoload -Uz compinit && compinit
fi
zstyle ':completion:*' menu select                      # arrow keys in the menu
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'  # case-insensitive

# --- Small conveniences ---------------------------------------------------------
setopt AUTO_CD                # type a directory name to cd into it
setopt INTERACTIVE_COMMENTS   # allow `# comments` on the command line
bindkey -e                    # emacs keys: Ctrl-A / Ctrl-E / Ctrl-R
# Colours for ls (folders blue, links cyan, executables green, ...), like
# the stock ~/.bashrc does for bash. dircolors sets LS_COLORS; the completion
# menu uses the same colours.
if (( $+commands[dircolors] )); then
  eval "$(dircolors -b)"
  zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
fi
alias ls='ls --color=auto'
alias ll='ls -lah'
alias la='ls -A'

# --- Editor -----------------------------------------------------------------------
# Neovim for git commit messages, `crontab -e`, ... unless you chose another one.
if (( $+commands[nvim] )) && [[ -z "$EDITOR" ]]; then
  export EDITOR=nvim VISUAL=nvim
fi

# --- Prompt -----------------------------------------------------------------------
# starship reads ~/.config/starship.toml (zaun links it to config/starship/starship.toml).
if (( $+commands[starship] )) && [[ "$TERM" != dumb ]]; then
  eval "$(starship init zsh)"
fi

# --- Plugins ----------------------------------------------------------------------
# From the distro's packages (installed by the shell module). Each adds a few ms to
# the shell start. Limits keep long lines and big pastes snappy.
ZSH_AUTOSUGGEST_BUFFER_MAX_SIZE=200   # no suggestions for longer lines
ZSH_HIGHLIGHT_MAXLENGTH=1000          # no highlighting for longer lines
# `if`, not `&&`: a missing plugin must not leave a failed status behind
# (starship would show the first prompt in red).
if [[ -r /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]]; then
  source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
fi
# Must be sourced last: it wraps every widget defined before it.
if [[ -r /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]]; then
  source /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
fi
