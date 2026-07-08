# The Deliverator Labs — build, extend, and fix a real app

Three hands-on labs, in order, at your keyboard. They assume you finished the
[README setup](README.md): the loop is running, labels exist, the spike issue
advanced to a design PR and parked.

- **Lab 1** drives the full journey — brief → design rounds → hands-off
  implementation → validated merge — to build a brand-new app.
- **Lab 2** adds a feature to it (the harder, more common case: changing
  existing code) and trains the most important review skill.
- **Lab 3** fixes a bug through the fast path, with a regression test.

**What you're building:** *Greetbook* — deliberately small but real: a landing
page at `/`, **Sign in with Google** (real OAuth 2.0 / OIDC), and minimal
storage — remember each user (Google `sub`, email, name) and show a
personalized `/me` page. Just enough surface — auth, storage, config, secrets,
sessions — to make the design phase worth arguing about, and still one
afternoon of work. **The point of the labs is the loop, not the app.**

---

## Lab 1 — Build a real app, design-first, end-to-end

### 1.1 File the app brief

A **brief** fixes the *what* (behavior, constraints) and leaves the *how* open —
enough freedom that the agent must make and defend choices, enough constraint
that it can't wander. Writing briefs like this is the actual human skill this
lab trains.

```bash
gh issue create --title "New app: Greetbook (landing + Google login + remember me)" --label "agent:ready" --body '
I want to build a small but real web app called **Greetbook**. This issue is a brief — I want a DESIGN.md first, and I expect to iterate on it before any code is written.

## What it should do
- A public landing page at `/` that greets visitors and has a "Sign in with Google" button.
- Real Google sign-in (OAuth 2.0 / OpenID Connect).
- After sign-in, remember the user: store their Google account id, email, and name.
- A `/me` page (login required) that shows the logged-in user their stored profile and how many times they have signed in.
- Log out at `/logout`.

## Constraints / preferences
- Python + Flask.
- Keep dependencies minimal and mainstream.
- Secrets (Google client id/secret, Flask secret key) via environment variables, never committed.
- You choose the storage (e.g. SQLite vs Postgres) — but justify the choice in DESIGN.md for an app this size.
- Tests must not call Google for real; mock the provider so CI stays hermetic.
- Include an inner loop (make targets) and assume CI runs lint + tests.

## What I want from you first
A DESIGN.md covering problem, goals/non-goals, chosen stack + justification, data model, the OAuth sequence, the route list, security considerations, testing strategy, deployment, and any open questions for me. Do NOT write app code yet — design first.
'
```

Notice the shape: *What it should do* pins behavior precisely (routes, the
login-count, logout). *Constraints* pins the non-negotiables — and they mirror
`AGENTS.md`, so agent and conventions can't drift apart. But storage, app
structure, and session handling are left open **on purpose**: the design phase
needs real decisions to make, or touch point 1 is theater. Your leverage is
highest right here, in what you choose to specify and what you choose to leave
open.

### 1.2 Touch point 1 — iterate on the design, then sign off

Let the loop run a pass (watch the log, or `tmux attach -t deliverator`). It
writes `DESIGN.md` on `agent/issue-<n>` and opens a **design PR**. Now do
design review the way you actually would — read it and push back:

```bash
gh pr view <DESIGN_PR> --web        # read DESIGN.md in "Files changed"

# leave feedback (the loop reads PR comments and issue comments alike)
gh pr comment <DESIGN_PR> --body "The data model keys users on email — use the Google 'sub' claim instead; emails can change. Please revise."
gh pr comment <DESIGN_PR> --body "Add a login_count to the data model and say where it increments in the auth flow."
gh pr comment <DESIGN_PR> --body "Testing strategy is vague — specify exactly how you mock Google in pytest so CI never hits the network."

# then tell the loop to redraft
gh issue edit <ISSUE> --add-label agent:design-draft --remove-label agent:needs-human
```

The agent folds your comments into the next draft and pushes to the *same*
design PR. Repeat as many rounds as you like — from the terminal or your phone
(tap **✏️ Request changes**, then `/say <issue#> use the sub claim, not email`).

**Spend 3–5 rounds here and don't feel slow.** A bug caught in `DESIGN.md`
costs a comment; the same bug after implementation costs a full re-run. A good
design after a couple of rounds has: a defended SQLite choice, a `users` table
keyed on `sub`, a numbered OAuth sequence, and a concrete mocking strategy.
When you're happy, sign off:

```bash
gh pr review <DESIGN_PR> --approve --body "Design LGTM — proceed to reviewers."
gh issue edit <ISSUE> --add-label agent:design-approved --remove-label agent:needs-human
```

That triggers the two design reviewers (feasibility + security, different model
families). Because the brief mentions login/OAuth, the
`oauth-security-checklist` skill loads for the security reviewer — it checks
the `state` parameter, secret handling, and cookie flags *systematically*, not
when the model happens to remember. They post critiques; **you arbitrate**:

- Real concern ("the OAuth sequence never mentions the `state` parameter") →
  back to `agent:design-draft` for one more round.
- Noise → proceed:

```bash
gh issue edit <ISSUE> --add-label agent:coding --remove-label agent:needs-human
```

### 1.3 Touch point 2 — hands-off: implement, self-validate, cross-review

Now **you do nothing.** Watch the comments roll in:

1. **Implement** — the headless coder reads `AGENTS.md` + `DESIGN.md` and
   builds the app (Flask factory, Authlib client, storage, templates, tests,
   Makefile, `pyproject.toml`) in the worktree — running
   `make lint && make test`, reading failures, fixing, repeating until green.
2. **Independent re-check** — the orchestrator re-runs the inner loop in the
   `--network none` container. Red? The issue stays in `agent:coding` with the
   log in the memo, and the next pass's coder starts from the actual error.
3. **PR opens** — CI runs on it automatically.
4. **Cross-review** — reviewer A audits the diff against every acceptance
   criterion in DESIGN.md; reviewer B hunts security issues.
5. Park at `agent:needs-human` — your turn (the issue label is the ping).

> **On the honesty of self-validation:** the coder validates against tests *it
> wrote*. Real signal, not proof — which is exactly why the Docker check, the
> independent reviewers, and touch point 3 exist. Resisting the urge to jump
> in during this phase is the discipline that lets one person run many loops.

### 1.4 One-time: real Google OAuth (~10 minutes)

You need a Google OAuth client so the app can do real sign-in. Google organizes
this under the **Google Auth Platform**; if a menu label differs, look for the
nearest equivalent.

1. **Google Cloud Console** → create (or pick) a project.
2. **Google Auth Platform → Branding**: app name + your email; user type
   **External**.
3. **Audience**: add your own account as a **test user**.
4. **Data Access**: scopes `openid`, `email`, `profile`.
5. **Clients → Create client** → type **Web application**.
6. **Authorized redirect URIs**: exactly the callback the design chose —
   commonly `http://localhost:5000/auth/callback`.
7. Copy the **Client ID** and **Client secret** into your local `.env`.

The mainstream library choice is **Authlib**
(`authlib.integrations.flask_client`) against Google's OpenID discovery
document; if the design proposes hand-rolling OAuth, push back at touch
point 1. Secrets stay in `.env` (git-ignored); the flow must use the `state`
parameter; session cookie `HttpOnly`, `Secure` in production. Missing any of
these is a legitimate bounce.

### 1.5 Touch point 3 — you review, validate, approve

The loop hands you a PR it believes is done: inner loop green, CI green, two
reviews attached. Your job is to *actually run it* — the one verification no
agent can do, because it needs real Google credentials:

```bash
gh pr checks <IMPL_PR>            # outer loop green?
gh pr view <IMPL_PR>              # read both agent reviews + the diff

gh pr checkout <IMPL_PR>
make install
cp .env.example .env              # add GOOGLE_CLIENT_ID/SECRET, FLASK_SECRET_KEY
make run                          # http://localhost:5000
```

Click through it: `/` shows the landing page → sign in via the real Google
consent screen → `/me` shows your name and a login count that increments →
`/logout` → `/me` now redirects. Then run the inner loop yourself so you trust
the tests:

```bash
make test && make lint
```

If it holds up, ship:

```bash
gh pr review <IMPL_PR> --approve --body "Ran it locally, Google login + /me work, tests pass. Shipping."
gh pr merge <IMPL_PR> --squash --delete-branch
gh issue edit <ISSUE> --add-label agent:done --remove-label agent:needs-human
```

Merging fires the `release` job. **If your local validation fails: don't fix it
yourself.** Comment the precise failure on the PR and bounce it back
(`--add-label agent:coding --remove-label agent:needs-human`). The failure
feeds the coder's next session through the memo. Practicing "return it with a
repro" instead of "quietly fix it" is the habit that makes the loop scale.

**Lab 1 complete** — you built a real app with live Google sign-in by
*steering*: a sharp brief, design pushback to sign-off, a hands-off middle, and
the one thing only you can do.

---

## Lab 2 — Add one feature

Exercise the loop on a **change to existing code**. Feature: a logged-in user
can save a short personal note that shows on `/me`. Lighter on design, heavier
on the code-review gate.

### 2.1 File the feature issue

```bash
gh issue create --title "Feature: let users save a personal note on /me" --label "agent:ready" --body '
Add a per-user note to Greetbook.

## What
- On `/me`, a logged-in user can type a short note and save it.
- The note persists across logins (stored against their user record).
- `/me` shows the current saved note.

## Requirements
- `POST /me/note` (login required) saves the note for the current user; redirect back to `/me`.
- Notes are max 280 characters; longer input is rejected with a clear message, not truncated silently.
- Empty note is allowed (clears the note).
- Extend the existing `users` storage with a `note` field — do not create a parallel store.
- Tests: saving a note, note persists on reload, 280-char boundary (280 ok, 281 rejected), login required (anonymous POST is rejected).
- Must not break existing routes. Keep the OAuth mocking approach from the existing tests.

## Design note
This is small — a short DESIGN.md update is fine, but I DO want to see how the note length limit and the "login required" check are handled before you implement.
'
```

This brief is deliberately much more constrained than Lab 1's — a change to
existing code needs guarding more than freedom. It forces reuse of the existing
data model, sets a boundary (280) reviewers can verify mechanically, and
demands the auth-required test. Those last two are **bait**: you're about to
find out whether your reviewers actually check boundary-on-both-sides and
authorization — the two things most often done wrong in real apps.

### 2.2 A quick design pass, then the two traps

Skim the small design PR for two things: does it extend the existing `users`
row, and does it say *where* the login check happens (decorator vs inline)?
Approve and proceed as in Lab 1. At your review gate, check the traps:

1. **The 280 boundary** — tests must cover *both* sides: 280 accepted and 281
   rejected. One-sided boundary tests are the most common silent gap in a green
   suite.
2. **Login-required enforcement** — an anonymous `POST /me/note` is rejected,
   with a test proving it. An unauthenticated write is a real vulnerability,
   not a style nit.

If a reviewer rubber-stamps a missing case, that's the teachable moment —
**correct the memory, don't fix it yourself:**

```bash
gh issue comment <ISSUE> --body \
"Review gap: no test proves an anonymous POST /me/note is rejected. Coder: add that test and confirm the route enforces login before re-review."
gh issue edit <ISSUE> --add-label agent:coding --remove-label agent:needs-human
```

Your comment lands in the memo, so the coder's next session starts knowing
exactly what was missed — and the lesson persists in the issue's audit trail.
If the same *class* of gap keeps recurring, the fix moves up a layer: a line in
`AGENTS.md` ("every protected route ships with an anonymous-rejection test") or
an upgrade to the rubber-stamping reviewer's model — a `MODEL_<ROLE>` line in `.env`.
**Steering means editing the system, not the code.**

When both traps are covered and CI is green: checkout, run, save a note, try a
281-char note, then approve and merge as in Lab 1.

---

## Lab 3 — Fix one bug

Watch the loop triage, fix, and regression-test a bug. We plant one so the lab
is deterministic — an off-by-one in Lab 1's `login_count`.

### 3.1 Plant it (you, by hand)

```bash
git checkout -b plant-bug
# edit the OAuth callback: create new users with login_count = 0 and only
# increment on subsequent logins (first login shows 0 instead of 1)
git commit -am "oops: new users show login_count 0 on first login"
gh pr create --fill && gh pr merge --squash --delete-branch
```

(In real life you don't plant bugs — this stands in for a user reporting "it
says I've logged in 0 times.")

### 3.2 File an agent-friendly bug report

```bash
gh issue create --title "Bug: first-time users show login_count 0 on /me" --label "agent:trivial" --body '
## Observed
A brand-new user who signs in for the very first time sees `login count: 0` on `/me`.

## Expected
The first successful sign-in should count as 1. Nth sign-in shows N.

## Repro
1. Use a Google account that has never logged into this app before (or delete its row from the DB).
2. Sign in once.
3. Visit /me → it shows "login count: 0". It should show 1.

## Notes
Likely an off-by-one in where login_count is incremented in the OAuth callback. Add a regression test: first login yields count 1, second login yields count 2. Keep the OAuth provider mocked in tests.
'
```

Anatomy: Observed / Expected / Repro, plus an explicit ask for a regression
test with *exact values* (1, then 2) — the repro tells the coder how to
reproduce; the exact values let reviewer A verify the fix is real rather than
"tests are green." And note the label: **`agent:trivial`** routes it straight
to the coder, skipping the design phase — a full design round for a one-line
fix is waste. Judging which path an issue deserves is a steering decision
you'll make constantly.

### 3.3 Watch, then verify the red→green arc

- The coder should move the increment so it runs on *every* successful login
  and add the two-login regression test — which fails before the fix and passes
  after. A regression test that never failed proves nothing.
- Reviewer A must confirm the test asserts count `1` after the *first* login
  specifically. If it rubber-stamps a vaguer test: bounce, same move as Lab 2.

### 3.4 Confirm locally, ship

```bash
gh pr checkout <IMPL_PR> && make install
make run    # fresh sign-in → /me shows 1; sign out/in → 2
make test && make lint
gh pr review <IMPL_PR> --approve --body "First login counts as 1; regression test covers it."
gh pr merge <IMPL_PR> --squash --delete-branch
gh issue edit <ISSUE> --add-label agent:done --remove-label agent:needs-human
```

---

## What you've actually learned

- **Design is where steering has the highest leverage.** Bugs caught in the
  design PR cost a comment; after implementation, a full re-run.
- **Three touch points, only three.** Steer the design, stay hands-off through
  the middle, do the final review.
- **Your job is briefs and gates, not typing.** A sharp brief, good design
  pushback, an honest final review — including running the app for real, which
  no agent can do for you.
- **Verification is layered, and nothing certifies its own work.** The coder's
  inner loop, the Stop gate, the independent Docker check, CI, two independent
  tool-wielding reviewers, your hands.
- **Correct the system, not the code.** A rubber-stamped missing test means: a
  comment (it feeds the memo), a line in AGENTS.md, or a `MODEL_<ROLE>` upgrade
  in `.env`. The loop improves by editing its parts, not by you doing its job.

The loop is the product. Keep the leash exactly as long as your verifiers are
strong — and when in doubt, add a verifier, not autonomy.
