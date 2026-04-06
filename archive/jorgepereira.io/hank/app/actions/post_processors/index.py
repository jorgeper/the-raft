"""Index post-processor — adds/updates the memory in the search index after saving."""

import logging

from app.actions.remember import MemoryMetadata

logger = logging.getLogger(__name__)


async def update_index(filepath: str, metadata: MemoryMetadata) -> None:
    """Add or update this memory in the index."""
    import os
    from app.memory_index import add_to_index
    # Derive memories_dir from filepath: data/jorge/memories/2026-04-05/file.md → data/jorge/memories
    memories_dir = os.path.dirname(os.path.dirname(filepath))
    add_to_index(filepath, memories_dir=memories_dir)
