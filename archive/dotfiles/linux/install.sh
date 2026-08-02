#!/usr/bin/env bash
# =============================================================================
#  install.sh — set up this zsh/nvim environment on Debian/Ubuntu
#
#  Mirrors the macOS "fresh Mac" guide in ../README.md, adapted for apt.
#  Idempotent: safe to re-run. Backs up anything it would overwrite.
#
#  Usage:   ./install.sh
#  It will:
#    1. apt-install the base packages (needs sudo — you'll be prompted)
#    2. install starship + eza into ~/.local/bin (no sudo)
#    3. clone the three zsh plugins (no sudo)
#    4. create bat/fd shims for the Debian batcat/fdfind names
#    5. back up and symlink the dotfiles
#    6. offer to make zsh your default login shell (chsh — needs your password)
# =============================================================================
set -euo pipefail

# Repo root is the parent of this linux/ directory.
LINUX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$LINUX_DIR/.." && pwd)"
BACKUP_DIR="$HOME/dotfiles-backup-$(date +%Y%m%d-%H%M%S)"
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# --- 1. base packages via apt ------------------------------------------------
say "Installing base packages via apt (sudo required)…"
sudo apt-get update
sudo apt-get install -y zsh neovim fzf bat fd-find git curl

# --- 2. starship + eza into ~/.local/bin (no sudo) ---------------------------
if ! command -v starship >/dev/null 2>&1; then
  say "Installing starship into $LOCAL_BIN…"
  curl -fsSL https://starship.rs/install.sh | sh -s -- -b "$LOCAL_BIN" -y
fi

if ! command -v eza >/dev/null 2>&1 && [ ! -x "$LOCAL_BIN/eza" ]; then
  say "Installing eza into $LOCAL_BIN…"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/eza.tar.gz" \
    https://github.com/eza-community/eza/releases/latest/download/eza_x86_64-unknown-linux-gnu.tar.gz
  tar -xzf "$tmp/eza.tar.gz" -C "$tmp"
  install -m755 "$tmp/eza" "$LOCAL_BIN/eza"
  rm -rf "$tmp"
fi

# --- 3. zsh plugins (no sudo; OMZ core is NOT installed, only the plugins) ---
PLUGDIR="$HOME/.oh-my-zsh/custom/plugins"
mkdir -p "$PLUGDIR"
clone_plugin() {  # $1 = repo url, $2 = dest name
  if [ ! -d "$PLUGDIR/$2" ]; then
    say "Cloning $2…"
    git clone --depth=1 "$1" "$PLUGDIR/$2"
  fi
}
clone_plugin https://github.com/zsh-users/zsh-autosuggestions        zsh-autosuggestions
clone_plugin https://github.com/zsh-users/zsh-syntax-highlighting    zsh-syntax-highlighting
clone_plugin https://github.com/zsh-users/zsh-history-substring-search zsh-history-substring-search

# --- 4. bat/fd shims for Debian's batcat/fdfind names ------------------------
[ -x /usr/bin/batcat ] && ln -sf /usr/bin/batcat "$LOCAL_BIN/bat"
[ -x /usr/bin/fdfind ] && ln -sf /usr/bin/fdfind "$LOCAL_BIN/fd"

# --- 5. back up + symlink dotfiles -------------------------------------------
link() {  # $1 = source in repo, $2 = target in $HOME
  local src="$1" dst="$2"
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "${dst#$HOME/}")"
    mv "$dst" "$BACKUP_DIR/${dst#$HOME/}"
    say "Backed up $dst -> $BACKUP_DIR/${dst#$HOME/}"
  fi
  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  say "Linked $dst -> $src"
}
link "$LINUX_DIR/zshrc"                       "$HOME/.zshrc"
link "$LINUX_DIR/zprofile"                    "$HOME/.zprofile"
link "$REPO_DIR/gitignore_global"             "$HOME/.config/git/ignore"
link "$REPO_DIR/nvim/init.lua"                "$HOME/.config/nvim/init.lua"
link "$REPO_DIR/nvim/lua/config/lazy.lua"     "$HOME/.config/nvim/lua/config/lazy.lua"

# --- 6. default shell --------------------------------------------------------
if [ "$(basename "${SHELL:-}")" != "zsh" ]; then
  say "To make zsh your default login shell, run:  chsh -s \"\$(command -v zsh)\""
fi

say "Done. Start a new zsh with:  exec zsh"
