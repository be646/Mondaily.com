"""
Mondaily sovereign mail SENDER.

A tiny HMAC-verified HTTP endpoint the API calls (SOVEREIGN_MAIL_SEND_URL/send) to relay outbound
mail through your own SMTP — no third-party email API. Signs nothing on the wire beyond the shared
HMAC the API already computes over the JSON body.

Env:
  SOVEREIGN_MAIL_SECRET   shared HMAC secret (must match the API's)
  SMTP_RELAY_HOST         your outbound SMTP host (e.g. localhost postfix, or a smarthost)
  SMTP_RELAY_PORT         default 587
  SMTP_RELAY_USER/PASS    optional SMTP auth
  SMTP_STARTTLS           "1" to STARTTLS (default on for non-25 ports)
"""
import hmac
import os
import smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from hashlib import sha256

from fastapi import FastAPI, Header, HTTPException, Request

SECRET = os.environ.get("SOVEREIGN_MAIL_SECRET", "").encode()
RELAY_HOST = os.environ.get("SMTP_RELAY_HOST", "localhost")
RELAY_PORT = int(os.environ.get("SMTP_RELAY_PORT", "587"))
RELAY_USER = os.environ.get("SMTP_RELAY_USER", "")
RELAY_PASS = os.environ.get("SMTP_RELAY_PASS", "")
STARTTLS = os.environ.get("SMTP_STARTTLS", "1" if RELAY_PORT != 25 else "0") == "1"

app = FastAPI(title="mondaily-mail-sender")


@app.get("/health")
def health():
    return {"ok": True, "relay": f"{RELAY_HOST}:{RELAY_PORT}"}


@app.post("/send")
async def send(request: Request, x_mondaily_mail_signature: str = Header(default="")):
    raw = await request.body()
    if not SECRET:
        raise HTTPException(status_code=401, detail="sender not configured")
    expected = hmac.new(SECRET, raw, sha256).hexdigest()
    if not hmac.compare_digest(expected, x_mondaily_mail_signature or ""):
        raise HTTPException(status_code=401, detail="invalid signature")

    import json
    try:
        p = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="bad payload")
    to = p.get("to") or []
    if not p.get("from") or not to:
        raise HTTPException(status_code=400, detail="from + to required")

    msg = EmailMessage()
    msg["From"] = p["from"]
    msg["To"] = ", ".join(to)
    msg["Subject"] = p.get("subject", "")
    # RFC 5322 requires Date and Message-ID. Without them Gmail REJECTS outright:
    #   550-5.7.1 Messages missing a valid Message-ID header are not accepted
    # so every outbound message bounced. The Message-ID domain must be our sending domain so it
    # aligns with the From: domain and DKIM/DMARC.
    sender_domain = p["from"].rsplit("@", 1)[-1].strip(">").strip()
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=sender_domain or None)
    # Lets the recipient's client thread replies correctly when the caller supplies them.
    if p.get("in_reply_to"):
        msg["In-Reply-To"] = p["in_reply_to"]
        msg["References"] = p.get("references") or p["in_reply_to"]
    html = p.get("html", "")
    msg.set_content("This message requires an HTML-capable client.")
    if html:
        msg.add_alternative(html, subtype="html")

    try:
        with smtplib.SMTP(RELAY_HOST, RELAY_PORT, timeout=30) as s:
            if STARTTLS:
                s.starttls()
            if RELAY_USER:
                s.login(RELAY_USER, RELAY_PASS)
            s.send_message(msg)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"relay failed: {e}")
    return {"ok": True}
