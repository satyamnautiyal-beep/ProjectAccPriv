# server/ai/agents — one file per agent; executor_dict auto-assembled via @register_agent
from .base import get_executor_dict

# Import all agents so their @register_agent decorators fire
from . import classifier        # noqa: F401
from . import sep_inference     # noqa: F401
from . import normal_enrollment # noqa: F401
from . import decision          # noqa: F401
from . import evidence_check    # noqa: F401
from . import router            # noqa: F401

__all__ = ["get_executor_dict"]
