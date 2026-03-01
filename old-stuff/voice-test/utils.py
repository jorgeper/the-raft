import logging
import sys
from rich.logging import RichHandler

def setup_logging(verbose=False):
    """Configure logging with rich output"""
    level = logging.DEBUG if verbose else logging.INFO
    
    logging.basicConfig(
        level=level,
        format="%(message)s",
        datefmt="[%X]",
        handlers=[RichHandler(rich_tracebacks=True)]
    )
    
    # Suppress Azure SDK logging unless verbose
    if not verbose:
        logging.getLogger('azure').setLevel(logging.WARNING)
        logging.getLogger('azure.core.pipeline.policies.http_logging_policy').setLevel(logging.WARNING)