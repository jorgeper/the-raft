# archive

Personal project monorepo.

## Projects

### jorgepereira.io

Moved to its own repo: [github.com/jorgeper/jorgepereira.io](https://github.com/jorgeper/jorgepereira.io)
(history preserved via `git subtree split`).

### workout-app

```bash
cd workout-app
docker build -t workout-app .
docker run -d -p 3001:80 --name workout-app workout-app
```

Open http://localhost:3001

Or without Docker: `cd workout-app && python -m http.server 8000`

## Archived (moved out of GitHub into this repo)

Former standalone repos folded in with `git subtree add` on 2026-09-06 so the GitHub repos
could be deleted. History is preserved; nothing here is maintained.

- `black-sun/` — agent studio + big board (multi-runtime coding-agent orchestrator)
- `gargoyle/` — macOS menu-bar egress monitor and firewall
- `marky-mark-sandcastle/` — the Marky Mark fork used for the Sandcastle agent-PR experiments

## Moved to their own repos

- [disk-scout](https://github.com/jorgeper/disk-scout)
- [dotfiles](https://github.com/jorgeper/dotfiles)
- [jorgepereira.io](https://github.com/jorgeper/jorgepereira.io)
- [marky-mark](https://github.com/jorgeper/marky-mark)
- [yat-yat](https://github.com/jorgeper/yat-yat) (incubated here as `numshub/`)
