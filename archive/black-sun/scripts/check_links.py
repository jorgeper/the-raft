#!/usr/bin/env python3
"""Link integrity for the docs: every relative markdown link under docs/ (plus the
root README's links) must resolve to an existing file. Exit 0 = all good."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def targets(md: Path) -> list[str]:
    return LINK_RE.findall(md.read_text())


def check(md: Path) -> list[str]:
    errors = []
    for raw in targets(md):
        target = raw.split()[0].strip()  # drop titles: [x](path "title")
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        path = target.split("#", 1)[0]  # drop anchors
        if not path:
            continue
        resolved = (md.parent / path).resolve()
        if not resolved.exists():
            errors.append(f"{md.relative_to(ROOT)}: broken link -> {target}")
    return errors


def main() -> int:
    files = sorted((ROOT / "docs").rglob("*.md")) + [ROOT / "README.md"]
    errors = [e for f in files if f.is_file() for e in check(f)]
    for e in errors:
        print(e, file=sys.stderr)
    print(f"check_links: {len(files)} files, {len(errors)} broken links")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
