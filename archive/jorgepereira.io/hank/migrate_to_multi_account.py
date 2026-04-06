#!/usr/bin/env python3
"""Migrate Hank data from single-user layout to multi-account layout.

Current layout:
    data/memories/
    ├── 2026-04-05/
    │   ├── 2026-04-05T21-33-02_wifi-password.md
    │   └── ...
    └── index.json

New layout:
    data/
    ├── jorge/
    │   └── memories/
    │       ├── 2026-04-05/
    │       │   └── ...
    │       └── index.json
    ├── identities.json

Example usage:
    python migrate_to_multi_account.py --telegram-id 123456789 --email jorgeper@gmail.com
"""

import argparse
import json
import os
import shutil
import sys


def parse_args():
    parser = argparse.ArgumentParser(
        description="Migrate Hank data from single-user to multi-account layout."
    )
    parser.add_argument(
        "--identity-id",
        default="jorge",
        help="Identity ID for the user directory (default: jorge)",
    )
    parser.add_argument(
        "--identity-name",
        default="Jorge",
        help="Display name for the identity (default: Jorge)",
    )
    parser.add_argument(
        "--telegram-id",
        required=True,
        help="Telegram user ID (required)",
    )
    parser.add_argument(
        "--email",
        action="append",
        required=True,
        help="Email address (required, can be specified multiple times)",
    )
    parser.add_argument(
        "--data-dir",
        default="data",
        help="Path to the data directory (default: data)",
    )
    parser.add_argument(
        "--memories-dir",
        default="data/memories",
        help="Path to the current memories directory (default: data/memories)",
    )
    return parser.parse_args()


def create_identities_json(data_dir, identity_id, identity_name, telegram_id, emails):
    """Create data/identities.json with a single identity entry."""
    identities_path = os.path.join(data_dir, "identities.json")

    if os.path.exists(identities_path):
        print(f"  WARNING: {identities_path} already exists, overwriting")

    identities = [
        {
            "id": identity_id,
            "name": identity_name,
            "telegram_ids": [int(telegram_id)],
            "emails": emails,
        }
    ]

    os.makedirs(data_dir, exist_ok=True)
    with open(identities_path, "w") as f:
        json.dump(identities, f, indent=2)
        f.write("\n")

    print(f"  Created {identities_path}")
    return identities_path


def move_memories(memories_dir, target_memories_dir):
    """Move contents of memories_dir into target_memories_dir.

    Moves date directories and index.json. Does NOT delete the source
    directory itself.
    """
    if not os.path.isdir(memories_dir):
        print(f"  ERROR: Source directory {memories_dir} does not exist")
        sys.exit(1)

    os.makedirs(target_memories_dir, exist_ok=True)

    entries = os.listdir(memories_dir)
    if not entries:
        print(f"  WARNING: Source directory {memories_dir} is empty, nothing to move")
        return

    for entry in sorted(entries):
        src = os.path.join(memories_dir, entry)
        dst = os.path.join(target_memories_dir, entry)

        if os.path.exists(dst):
            print(f"  WARNING: {dst} already exists, skipping {entry}")
            continue

        shutil.move(src, dst)
        print(f"  Moved {src} -> {dst}")


def update_index_filepaths(target_memories_dir, old_memories_dir, identity_id):
    """Update filepath entries in index.json to reflect the new location.

    Rewrites paths like 'data/memories/2026-04-05/file.md' to
    'data/{identity_id}/memories/2026-04-05/file.md'.
    """
    index_path = os.path.join(target_memories_dir, "index.json")
    if not os.path.exists(index_path):
        print(f"  WARNING: No index.json found at {index_path}, skipping path update")
        return

    with open(index_path, "r") as f:
        entries = json.load(f)

    # Normalize the old prefix for replacement
    # e.g. "data/memories/" -> "data/jorge/memories/"
    old_prefix = old_memories_dir.rstrip("/") + "/"
    new_prefix = target_memories_dir.rstrip("/") + "/"

    updated = 0
    for entry in entries:
        if "filepath" in entry and entry["filepath"].startswith(old_prefix):
            entry["filepath"] = entry["filepath"].replace(old_prefix, new_prefix, 1)
            updated += 1

    with open(index_path, "w") as f:
        json.dump(entries, f, indent=2)
        f.write("\n")

    print(f"  Updated {updated} filepath(s) in {index_path}")


def main():
    args = parse_args()

    data_dir = args.data_dir
    memories_dir = args.memories_dir
    identity_id = args.identity_id
    target_memories_dir = os.path.join(data_dir, identity_id, "memories")

    print(f"Migrating to multi-account layout")
    print(f"  Identity:    {identity_id} ({args.identity_name})")
    print(f"  Telegram ID: {args.telegram_id}")
    print(f"  Email(s):    {', '.join(args.email)}")
    print(f"  Source:      {memories_dir}")
    print(f"  Target:      {target_memories_dir}")
    print()

    # Idempotency check
    if os.path.isdir(target_memories_dir) and os.listdir(target_memories_dir):
        print(
            f"WARNING: Target directory {target_memories_dir} already exists and is "
            f"not empty. Migration may have already been run. Skipping."
        )
        sys.exit(0)

    # Step 1: Create identities.json
    print("Step 1: Creating identities.json")
    create_identities_json(
        data_dir, identity_id, args.identity_name, args.telegram_id, args.email
    )
    print()

    # Step 2: Move memory contents
    print(f"Step 2: Moving memories from {memories_dir} to {target_memories_dir}")
    move_memories(memories_dir, target_memories_dir)
    print()

    # Step 3: Update filepaths in index.json
    print("Step 3: Updating filepaths in index.json")
    update_index_filepaths(target_memories_dir, memories_dir, identity_id)
    print()

    print("Migration complete.")
    print(f"  Note: The original {memories_dir}/ directory was left in place (now empty).")
    print(f"  You can remove it manually: rm -rf {memories_dir}")


if __name__ == "__main__":
    main()
