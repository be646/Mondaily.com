"""
Mondaily sovereign mail RECEIVER.

A self-hosted SMTP server (aiosmtpd) that accepts inbound mail for the Mondaily domain, parses each
message, and POSTs it — HMAC-signed — to the API's /emails/inbound webhook. FULL SOVEREIGNTY: no
third-party email provider; this is your own MX. The API folds each message into the owning
workspace's email threads (routing by the ws-<id>@<domain> recipient).

Env:
  SOVEREIGN_MAIL_SECRET   shared HMAC secret (must match the API's SOVEREIGN_MAIL_SECRET)
  MONDAILY_INBOUND_URL    e.g. https://api.mondaily.com/api/v1/emails/inbound
  MAIL_DOMAIN             the domain this server is MX for (e.g. inbound.mondaily.com)
  SMTP_LISTEN_PORT        default 25
"""
import asyncio
import email
import hmac
import json
import os
from email.utils import getaddresses
from hashlib import sha256

import httpx
from aiosmtpd.controller import Controller

SECRET = os.environ.get("SOVEREIGN_MAIL_SECRET", "").encode()
INBOUND_URL = os.environ.get("MONDAILY_INBOUND_URL", "").rstrip("/")
MAIL_DOMAIN = os.environ.get("MAIL_DOMAIN", "").strip().lower()


def _body(parsed) -> tuple[str, str]:
    """Return (text, html) from a parsed message, walking multipart."""
    text, html = "", ""
    if parsed.is_multipart():
        for part in parsed.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            if "attachment" in disp:
                continue
            try:
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                decoded = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            except Exception:
                continue
            if ctype == "text/plain" and not text:
                text = decoded
            elif ctype == "text/html" and not html:
                html = decoded
    else:
        try:
            text = (parsed.get_payload(decode=True) or b"").decode(parsed.get_content_charset() or "utf-8", errors="replace")
        except Exception:
            text = parsed.get_payload() or ""
    return text, html


class Handler:
    async def handle_DATA(self, server, session, envelope):
        try:
            parsed = email.message_from_bytes(envelope.content)
            refs = [r for r in (parsed.get("References", "").split()) if r]
            text, html = _body(parsed)
            payload = {
                "message_id": parsed.get("Message-ID", ""),
                "in_reply_to": parsed.get("In-Reply-To", ""),
                "references": refs,
                "from": parsed.get("From", ""),
                "to": parsed.get("To", ""),
                "cc": parsed.get("Cc", ""),
                "subject": parsed.get("Subject", ""),
                "text": text,
                "html": html,
                "date": parsed.get("Date", ""),
                # Envelope recipients are the authoritative routing target (RCPT TO), not the To header.
                "recipients": list(envelope.rcpt_tos),
            }
            await self._forward(payload)
        except Exception as e:  # never 5xx the sender for our own parsing bug
            print(f"[receiver] error: {e}", flush=True)
        return "250 Message accepted"

    async def _forward(self, payload: dict):
        if not (SECRET and INBOUND_URL):
            print("[receiver] not configured (SOVEREIGN_MAIL_SECRET / MONDAILY_INBOUND_URL) — dropping", flush=True)
            return
        raw = json.dumps(payload).encode()
        sig = hmac.new(SECRET, raw, sha256).hexdigest()
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(INBOUND_URL, content=raw, headers={"Content-Type": "application/json", "x-mondaily-mail-signature": sig})
            print(f"[receiver] forwarded {payload.get('message_id')} → {r.status_code}", flush=True)


def main():
    port = int(os.environ.get("SMTP_LISTEN_PORT", "25"))
    controller = Controller(Handler(), hostname="0.0.0.0", port=port)
    controller.start()
    print(f"[receiver] SMTP listening on :{port} for {MAIL_DOMAIN or '(no MAIL_DOMAIN set)'}", flush=True)
    loop = asyncio.get_event_loop()
    try:
        loop.run_forever()
    except KeyboardInterrupt:
        controller.stop()


if __name__ == "__main__":
    main()
