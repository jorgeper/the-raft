# Linux dotfiles

The Debian/Ubuntu counterpart to the macOS setup in [`../README.md`](../README.md).
Same shell experience — [Starship](https://starship.rs/) prompt, vim keybindings,
`eza`/`bat`/`fd`/`fzf`, the same aliases and zsh plugins — but installed with
`apt` + user-local binaries instead of Homebrew, and with the macOS-only bits
(iTerm2, `/opt/homebrew`, Python.framework paths) removed.

## What's here

| File | Source | Description |
|---|---|---|
| `zshrc` | `~/.zshrc` | Zsh config, Linux-adapted (apt binary names, apt fzf paths, optional linuxbrew) |
| `zprofile` | `~/.zprofile` | Minimal login profile (`~/.local/bin` on PATH, optional linuxbrew) |
| `install.sh` | — | One-shot, idempotent installer (see below) |

The Neovim config (`../nvim/`) and global gitignore (`../gitignore_global`) are
platform-agnostic and shared with the macOS setup — the installer symlinks them
straight from the repo root.

## Quick start

```sh
cd dotfiles/linux
./install.sh
chsh -s "$(command -v zsh)"   # make zsh your default login shell
exec zsh                       # or just open a new terminal
```

`install.sh` is safe to re-run; it backs up anything it would overwrite to
`~/dotfiles-backup-<timestamp>/`.

## What the installer does

1. **apt** (needs sudo): `zsh neovim fzf bat fd-find git curl`
2. **~/.local/bin** (no sudo): downloads `starship` and `eza` binaries
3. **zsh plugins** (no sudo): clones `zsh-autosuggestions`,
   `zsh-syntax-highlighting`, `zsh-history-substring-search` into
   `~/.oh-my-zsh/custom/plugins/` (Oh My Zsh core is **not** installed — the
   `zshrc` sources these three plugins directly)
4. **shims**: symlinks `~/.local/bin/bat → /usr/bin/batcat` and
   `~/.local/bin/fd → /usr/bin/fdfind`, since Debian ships those tools under
   different binary names
5. **symlinks** the dotfiles into `$HOME` / `~/.config`

## Notes / differences from macOS

- **`bat` / `fd` naming.** On Debian/Ubuntu the packages install `batcat` and
  `fdfind`. The installer creates `bat`/`fd` shims in `~/.local/bin` so aliases
  and the fzf preview/command config work unchanged; `zshrc` also has an
  alias fallback if the shims are ever missing.
- **fzf keybindings.** fzf ≥0.48 provides `fzf --zsh`; older apt builds ship
  example scripts under `/usr/share/doc/fzf/examples/`. `zshrc` tries the former
  and falls back to the latter.
- **No Homebrew required.** If you ever install [Homebrew on Linux](https://docs.brew.sh/Homebrew-on-Linux),
  both `zshrc` and `zprofile` will pick it up automatically from
  `/home/linuxbrew/.linuxbrew`, but nothing here depends on it.
- **Neovim** auto-bootstraps lazy.nvim on first launch — just let it finish.
