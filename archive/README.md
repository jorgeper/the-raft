# Sandbox

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
