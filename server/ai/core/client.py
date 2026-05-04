"""
AI Refinery client lifecycle management.
Handles project creation/refresh based on config.yaml hash.
"""
import hashlib
import os
from pathlib import Path

from dotenv import load_dotenv
from air import AsyncAIRefinery

load_dotenv()

PROJECT_NAME = "enrollment_intelligence"
CONFIG_PATH = (Path(__file__).resolve().parent.parent / "config.yaml").resolve()
_HASH_CACHE = Path(__file__).resolve().parent.parent / ".enrollment_intelligence_project_version"


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _ensure_project(client: AsyncAIRefinery) -> None:
    """
    Create/refresh the Distiller project only when config.yaml changes.
    """
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config file not found: {CONFIG_PATH}")

    new_hash = _sha256_file(CONFIG_PATH)
    old_hash = _HASH_CACHE.read_text().strip() if _HASH_CACHE.exists() else ""

    if new_hash != old_hash:
        is_valid = client.distiller.validate_config(config_path=str(CONFIG_PATH))
        if not is_valid:
            raise ValueError(f"AI Refinery rejected config: {CONFIG_PATH}")

        client.distiller.create_project(
            config_path=str(CONFIG_PATH),
            project=PROJECT_NAME,
        )
        _HASH_CACHE.write_text(new_hash)


def create_client() -> AsyncAIRefinery:
    api_key = (
        os.getenv("AI_REFINERY_KEY")
        or os.getenv("AI_REFINERY_API_KEY")
        or os.getenv("API_KEY")
    )
    if not api_key:
        raise RuntimeError("Missing AI_REFINERY_KEY / AI_REFINERY_API_KEY / API_KEY")

    client = AsyncAIRefinery(api_key=api_key)
    _ensure_project(client)
    return client
