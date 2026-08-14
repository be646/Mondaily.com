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
import base64
import email
import hmac
import json
import os
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


MAX_ATTACH_BYTES = int(os.environ.get("MAX_ATTACH_BYTES", str(10 * 1024 * 1024)))  # 10 MB/file


def _attachments(parsed) -> list:
    """Collect attachment parts as {filename, content_type, content_base64}, size-capped."""
    out = []
    if not parsed.is_multipart():
        return out
    for part in parsed.walk():
        disp = str(part.get("Content-Disposition") or "")
        filename = part.get_filename()
        # A calendar part is forwarded even when it is INLINE and unnamed. An RSVP reply from Gmail
        # or Outlook arrives as an inline text/calendar alternative with no Content-Disposition and
        # often no filename, so the attachment-only rule dropped exactly the part that carries the
        # answer — and the reply looked like an ordinary email with nothing in it.
        is_calendar = part.get_content_type() == "text/calendar"
        if "attachment" not in disp and not filename and not is_calendar:
            continue
        try:
            payload = part.get_payload(decode=True)
            if not payload or len(payload) > MAX_ATTACH_BYTES:
                continue
            out.append({
                "filename": filename or ("invite.ics" if is_calendar else "attachment"),
                "content_type": part.get_content_type(),
                "content_base64": base64.b64encode(payload).decode("ascii"),
            })
        except Exception:
            continue
        if len(out) >= 15:
            break
    return out


class Handler:
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        """
        Refuse mail that is not for our domain, at RCPT TO.

        MAIL_DOMAIN used to appear in exactly one place — a startup log line — so this server
        accepted and 250'd mail addressed to ANY domain and forwarded every byte of it to the API
        webhook. The API dropped the unroutable ones, so nothing was mis-filed, but that made us a
        free amplifier: anyone could point a spam run at this MX and turn it into serverless
        invocations on our own API. Rejecting here costs the sender one SMTP round trip and never
        reaches the network.

        No local-part check. Recipients are `ws-<id>@` for workspaces and `support+t.<id>@` for
        ticket replies, and the API is the authority on which of those resolve — duplicating that
        list here would mean a new address shape silently bounces until someone redeploys the
        appliance.

        Unset MAIL_DOMAIN accepts everything, deliberately: this is a delivery path, and a missing
        env should not turn into every inbound message being rejected at the door.
        """
        if MAIL_DOMAIN:
            domain = address.rsplit("@", 1)[-1].strip().strip(">").lower()
            if domain != MAIL_DOMAIN:
                print(f"[receiver] rejected RCPT {address} (not {MAIL_DOMAIN})", flush=True)
                return "550 relay not permitted"
        envelope.rcpt_tos.append(address)
        return "250 OK"

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
                "attachments": _attachments(parsed),
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
