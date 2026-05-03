# email_agent.py
from typing import Dict, List
from datetime import datetime, timezone

EMAIL_TEMPLATES = {
    "sep_missing_documents": """
Subject: Action Required – Documents Needed to Process Your Enrollment

Dear {member_name},

We are currently reviewing your enrollment request due to a qualifying life event:
{sep_type}

To continue processing your enrollment, we need the following documents:

{missing_documents}

Please upload these documents within 30 days to avoid delays or loss of coverage.

Thank you,
Enrollment Operations Team
"""
}



def draft_email(template: str, context: Dict[str, str]) -> Dict[str, str]:
    if template not in EMAIL_TEMPLATES:
        raise ValueError(f"Unknown email template: {template}")
    body = EMAIL_TEMPLATES[template].format(**context)
    return {
        "subject": body.splitlines()[0].replace("Subject: ", ""),
        "body": body
    }

def send_email(to: str, email_payload: Dict[str, str]) -> None:
    """
    Stubbed sender – replace with SES / SendGrid / internal service.
    """
    print("📧 EMAIL SENT")
    print("To:", to)
    print("Subject:", email_payload["subject"])
    print(email_payload["body"])
    print("Sent at:", datetime.now(timezone.utc).isoformat())