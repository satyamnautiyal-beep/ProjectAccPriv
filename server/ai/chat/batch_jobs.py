"""
In-memory background batch job registry.
Shared between the chat tool executor and the workflow runners.
"""
from typing import Any, Dict

# Keyed by batch_id → job status dict
_batch_jobs: Dict[str, Dict[str, Any]] = {}
