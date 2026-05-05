"""
Backward-compatibility shim.
All real logic lives in server/ai/chat/ and server/ai/workflows/.
Existing imports (server.routers.members, server.routers.batches, etc.) continue to work unchanged.
"""
from .chat.batch_jobs import _batch_jobs                                    # noqa: F401
from .chat.helpers import _extract_member_name, _build_sep_context          # noqa: F401
from .chat.stream import stream_chat_response                               # noqa: F401
from .workflows.enrollment_pipeline import (                                # noqa: F401
    run_batch_in_background  as _run_batch_in_background,
    run_batch_streaming      as _run_batch_streaming,
)
