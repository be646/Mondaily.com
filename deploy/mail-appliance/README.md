# Mondaily Mail Appliance (self-hosted receive + send)

Native, **fully sovereign** email — your own MX receiving inbound mail and your own SMTP relaying
outbound. No Gmail, no Resend, no third-party email API. Two small services:

- **receiver** — an SMTP server (aiosmtpd) that is the MX for your mail domain. It parses each
  message and POSTs it (HMAC-signed) to the API's `POST /api/v1/emails/inbound`, which folds it into
  the owning workspace's threads. Routing is by the recipient address `ws-<workspaceId>@<domain>`.
- **sender** — an HMAC-verified `POST /send` the API calls (`SOVEREIGN_MAIL_SEND_URL`) to relay
  outbound mail through your SMTP.

## Contract (what the API expects)
- Inbound → `POST $MONDAILY_INBOUND_URL` with header `x-mondaily-mail-signature: hex(hmac_sha256(body, SOVEREIGN_MAIL_SECRET))` and JSON `{message_id,in_reply_to,references,from,to,cc,subject,text,html,date,recipients}`.
- Outbound → the API `POST`s to `$SOVEREIGN_MAIL_SEND_URL/send` with the same HMAC header and `{from,to,subject,html}`.

The API side is already built and FAIL-CLOSED: unset envs ⇒ inbound 401s and outbound falls back to
the existing sender, so nothing breaks until you deploy this.

## Deploy
1. Point your domain's **MX** record at this host (`inbound.mondaily.com. MX 10 <host>`).
2. Set up **SPF/DKIM/DMARC** for deliverability (DKIM signing belongs on your outbound relay).
3. `scp -r deploy/mail-appliance root@HOST:/opt/mondaily-mail && cd /opt/mondaily-mail`
4. `export SOVEREIGN_MAIL_SECRET=$(openssl rand -hex 32)` (use the SAME value in the API/Vercel env)
5. `export MAIL_DOMAIN=inbound.mondaily.com` and your `SMTP_RELAY_*` for outbound.
6. `docker compose up -d --build`
7. Verify: `curl localhost:8095/health`, then send a test mail to `ws-<yourWorkspaceId>@inbound.mondaily.com` and watch `docker compose logs -f receiver`.

## API env (Vercel) to activate
- `SOVEREIGN_MAIL_SECRET` — same shared secret as above (gates inbound 401 + signs outbound)
- `SOVEREIGN_MAIL_DOMAIN` — e.g. `inbound.mondaily.com` (mints each workspace's `ws-<id>@…` address)
- `SOVEREIGN_MAIL_SEND_URL` — e.g. `https://mail.your-host:8095` (outbound relay; omit to keep the
  current sender)

Until these are set the app's existing inbox keeps working (Gmail / local cache) and this appliance
simply isn't used — sovereign email activates the moment the envs + MX are in place.

## Security
- The inbound webhook is HMAC-verified on the API side (401 on mismatch / missing secret). The
  receiver only ever *sends* to your own API.
- The sender's `/send` is HMAC-verified too — keep it on a private network or behind TLS.
- Recipient routing only accepts `ws-<id>@<your-domain>`, so a spoofed `To:` can't target another
  workspace (envelope RCPT TO is authoritative, checked server-side).
