import os

def check_edi_structure(edi_text):
    """
    Performs SNIP Level 1 structural validation for an EDI payload.
    """
    try:
        if not edi_text or not edi_text.strip():
            return "Empty File"

        text = edi_text.lstrip()

        # 1️⃣ Must start with ISA
        if not text.startswith("ISA"):
            return "Missing ISA Header"

        # 2️⃣ Extract ISA segment SAFELY (up to first segment terminator)
        # ISA is the first segment – find its terminator dynamically
        possible_terminators = ["~", "\n", "\r"]
        isa_end_index = None

        for i in range(80, 120):  # ISA is always within this range
            if i < len(text) and text[i] in "~\n\r":
                isa_end_index = i
                break

        if isa_end_index is None:
            return "Unable to locate ISA segment terminator"

        isa_segment = text[: isa_end_index + 1]

        # 3️⃣ Element & segment delimiters
        element_delimiter = isa_segment[3]
        segment_terminator = isa_segment.rstrip()[-1]

        if segment_terminator.isalnum():
            return "Invalid Segment Terminator (Cannot be alphanumeric)"

        # 4️⃣ Split segments using detected terminator
        segments = [s.strip() for s in text.split(segment_terminator) if s.strip()]
        if not segments:
            return "Empty Payload"

        # 5️⃣ Must end with IEA
        if not segments[-1].startswith("IEA"):
            return "Missing IEA Trailer"

        # 6️⃣ Envelope hierarchy
        segment_names = [seg.split(element_delimiter)[0] for seg in segments if element_delimiter in seg]
        required = ["ISA", "GS", "ST", "SE", "GE", "IEA"]

        for req in required:
            if req not in segment_names:
                return f"Corrupt Hierarchy: Missing {req} Envelope"

        # 7️⃣ Control number match
        isa_elements = segments[0].split(element_delimiter)
        iea_elements = segments[-1].split(element_delimiter)

        if len(isa_elements) < 14 or len(iea_elements) < 3:
            return "Malformed Envelope Elements"

        if isa_elements[13].strip() != iea_elements[2].strip():
            return (
                f"Control Number Mismatch "
                f"(ISA:{isa_elements[13]} != IEA:{iea_elements[2]})"
            )

        return "Healthy"

    except Exception as e:
        return f"Structure Error: {str(e)}"