# server/ai/agents — one file per agent; executor_dict auto-assembled via @register_agent

from .base import get_executor_dict

# OEP / SEP enrollment pipeline agents
from . import classifier        # noqa: F401  → EnrollmentClassifierAgent
from . import sep_inference     # noqa: F401  → SepInferenceAgent
from . import normal_enrollment # noqa: F401  → NormalEnrollmentAgent
from . import decision          # noqa: F401  → DecisionAgent
from . import evidence_check    # noqa: F401  → EvidenceCheckAgent
from . import router            # noqa: F401  → EnrollmentRouterAgent

# Renewal pipeline agent
from . import renewal_agent     # noqa: F401  → RenewalProcessorAgent

# Retro coverage pipeline agent
from . import retro_agent       # noqa: F401  → RetroEnrollmentOrchestratorAgent

__all__ = ["get_executor_dict"]
