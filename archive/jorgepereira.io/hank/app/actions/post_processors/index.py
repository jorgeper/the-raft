"""Index post-processor — adds/updates the memory in the search index after saving."""

import logging

from app.actions.remember import MemoryMetadata

logger = logging.getLogger(__name__)


async def update_index(filepath: str, metadata: MemoryMetadata) -> None:
    """Add or update this memory in the index."""
    from app.memory_index import add_to_index
    add_to_index(filepath)
