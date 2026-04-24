"""
One-time script to ingest SEP_AGENT_SOP.md into the AI Refinery knowledge base.
Run this whenever the SOP is updated.

This version uses Azure AI Search (supported by AI Refinery SDK).
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from omegaconf import OmegaConf

from air.client import AIRefinery
from air.types import Document, TextElement, DocumentProcessingConfig


SOP_PATH = Path(__file__).parent / "SEP_AGENT_SOP.md"
INDEX_NAME = "sep-agent-sop"
CONFIG_PATH = Path(__file__).parent / "rag_sep_sop_knowledge.yaml"


def load_sop_as_documents() -> list[Document]:
    """
    Split SOP on H3 headings (### ...) so each SEP section is its own Document.
    """
    raw = SOP_PATH.read_text(encoding="utf-8")

    sections = []
    current = []

    for line in raw.splitlines(keepends=True):
        if line.startswith("### ") and current:
            sections.append("".join(current))
            current = [line]
        else:
            current.append(line)

    if current:
        sections.append("".join(current))

    docs: list[Document] = []
    for i, section_text in enumerate(sections):
        element = TextElement(text=section_text)
        doc = Document(
            elements=[element],
            metadata={
                "source": "SEP_AGENT_SOP",
                "section_index": i,
                "index": INDEX_NAME,
            },
        )
        docs.append(doc)

    return docs


def main():
    load_dotenv()

    # AI Refinery API key (pick one name and keep it consistent)
    api_key = os.getenv("API_KEY") or os.getenv("AI_REFINERY_KEY")
    if not api_key:
        raise RuntimeError("Set API_KEY (or AI_REFINERY_KEY) in your environment/.env")

    # Required for Azure AI Search backend
    if not os.getenv("AZURE_SEARCH_ENDPOINT") or not os.getenv("AZURE_SEARCH_KEY"):
        raise RuntimeError("Set AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY in your environment/.env")

    cfg = OmegaConf.load(str(CONFIG_PATH))
    doc_process_config = DocumentProcessingConfig(**cfg)  # type: ignore

    client = AIRefinery(api_key=api_key)
    document_processing = client.knowledge.document_processing

    # This is where your earlier KeyError was thrown (due to type="InMemory")
    document_processing.create_project(doc_process_config=doc_process_config)  # type: ignore

    documents = load_sop_as_documents()
    print(f"Ingesting {len(documents)} SOP sections into index '{INDEX_NAME}'...")

    status = document_processing.pipeline(documents, ["chunk", "embed", "upload"])
    print("✅ Ingestion complete.")
    print(f"Pipeline status: {status}")


if __name__ == "__main__":
    main()