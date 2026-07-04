"""Provision one budget-capped OpenRouter key per agent role. Run once; re-run
to adjust caps (it creates new keys — delete old ones in the dashboard).
Requires OPENROUTER_MANAGEMENT_KEY in .env
(create at openrouter.ai/settings/management-keys).

The cap is enforced on OpenRouter's servers: when a role's key hits its limit,
the "no" comes from the provider — no bug of yours can spend past it.

NOTE: Management API field names can shift — if a field is rejected, check
OpenRouter's current docs.
"""
import os
import json

import httpx
from dotenv import load_dotenv

load_dotenv()

MGMT = os.environ["OPENROUTER_MANAGEMENT_KEY"]
BASE = "https://openrouter.ai/api/v1/keys"

# Per-role caps (USD) and reset window. Tune to your appetite.
ROLE_BUDGETS = {
    "design":             {"limit": 2.0,  "limit_reset": "daily"},
    "review_feasibility": {"limit": 2.0,  "limit_reset": "daily"},
    "coder":              {"limit": 10.0, "limit_reset": "daily"},  # fallback coder only
    "review_correctness": {"limit": 2.0,  "limit_reset": "daily"},
    "review_security":    {"limit": 2.0,  "limit_reset": "daily"},
}


def provision():
    out = {}
    with httpx.Client(headers={"Authorization": f"Bearer {MGMT}"}, timeout=30) as c:
        for role, cfg in ROLE_BUDGETS.items():
            r = c.post(BASE, json={
                "name": f"agentic-loop:{role}",
                "limit": cfg["limit"],
                "limit_reset": cfg["limit_reset"],
            })
            r.raise_for_status()
            data = r.json()
            # the secret key material appears ONLY in this creation response
            out[role] = data.get("key") or data.get("data", {}).get("key")
    with open("role_keys.json", "w") as f:   # gitignored — never commit
        json.dump(out, f, indent=2)
    print(f"Wrote role_keys.json with {len(out)} capped keys.")


if __name__ == "__main__":
    provision()
