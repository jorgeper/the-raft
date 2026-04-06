"""Identity model and registry for multi-account support."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class Identity:
    id: str
    name: str
    telegram_ids: list[int] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)

    @property
    def memories_dir(self) -> str:
        """Return the per-identity memories directory: data/{id}/memories."""
        base = os.environ.get("DATA_DIR", "data")
        return os.path.join(base, self.id, "memories")


class IdentityRegistry:
    def __init__(self, identities: list[Identity] | None = None):
        self._identities: list[Identity] = identities or []
        self._by_telegram_id: dict[int, Identity] = {}
        self._by_email: dict[str, Identity] = {}
        self._build_lookups()

    def _build_lookups(self) -> None:
        for identity in self._identities:
            for tid in identity.telegram_ids:
                self._by_telegram_id[tid] = identity
            for email in identity.emails:
                self._by_email[email.lower()] = identity

    def resolve_telegram(self, user_id: int) -> Identity | None:
        return self._by_telegram_id.get(user_id)

    def resolve_email(self, email: str) -> Identity | None:
        return self._by_email.get(email.lower())

    def resolve_web_email(self, email: str) -> Identity | None:
        return self.resolve_email(email)


def load_registry(path: str | None = None) -> IdentityRegistry:
    if path is None:
        path = os.environ.get("IDENTITIES_FILE", "data/identities.json")

    try:
        with open(path) as f:
            raw = json.load(f)
    except FileNotFoundError:
        logger.warning("Identities file not found: %s — all lookups will return None", path)
        return IdentityRegistry()
    except json.JSONDecodeError:
        logger.warning("Identities file is not valid JSON: %s", path)
        return IdentityRegistry()

    identities = [
        Identity(
            id=entry["id"],
            name=entry["name"],
            telegram_ids=entry.get("telegram_ids", []),
            emails=entry.get("emails", []),
        )
        for entry in raw
    ]
    return IdentityRegistry(identities)
