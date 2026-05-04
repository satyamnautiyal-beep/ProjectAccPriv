"""
Backward-compatibility shim.
All real logic lives in the modular sub-packages.
Existing imports (server.routers.*, etc.) continue to work unchanged.
"""
import asyncio

# Core
from .core.client import create_client, PROJECT_NAME          # noqa: F401
from .core.distiller import (                                  # noqa: F401
    process_record,
    process_records_batch,
    mongo_update,
)
from .core.utils import _utc_now_z                            # noqa: F401

# Data layer
from .data.sanitizer import build_engine_input                # noqa: F401
from .data.views import (                                      # noqa: F401
    classification_view  as _classification_view,
    sep_inference_view   as _sep_inference_view,
    normal_flow_view     as _normal_flow_view,
    decision_view        as _decision_view,
)

# Agents
from .agents import get_executor_dict                         # noqa: F401
from .agents.classifier       import EnrollmentClassifierAgent  # noqa: F401
from .agents.sep_inference    import SepInferenceAgent          # noqa: F401
from .agents.normal_enrollment import NormalEnrollmentAgent     # noqa: F401
from .agents.decision         import DecisionAgent              # noqa: F401
from .agents.evidence_check   import EvidenceCheckAgent         # noqa: F401
from .agents.router           import EnrollmentRouterAgent      # noqa: F401

# executor_dict as a plain dict (legacy callers expect a dict, not a callable)
executor_dict = get_executor_dict()


def orchestrate_enrollment(record: dict) -> dict:
    """Sync wrapper for process_record. Used by FastAPI router endpoints."""
    return asyncio.run(process_record(record, persist=False))


# ---------------------------------------------------------------------------
# CLI entry point (unchanged)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import json
    import sys

    record = json.loads(sys.stdin.read())
    out = asyncio.run(process_record(record, persist=False))
    print(json.dumps(out, indent=2))
