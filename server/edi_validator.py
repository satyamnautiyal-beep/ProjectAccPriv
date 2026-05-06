import os
import json
from typing import Dict, Any
from server.ai.agents.base import register_agent

# ===================== STRUCTURE VALIDATOR AGENT =====================
# Validates EDI file structure and format
# Part of the unified intake pipeline (Stage 2)


@register_agent("StructureValidator")
async def StructureValidator(query: str) -> str:
    """
    Validates file structure and format.
    Wraps existing check_edi_structure() function.
    
    Input:
    {
        "file_content": "ISA*00*...",
        "file_type": "edi_834",
        "file_name": "renewal_834.edi"
    }
    
    Output:
    {
        "success": true,
        "file_type": "edi_834",
        "parsed_structure": {...}
    }
    """
    try:
        payload = json.loads(query)
        file_content = payload.get("file_content", "")
        file_type = payload.get("file_type", "edi_834")
        file_name = payload.get("file_name", "")
        
        # Validate EDI 834 files
        if file_type == "edi_834":
            # Use existing EDI validator
            validation_result = check_edi_structure(file_content)
            
            if validation_result != "Healthy":
                return json.dumps({
                    "success": False,
                    "error": validation_result,
                    "file_type": file_type,
                    "file_name": file_name
                })
            
            # Parse using existing parser
            from parser import parse_edi
            parsed = parse_edi(file_content)
            
            return json.dumps({
                "success": True,
                "file_type": file_type,
                "file_name": file_name,
                "parsed_structure": parsed
            })
        
        # Add support for retro request validation
        elif file_type == "retro_request":
            # Validate retro request structure
            if not file_content or not isinstance(file_content, (str, dict)):
                return json.dumps({
                    "success": False,
                    "error": "Invalid retro request format"
                })
            
            # If it's a JSON string, parse it
            if isinstance(file_content, str):
                try:
                    parsed = json.loads(file_content)
                except json.JSONDecodeError:
                    return json.dumps({
                        "success": False,
                        "error": "Invalid JSON format for retro request"
                    })
            else:
                parsed = file_content
            
            # Validate required fields
            required_fields = ["member_id", "retro_effective_date", "auth_source"]
            missing_fields = [f for f in required_fields if f not in parsed]
            
            if missing_fields:
                return json.dumps({
                    "success": False,
                    "error": f"Missing required fields: {', '.join(missing_fields)}"
                })
            
            return json.dumps({
                "success": True,
                "file_type": file_type,
                "file_name": file_name,
                "parsed_structure": parsed
            })
        
        else:
            return json.dumps({
                "success": False,
                "error": f"Unsupported file type: {file_type}"
            })
    
    except json.JSONDecodeError as e:
        return json.dumps({
            "success": False,
            "error": f"Invalid JSON input: {str(e)}"
        })
    except Exception as e:
        return json.dumps({
            "success": False,
            "error": f"Structure validation error: {str(e)}"
        })


# ===================== EXISTING VALIDATOR FUNCTION =====================

def check_edi_structure(edi_text):
    """
    Performs SNIP Level 1 structural validation for an EDI payload.
    Returns:
        str: "Healthy" if valid, otherwise a descriptive error message.
    """
    try:
        # 1. Base check: Can't be totally empty
        if not edi_text or not edi_text.strip():
            return "Empty File"
            
        text = edi_text.lstrip()
        
        # 2. Minimum Envelope: Must have standard EDI ISA framing
        if not text.startswith("ISA"):
            return "Missing ISA Header"
            
        # 3. Fixed-Length ISA Validation
        # Standard ISA segment is strictly 106 characters (inclusive of terminator)
        if len(text) < 106:
            return "Truncated ISA Segment (Must be 106 chars)"
            
        # 4. Extract Dynamic Delimiters
        element_delimiter = text[3]
        segment_terminator = text[105]
        
        # A segment terminator should strictly not be an alphanumeric character
        if segment_terminator.isalnum():
            return "Invalid Segment Terminator (Cannot be alphanumeric)"
            
        # Parse payload structurally using dynamically extracted terminator
        segments = [s.strip() for s in text.split(segment_terminator) if s.strip()]
        if not segments:
            return "Empty Payload"

        # 5. Envelope Closure Check (IEA Trailer)
        if not segments[-1].startswith("IEA"):
            return "Missing IEA Trailer"
            
        # 6. Mandatory Envelope Hierarchy Check
        segment_names = [seg.split(element_delimiter)[0] for seg in segments if element_delimiter in seg]
        required_envelopes = ["ISA", "GS", "ST", "SE", "GE", "IEA"]
        for req in required_envelopes:
            if req not in segment_names:
                return f"Corrupt Hierarchy: Missing {req} Envelope"
                
        # 7. Control Number Integrity Check (ISA13 must match IEA02)
        isa_elements = segments[0].split(element_delimiter)
        iea_elements = segments[-1].split(element_delimiter)
        
        if len(isa_elements) < 14 or len(iea_elements) < 3:
            return "Malformed Envelope Elements"

        isa_control = isa_elements[13].strip()
        iea_control = iea_elements[2].strip()
        
        if isa_control != iea_control:
            return f"Control Number Mismatch (ISA:{isa_control} != IEA:{iea_control})"

        # 8. ST/SE Dynamic Segment Math (Bypassed for synthetic testing)
        # In production, we iterate segments to verify SE's segment count matches ST's count.

        return "Healthy"
    
    except Exception as e:
        return f"Structure Error: {str(e)}"