# Releasing Marky Mark

Releases are cut from a tag, built by `.github/workflows/release.yml` (SPEC10
§5), and land as a **draft** GitHub Release — nothing goes public until a
human smoke-tests the draft and flips it. Versions are strict semver and the
pre-release identifier (`0.2.0-alpha.1`) is **never stripped**; the version
lives in `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml`, and moves only via `npm run release:prepare`.

## Flow 1 — Claude Code

Tell Claude: *"cut release 0.2.0-alpha.2"*. Claude runs, in order:

```bash
cd ~/src/sandbox/marky-mark
npm run release:prepare -- 0.2.0-alpha.2   # bumps the 3 version files + lockfiles, commits
npm run validate                            # full gate must print VALIDATION: ALL PASSED
npm run licenses                            # regenerate THIRD-PARTY-NOTICES.md (commit if changed)
git tag -a marky-mark-v0.2.0-alpha.2 -m "Marky Mark 0.2.0-alpha.2"
```

The repo's guard hook blocks agent pushes, so Claude hands the pushes back to
you — run them yourself with the `!` prefix in the session (or in a shell):

```bash
! git push
! git push origin marky-mark-v0.2.0-alpha.2   # ← this starts the pipeline
```

Then watch, smoke-test, and publish exactly as in the manual flow below.

## Flow 2 — manual

```bash
# ---- cut ------------------------------------------------------------------
cd ~/src/sandbox/marky-mark
npm run release:prepare -- 0.2.0-alpha.2    # bump 3 version files + locks, commit
npm run validate                            # must end with VALIDATION: ALL PASSED
git push
git tag -a marky-mark-v0.2.0-alpha.2 -m "Marky Mark 0.2.0-alpha.2"
git push origin marky-mark-v0.2.0-alpha.2   # ← this starts the pipeline

# ---- watch ------------------------------------------------------------------
gh run list --workflow marky-mark-release.yml
gh run watch                                 # live-follows the latest run

# ---- smoke-test the draft ----------------------------------------------------
gh release view marky-mark-v0.2.0-alpha.2
gh release download marky-mark-v0.2.0-alpha.2 -D /tmp/mm-smoke
(cd /tmp/mm-smoke && shasum -c SHA256SUMS.txt)   # verify, then install & poke the app

# ---- publish (the only irreversible step) -------------------------------------
gh release edit marky-mark-v0.2.0-alpha.2 --draft=false --latest

# ---- other moves ---------------------------------------------------------------
gh workflow run marky-mark-release.yml -f version=0.2.0-alpha.2   # dry-run: draft prerelease, no tag
gh release delete marky-mark-v0.2.0-alpha.2 --yes                 # discard a draft/dry-run
git push origin :refs/tags/marky-mark-v0.2.0-alpha.2              # retract a bad tag
gh release list
```

Rules of thumb: the tag push is the trigger, the draft is the safety net, and
`--draft=false` is the only step that makes anything public. A failed run is
re-cut by fixing, deleting + re-pushing the tag, or `workflow_dispatch`.

## One-time activation in the monorepo

GitHub only executes workflows from the repository root. The canonical
workflow lives app-local at `marky-mark/.github/workflows/release.yml`; to
activate it in `jorgeper/sandbox`, copy it once (and re-copy after edits):

```bash
cd ~/src/sandbox
cp marky-mark/.github/workflows/release.yml .github/workflows/marky-mark-release.yml
git add .github/workflows/marky-mark-release.yml && git commit -m "ci: install marky-mark release workflow"
```

Out of scope for now (seams noted in SPEC10 §5.6): code signing /
notarization, the auto-updater, Linux packages, and hosted web deployment.
