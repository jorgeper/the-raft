---
name: design-doc
description: Use this whenever drafting or revising a DESIGN.md or architecture document for a new app or feature, before any implementation. Provides the required section structure and the ADR format for recording decisions. Use it every time design work happens, not just occasionally.
allowed-tools: Read, Write
---

# Writing a DESIGN.md

Produce a DESIGN.md with these sections, in order. Make real decisions and justify them.

## Required sections
1. **Problem** — what we're solving, in 2-4 sentences.
2. **Goals / Non-goals** — bullet lists. Non-goals prevent scope creep.
3. **Chosen stack** — name each choice AND one line of justification for THIS app's scale.
4. **Data model** — tables/fields with types. Note keys and why (e.g. user keyed on the stable OAuth `sub` claim, not email).
5. **Auth flow** — a numbered sequence of the actual request/response steps.
6. **API surface** — every route: method, path, request, response, status codes.
7. **Security considerations** — secrets handling, CSRF/state, session flags, authorization.
8. **Testing strategy** — how each area is tested; how external services are mocked so CI is hermetic.
9. **Deployment** — how it ships; what CI validates; what runs on release.
10. **Open questions for the human** — anything you had to assume; flag it here.

## Recording decisions (ADR-style)
For any non-obvious choice add a short block:
- **Decision:** what was chosen.
- **Context:** the forces at play.
- **Alternatives:** what was rejected and why.
- **Consequences:** trade-offs accepted.

## Rules
- Do NOT write application code in a design doc.
- Prefer boring, mainstream choices; justify anything exotic.
- Concrete enough that a competent engineer could implement without guessing.
