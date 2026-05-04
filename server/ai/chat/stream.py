"""
Main streaming entry point for the HealthEnroll AI chat assistant.
"""
import asyncio
import json
import re
from typing import AsyncGenerator, Dict, List

from dotenv import load_dotenv
from air import AsyncAIRefinery

from .helpers import _get_api_key, _build_messages
from .tools import TOOLS
from .tool_executor import _execute_tool
from ..workflows.enrollment_pipeline import run_batch_streaming

load_dotenv()


async def stream_chat_response(
    history: List[Dict[str, str]],
    system_context: str = "",
) -> AsyncGenerator[str, None]:
    """
    Agentic tool-calling loop:
      1. Send messages + tools to LLM
      2. LLM calls a tool → await execution → append result → loop
      3. LLM produces final text → stream as SSE
    """
    def send_event(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    api_key = _get_api_key()
    if not api_key:
        yield send_event({
            "type": "response",
            "message": (
                "⚠️ The AI assistant is not configured yet.\n\n"
                "The `AI_REFINERY_KEY` environment variable is missing. "
                "Please add it to your `.env` file and restart the server.\n\n"
                "Once configured, I'll be able to answer questions about your enrollment pipeline, "
                "check EDI files, validate members, create batches, and more."
            ),
            "suggestions": [{"text": "Show system status", "action": "status"}],
        })
        yield send_event({"type": "done"})
        return

    client = AsyncAIRefinery(api_key=api_key)
    messages = _build_messages(history, system_context)

    yield send_event({"type": "thinking", "message": "Received your message — understanding your request..."})

    # Tool name → human-friendly label
    _tool_labels = {
        "get_system_status": "checking system status",
        "check_edi_structure": "scanning EDI files",
        "run_business_validation": "validating members",
        "create_batch": "creating a batch",
        "process_batch": "running enrollment pipeline",
        "get_batch_result": "checking batch result",
        "get_clarifications": "fetching clarifications",
        "get_enrolled_members": "looking up enrolled members",
        "analyze_member": "analyzing member record",
        "get_subscriber_details": "loading member details",
        "retry_failed_members": "re-queuing failed members",
        "reprocess_in_review": "reprocessing in-review members",
    }

    try:
        for round_num in range(8):
            yield send_event({
                "type": "thinking",
                "message": "Deciding what action to take..." if round_num == 0 else "Reviewing results and deciding next step...",
            })

            response = await client.chat.completions.create(
                messages=messages,
                model="openai/gpt-oss-120b",
                tools=TOOLS,
                tool_choice="auto",
                temperature=0.3,
                max_completion_tokens=1024,
            )

            choice = response.choices[0]
            msg = choice.message

            # ── Announce what the LLM decided ───────────────────────────────
            if choice.finish_reason == "tool_calls" and msg.tool_calls:
                tool_names = [tc.function.name for tc in msg.tool_calls]
                tool_label = " + ".join(_tool_labels.get(t, t.replace("_", " ")) for t in tool_names)
                yield send_event({"type": "thinking", "message": f"Action: {tool_label}"})
            else:
                yield send_event({"type": "thinking", "message": "Preparing response..."})

            # ---- Tool call round ----
            if choice.finish_reason == "tool_calls" and msg.tool_calls:
                messages.append({
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                        }
                        for tc in msg.tool_calls
                    ],
                })

                for tc in msg.tool_calls:
                    tool_name = tc.function.name
                    try:
                        tool_args = json.loads(tc.function.arguments or "{}")
                    except Exception:
                        tool_args = {}

                    # Pre-execution thinking events
                    thinking_msg, exec_msg = _thinking_messages(tool_name, tool_args)
                    yield send_event({"type": "thinking", "message": thinking_msg})
                    yield send_event({"type": "thinking", "message": exec_msg})

                    tool_result = await _execute_tool(tool_name, tool_args)

                    # ---- Streaming batch drain ----
                    try:
                        sentinel_check = json.loads(tool_result)
                        if isinstance(sentinel_check, dict) and sentinel_check.get("status") == "streaming":
                            batch_id_stream = sentinel_check["batchId"]
                            members_stream = sentinel_check.pop("_members", [])
                            stream_queue: asyncio.Queue = asyncio.Queue()
                            asyncio.create_task(run_batch_streaming(batch_id_stream, members_stream, stream_queue))

                            stream_processed = 0
                            stream_failed = 0
                            while True:
                                event = await stream_queue.get()
                                if event is None:
                                    break
                                yield send_event(event)
                                if event.get("type") == "member_result":
                                    if event.get("status") == "Processing Failed":
                                        stream_failed += 1
                                    else:
                                        stream_processed += 1

                            yield send_event({
                                "type": "status_update",
                                "message": (
                                    f"✓ Enrollment complete — {stream_processed} enrolled"
                                    + (f", {stream_failed} failed" if stream_failed else "")
                                ),
                                "details": {
                                    "batchId": batch_id_stream,
                                    "processed": stream_processed,
                                    "failed": stream_failed,
                                },
                            })
                            tool_result = json.dumps({
                                "status": "completed",
                                "batchId": batch_id_stream,
                                "processed": stream_processed,
                                "failed": stream_failed,
                            })
                    except Exception:
                        pass  # not a streaming sentinel

                    # Status update event
                    try:
                        parsed = json.loads(tool_result)
                        if isinstance(parsed, dict) and "error" not in parsed and parsed.get("status") != "completed":
                            done_msg = _done_message(tool_name, parsed)
                            yield send_event({"type": "status_update", "message": done_msg, "details": parsed})
                        elif isinstance(parsed, dict) and "error" in parsed:
                            yield send_event({
                                "type": "thinking",
                                "message": f"⚠ {tool_name.replace('_', ' ')} returned error: {parsed['error']}",
                            })
                    except Exception:
                        pass

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_result,
                    })

                continue

            # ---- Final text response ----
            full_response = msg.content or ""
            yield send_event({"type": "thinking", "message": "Summarising results..."})
            suggestions = []
            response_text = full_response

            if "SUGGESTIONS:" in full_response:
                parts = full_response.rsplit("SUGGESTIONS:", 1)
                response_text = parts[0].strip()
                try:
                    raw_suggestions = json.loads(parts[1].strip())
                    suggestions = [
                        s for s in raw_suggestions
                        if isinstance(s, dict) and len(s.get("text", "").split()) <= 6
                    ]
                except Exception:
                    suggestions = []

            # Strip unsolicited "Next steps" / "Key take-aways" sections
            response_text = re.sub(
                r'\n+\*{0,2}(Next steps?|Key take-?aways?|What (this|you can do) next|Recommended actions?)\*{0,2}:?.*',
                "",
                response_text,
                flags=re.IGNORECASE | re.DOTALL,
            ).strip()

            # Auto-generate suggestions if LLM didn't provide good ones
            if not suggestions:
                last_tool = None
                for m in reversed(messages):
                    if m.get("role") == "assistant" and m.get("tool_calls"):
                        last_tool = m["tool_calls"][0]["function"]["name"]
                        break
                suggestions = _auto_suggestions(last_tool)

            yield send_event({"type": "response", "message": response_text, "suggestions": suggestions})
            break

        else:
            yield send_event({
                "type": "response",
                "message": "Actions completed. See the status updates above for results.",
                "suggestions": [{"text": "Show system status", "action": "status"}],
            })

    except Exception as e:
        error_msg = str(e)
        if "401" in error_msg or "unauthorized" in error_msg.lower() or "invalid" in error_msg.lower():
            user_msg = (
                "⚠️ Authentication failed with the AI service.\n\n"
                "Your `AI_REFINERY_KEY` appears to be invalid or expired. "
                "Please check your `.env` file and restart the server."
            )
        elif "429" in error_msg or "rate limit" in error_msg.lower():
            user_msg = "⚠️ Rate limit reached. Please wait a moment and try again."
        elif "connect" in error_msg.lower() or "timeout" in error_msg.lower():
            user_msg = "⚠️ Could not connect to the AI service. Please check your network and try again."
        else:
            user_msg = f"⚠️ An error occurred: {error_msg}"

        yield send_event({
            "type": "response",
            "message": user_msg,
            "suggestions": [{"text": "Show system status", "action": "status"}],
        })

    yield send_event({"type": "done"})


# ---------------------------------------------------------------------------
# PRIVATE HELPERS
# ---------------------------------------------------------------------------

def _thinking_messages(tool_name: str, tool_args: dict):
    """Returns (thinking_msg, exec_msg) for a given tool call."""
    if tool_name == "analyze_member":
        sid = tool_args.get("subscriber_id", "")
        return f"Looking up enrollment record for {sid}...", f"Running AI analysis for {sid}..."
    if tool_name == "process_batch":
        bid = tool_args.get("batch_id", "") or "pending batch"
        return f"Starting enrollment pipeline for {bid}...", "Processing members through the enrollment pipeline..."
    if tool_name == "get_subscriber_details":
        sid = tool_args.get("subscriber_id", "")
        return f"Loading member record for {sid}...", f"Fetching details for {sid}..."
    if tool_name == "get_system_status":
        return "Checking current system status...", "Counting members, batches, and files across all stages..."
    if tool_name == "check_edi_structure":
        return "Scanning EDI files for structural issues...", "Validating file format and segment structure..."
    if tool_name == "run_business_validation":
        return "Running business validation on pending members...", "Checking SSN, date of birth, address, and coverage rules..."
    if tool_name == "create_batch":
        return "Bundling ready members into a new batch...", "Grouping all Ready members for enrollment..."
    if tool_name == "get_clarifications":
        return "Fetching members that need attention...", "Loading members with outstanding validation issues..."
    if tool_name == "get_enrolled_members":
        date = tool_args.get("date", "")
        return f"Looking up enrolled members{' for ' + date if date else ''}...", "Querying enrollment records..."
    if tool_name == "retry_failed_members":
        return "Re-queuing failed members for retry...", "Resetting failed members back to Ready status..."
    if tool_name == "reprocess_in_review":
        sid = tool_args.get("subscriber_id", "")
        return (
            f"Re-running pipeline on {sid or 'all In Review members'}...",
            f"Sending {'member' if sid else 'In Review members'} back through enrollment...",
        )
    return f"Running {tool_name.replace('_', ' ')}...", f"Executing {tool_name.replace('_', ' ')}..."


def _done_message(tool_name: str, parsed: dict) -> str:
    """Returns a human-readable ✓ completion message for a tool result."""
    if tool_name == "get_system_status":
        enrolled = parsed.get("enrolled_oep_count", 0) + parsed.get("enrolled_sep_count", 0)
        return (
            f"✓ {enrolled} enrolled, {parsed.get('ready_count', 0)} ready, "
            f"{parsed.get('in_review_count', 0)} in review, "
            f"{parsed.get('awaiting_clarification_count', 0)} awaiting clarification"
        )
    if tool_name == "analyze_member":
        has_sep = parsed.get("sep") is not None
        return f"✓ {parsed.get('name', '')} — {parsed.get('status', '')}{', SEP detected' if has_sep else ''}"
    if tool_name == "get_clarifications":
        total = parsed.get("total", 0)
        return f"✓ {total} member{'s' if total != 1 else ''} need{'s' if total == 1 else ''} attention"
    if tool_name == "get_enrolled_members":
        total = parsed.get("total", 0)
        return f"✓ {total} enrolled member{'s' if total != 1 else ''} found"
    if tool_name == "create_batch":
        count = parsed.get("ready_count_batched", "?")
        return f"✓ Batch created — {count} member{'s' if count != 1 else ''} bundled"
    if tool_name == "check_edi_structure":
        return f"✓ EDI scan complete — {parsed.get('healthy', 0)} healthy, {parsed.get('issues', 0)} with issues"
    if tool_name == "run_business_validation":
        return f"✓ Validation complete — {parsed.get('validated', 0)} ready, {parsed.get('clarifications', 0)} need clarification"
    if tool_name == "get_subscriber_details":
        return f"✓ {parsed.get('name', '')} — {parsed.get('status', '')}"
    if tool_name == "retry_failed_members":
        requeued = parsed.get("requeued", 0)
        return f"✓ {requeued} member{'s' if requeued != 1 else ''} re-queued for retry"
    if tool_name == "reprocess_in_review":
        count = parsed.get("memberCount", "?")
        return f"✓ {count} in-review member{'s' if count != 1 else ''} sent back through pipeline"
    if tool_name == "get_batch_result":
        processed = parsed.get("processedCount") or parsed.get("processed", "?")
        failed = parsed.get("failedCount") or parsed.get("failed", 0)
        return f"✓ Batch {parsed.get('status', '')} — {processed} processed, {failed} failed"
    return f"✓ {tool_name.replace('_', ' ')} completed"


def _auto_suggestions(last_tool: str) -> list:
    """Returns fallback suggestions based on the last tool called."""
    suggestion_map = {
        "get_system_status": [
            {"text": "View clarifications", "action": "clarification"},
            {"text": "Create batch", "action": "batch"},
            {"text": "Check enrolled", "action": "status"},
        ],
        "get_clarifications": [
            {"text": "Run validation", "action": "business"},
            {"text": "Check status", "action": "status"},
        ],
        "check_edi_structure": [
            {"text": "Run validation", "action": "business"},
            {"text": "Check status", "action": "status"},
        ],
        "run_business_validation": [
            {"text": "Create batch", "action": "batch"},
            {"text": "View clarifications", "action": "clarification"},
        ],
        "create_batch": [
            {"text": "Process batch", "action": "process"},
            {"text": "Check status", "action": "status"},
        ],
        "process_batch": [
            {"text": "Check batch result", "action": "status"},
            {"text": "Check status", "action": "status"},
        ],
        "get_batch_result": [
            {"text": "Check status", "action": "status"},
            {"text": "View enrolled", "action": "status"},
        ],
        "get_enrolled_members": [
            {"text": "Check status", "action": "status"},
            {"text": "View clarifications", "action": "clarification"},
        ],
        "analyze_member": [
            {"text": "Reprocess member", "action": "process"},
            {"text": "Check status", "action": "status"},
        ],
        "get_subscriber_details": [
            {"text": "Analyze member", "action": "status"},
            {"text": "Check status", "action": "status"},
        ],
    }
    return suggestion_map.get(last_tool, [{"text": "Check status", "action": "status"}])[:3]
