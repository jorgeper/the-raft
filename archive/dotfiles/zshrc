# =============================================================================
#  ~/.zshrc — Jorge Pereira
#
#  Source of truth: ~/src/sandbox/dotfiles/zshrc  (this file)
#  ~/.zshrc is a symlink to it, so edits here take effect in new shells.
#
#  Layout:  PATH/env → prompt → editing → tools → aliases →
#           completions → plugins → history/options
# =============================================================================

# ---- PATH & core environment ------------------------------------------------
export PATH="/opt/homebrew/bin:$PATH"           # Homebrew (Apple Silicon)
export PATH="$HOME/.local/bin:$PATH"            # native Claude Code CLI + user-installed tools
export PATH="$HOME/.rbenv/bin:$PATH"            # rbenv shims (only used if rbenv is installed)
export PATH="${PATH}:$HOME/.azureauth/0.9.5"    # Azure CLI auth helper (if present)
export EDITOR="nvim"                            # default editor for git, etc.

# ---- Prompt: Starship -------------------------------------------------------
eval "$(starship init zsh)"

# ---- Editing: vi keybindings on the command line ----------------------------
bindkey -v

# ---- FZF fuzzy finder (backed by fd, previews via bat) ----------------------
export FZF_DEFAULT_COMMAND='fd --type f'
export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
export FZF_ALT_C_COMMAND='fd --type d'
export FZF_DEFAULT_OPTS='
  --height 40%
  --layout=reverse
  --border
  --preview "bat --style=numbers --color=always --line-range :200 {}"
'
# Sourcing fzf binds the interactive widgets: Ctrl-R history, Ctrl-T files, Alt-C cd.
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

# ---- Aliases ----------------------------------------------------------------
# eza — a modern `ls` with icons
alias ls='eza --icons'
alias ll='eza -lh --icons'
alias la='eza -la --icons'
# other tool swaps
alias cat='bat'                     # syntax-highlighted cat
alias findf='fd'                    # friendlier find
alias f='fzf'
alias vf='nvim $(fzf)'              # fuzzy-pick a file and open it in nvim
alias cf='cd $(fd --type d | fzf)'  # fuzzy-pick a directory and cd into it
alias please='sudo'
alias ..='cd ..'

# ---- Completions (compinit + Docker CLI) ------------------------------------
# Run compinit before plugins so completion widgets exist when they load.
fpath=($HOME/.docker/completions $fpath)   # Docker Desktop completions (if present)
autoload -Uz compinit
compinit

# ---- rbenv (Ruby version manager) -------------------------------------------
# Stays dormant until rbenv is actually installed, then activates automatically.
command -v rbenv >/dev/null 2>&1 && eval "$(rbenv init - zsh)"

# ---- Oh My Zsh plugins (sourced directly; OMZ core is NOT loaded) -----------
ZSH_CUSTOM=${ZSH_CUSTOM:-~/.oh-my-zsh/custom}

# Autosuggestions — fish-style inline suggestion from history as you type.
[ -f $ZSH_CUSTOM/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh ] && \
  source $ZSH_CUSTOM/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh

# Syntax highlighting — colours the command line. Must be sourced *before*
# history-substring-search (below), which wraps its widgets.
[ -f $ZSH_CUSTOM/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ] && \
  source $ZSH_CUSTOM/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

# Substring history search — type a fragment, then ↑/↓ to walk matching history.
[ -f $ZSH_CUSTOM/plugins/zsh-history-substring-search/zsh-history-substring-search.zsh ] && \
  source $ZSH_CUSTOM/plugins/zsh-history-substring-search/zsh-history-substring-search.zsh
bindkey '^[[A' history-substring-search-up      # ↑
bindkey '^[[B' history-substring-search-down    # ↓

# ---- History & shell options ------------------------------------------------
setopt NO_CASE_GLOB           # case-insensitive globbing
setopt CORRECT                # suggest corrections for mistyped commands
setopt INC_APPEND_HISTORY     # append each command to history as it runs
setopt SHARE_HISTORY          # share history live across all open shells

HISTFILE=~/.zsh_history
HISTSIZE=10000                # commands kept in memory per session
SAVEHIST=10000                # commands persisted to $HISTFILE
