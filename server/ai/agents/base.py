"""
Agent registration system.
Use @register_agent("AgentName") on any async function to add it to the executor dict.
The executor dict is assembled automatically from all registered agents.
"""
from typing import Callable, Dict

_REGISTRY: Dict[str, Callable] = {}


def register_agent(name: str) -> Callable:
    """Decorator that registers an agent function under the given name."""
    def decorator(fn: Callable) -> Callable:
        _REGISTRY[name] = fn
        return fn
    return decorator


def get_executor_dict() -> Dict[str, Callable]:
    """Returns a copy of the current agent registry."""
    return dict(_REGISTRY)
