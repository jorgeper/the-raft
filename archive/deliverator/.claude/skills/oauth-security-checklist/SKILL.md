---
name: oauth-security-checklist
description: Use when reviewing any code or design that implements OAuth login, session handling, or Google sign-in. Checks the state parameter, secret handling, session cookie flags, and login-required enforcement. Apply it whenever auth is in scope.
allowed-tools: Read, Grep
---

# OAuth security review checklist

Apply every item. For each, cite the file/line or mark it MISSING.

1. **State/CSRF** — the authorization request sends a `state` param and the callback verifies it. (Authlib does this automatically; flag any hand-rolled flow that skips it.)
2. **Secrets** — client id/secret and the app secret key come from env vars, never literals, never committed. No secrets in logs.
3. **Session cookies** — `HttpOnly` set; `Secure` in production; a sensible `SameSite`.
4. **Login-required** — protected routes (POST endpoints, /me) reject anonymous requests, and there is a test proving the rejection.
5. **Token/ID handling** — the ID token is validated; the user is keyed on the stable `sub` claim, not the email.

Output: `## Findings` (numbered, with file refs) then `## Verdict` (LGTM / CHANGES).
