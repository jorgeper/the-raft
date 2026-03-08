ZSH_THEME="powerlevel10k/powerlevel10k"

export PATH="/opt/homebrew/bin:$PATH"

# ---- eza, better ls
alias ls='eza --icons'
alias ll='eza -lh --icons'
alias la='eza -la --icons'

# ---- Use vim keybindings
bindkey -v

eval "$(starship init zsh)"

# ---- PATH and Environment ----

export PATH="/opt/homebrew/bin:$PATH"
export EDITOR="nvim"  # or "code", "vim", etc.

# ---- Starship Prompt ----

eval "$(starship init zsh)"

# ---- FZF + FD + BAT ----

export FZF_DEFAULT_COMMAND='fd --type f'
export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
export FZF_ALT_C_COMMAND='fd --type d'

export FZF_DEFAULT_OPTS='
  --height 40%
  --layout=reverse
  --border
  --preview "bat --style=numbers --color=always --line-range :200 {}"
'

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

# ---- Aliases ----

alias cat="bat"
alias findf="fd"
alias f="fzf"
alias vf='nvim $(fzf)'  # fuzzy open file in nvim
alias cf='cd $(fd --type d | fzf)'  # fuzzy cd into dir
alias please='sudo'
alias ..='cd ..'


# ---- Oh My Zsh Plugins ----

ZSH_CUSTOM=${ZSH_CUSTOM:-~/.oh-my-zsh/custom}

# Autosuggestions
if [ -f $ZSH_CUSTOM/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh ]; then
  source $ZSH_CUSTOM/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
fi

# Syntax Highlighting (must be last)
if [ -f $ZSH_CUSTOM/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]; then
  source $ZSH_CUSTOM/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
fi

# Substring History Search
if [ -f $ZSH_CUSTOM/plugins/zsh-history-substring-search/zsh-history-substring-search.zsh ]; then
  source $ZSH_CUSTOM/plugins/zsh-history-substring-search/zsh-history-substring-search.zsh
fi

# Key Bindings for history search (↑ ↓ to move through matching history)
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down

# ---- Shell Options ----

setopt NO_CASE_GLOB
setopt CORRECT
setopt INC_APPEND_HISTORY SHARE_HISTORY

HISTFILE=~/.zsh_history
HISTSIZE=10000
SAVEHIST=10000

# The following lines have been added by Docker Desktop to enable Docker CLI completions.
fpath=(/Users/jorgepereira/.docker/completions $fpath)
autoload -Uz compinit
compinit
# End of Docker CLI completions


# Added by Agency Claude Code installer
export PATH="/Users/jorgepereira/.claude-cli/currentVersion:$PATH"

export PATH="${PATH}:/Users/jorgepereira/.azureauth/0.9.5"

export PATH="$HOME/.rbenv/bin:$PATH"
eval "$(rbenv init -)"
