"""
Tool definitions for the HealthEnroll AI chat assistant.
Add new tools here — the stream loop picks them up automatically.
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "check_edi_structure",
            "description": (
                "Validates all EDI 834 files currently on disk for structural integrity. "
                "Internally checks disk first — if no unchecked files exist it returns immediately "
                "with a clear message instead of running. Safe to call any time the user asks "
                "about new or unchecked EDI files. Healthy files are parsed and members ingested "
                "as 'Pending Business Validation'."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_business_validation",
            "description": (
                "Runs business-rule validation on members in 'Pending Business Validation' status only. "
                "Returns: validated = count that became Ready, clarifications = count that failed. "
                "Do NOT call if pending_business_validation_count is 0."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_batch",
            "description": (
                "Bundles all 'Ready' members into a new enrollment batch. "
                "Self-checks the ready count — if 0, returns a focused message saying nothing to batch "
                "and whether any failed members can be retried. "
                "Do NOT call get_system_status before or after this — the result is self-contained."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "process_batch",
            "description": (
                "Starts the AI enrollment pipeline on the batch that is 'Awaiting Approval' "
                "as a background job. Returns immediately with status 'started'. "
                "The pipeline runs in the background — use get_batch_result to check completion."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "batch_id": {
                        "type": "string",
                        "description": "Batch ID to process. Leave empty to auto-select the first pending batch.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_batch_result",
            "description": (
                "Checks the result of a background batch processing job started by process_batch. "
                "Returns status: 'running' (still in progress), 'completed' (with processed/failed counts), "
                "or 'failed' (with error). Always call this when the user asks about batch status or result."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "batch_id": {
                        "type": "string",
                        "description": "The batch ID to check. Use the last batch ID that was processed.",
                    }
                },
                "required": ["batch_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_system_status",
            "description": (
                "Returns current system metrics. Pass a 'query' describing what the user asked about "
                "so only the relevant data is returned. Examples: 'new edi files', "
                "'pending business validation', 'enrolled members', 'failed members', 'batch status'. "
                "Pass 'all' only when the user explicitly asks for full system status or overview."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "What the user is asking about. One of: 'edi_files', 'pending_validation', "
                            "'ready', 'clarifications', 'enrolled', 'in_review', 'failed', "
                            "'batches', 'all'. Defaults to 'all'."
                        ),
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_clarifications",
            "description": (
                "Returns the full list of members in 'Awaiting Clarification' status from BigQuery, "
                "including their subscriber ID, full name, and the exact validation issues "
                "(e.g. 'Missing SSN', 'Invalid DOB', 'Incomplete Address'). "
                "Always call this when the user asks: who needs attention, what are the issues, "
                "show me members needing clarification, what are the names of members with problems, etc."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_enrolled_members",
            "description": (
                "Queries BigQuery for enrolled members. Can filter by date and enrollment path. "
                "Use this when the user asks who was enrolled, how many enrolled today/yesterday, "
                "SEP vs OEP breakdowns, or any question about enrolled member details."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Filter by lastProcessedAt date. Format YYYY-MM-DD. Leave empty for all time.",
                    },
                    "enrollment_path": {
                        "type": "string",
                        "description": "Filter by 'OEP', 'SEP', or leave empty for both.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "retry_failed_members",
            "description": (
                "Re-queues all members with status 'Processing Failed' back to 'Ready' "
                "so they can be included in the next batch. Call this when the user wants "
                "to retry failed members. Returns count of members re-queued."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reprocess_in_review",
            "description": (
                "Re-runs the AI enrollment pipeline on members currently in 'In Review' status. "
                "Use this when the user wants to retry In Review members after evidence has been submitted "
                "or data issues have been resolved. Can target a specific subscriber_id or all In Review members. "
                "Runs as a background job — returns immediately."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subscriber_id": {
                        "type": "string",
                        "description": "Specific subscriber ID to reprocess. Leave empty to reprocess all In Review members.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_subscriber_details",
            "description": (
                "Looks up a specific subscriber by their subscriber ID and returns full details: "
                "current status, coverage, dependents, validation issues, AND full SEP context — "
                "sep_type (e.g. 'Household change'), sep_confidence, supporting_signals that triggered SEP, "
                "evidence submitted, evidence status, and whether they were within OEP. "
                "Use when the user asks about a specific member, their SEP reason, why they were enrolled under SEP, "
                "what evidence they submitted, or any details about a named member or subscriber ID."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subscriber_id": {
                        "type": "string",
                        "description": "The subscriber ID to look up (e.g. EMP00030).",
                    }
                },
                "required": ["subscriber_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_member",
            "description": (
                "Looks up a specific member by subscriber ID and returns their current status, "
                "AI-generated plain-English enrollment summary (agent_summary), validation issues with severity, "
                "and full SEP context. If the member has not been through the AI pipeline yet, runs it on demand. "
                "Use this — NOT get_subscriber_details — when the user asks: why is a member in review, "
                "what happened with a specific member's enrollment, what is their SEP reason, "
                "or any question about a member's enrollment outcome or status explanation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subscriber_id": {
                        "type": "string",
                        "description": "The subscriber ID to analyze (e.g. EMP00030).",
                    }
                },
                "required": ["subscriber_id"],
            },
        },
    },
]
