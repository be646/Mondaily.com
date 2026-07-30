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
- `SOVEREIGN_MAIL_SEND_URL` — e.g. `https://mail.yourdomain` (outbound relay; omit to keep the
  current sender). **No port and no path** — the API appends `/send` itself. Point it at the Caddy
  vhost in `./Caddyfile`, never at `http://<ip>:8095`: the sender binds to 127.0.0.1 only, and an
  unreachable URL here used to stall every outbound send before falling back (now bounded to 5s in
  `lib/mail.ts`, and logged as "sovereign relay unreachable").

Until these are set the app's existing inbox keeps working (Gmail / local cache) and this appliance
simply isn't used — sovereign email activates the moment the envs + MX are in place.

## Attachments
Inbound attachments (PDFs, images, docs) are parsed by the receiver, forwarded in the webhook
(base64, 10 MB/file cap — tune `MAX_ATTACH_BYTES`), and uploaded by the API to a PRIVATE Supabase
Storage bucket `email-attachments`. Run the `20260709_email_attachments_bucket.sql` migration once to
create the bucket. The inbox serves each file via a short-lived signed URL scoped to the workspace
prefix, so one tenant can never read another's files.

## Security
- The inbound webhook is HMAC-verified on the API side (401 on mismatch / missing secret). The
  receiver only ever *sends* to your own API.
- The sender's `/send` is HMAC-verified too — keep it on a private network or behind TLS.
- Recipient routing only accepts `ws-<id>@<your-domain>`, so a spoofed `To:` can't target another
  workspace (envelope RCPT TO is authoritative, checked server-side).

## Host requirements for deliverability (learned the hard way)

The appliance relays through the host's Postfix. Four things must be true or mail is silently
rejected / unsigned. Each of these actually bit us in production on 2026-07-29:

1. **Postfix must call OpenDKIM.** `smtpd_milters`/`non_smtpd_milters` are empty by default, so
   OpenDKIM can be running and correctly keyed while *nothing is ever signed*:
   ```
   postconf -e 'smtpd_milters = inet:127.0.0.1:8891'
   postconf -e 'non_smtpd_milters = inet:127.0.0.1:8891'
   ```

2. **OpenDKIM must trust the container's subnet.** Without `InternalHosts`, only 127.0.0.1 counts as
   internal and it refuses to sign, logging
   `external host [172.19.0.2] attempted to send as <domain>`:
   ```
   printf '127.0.0.1\n::1\nlocalhost\n172.16.0.0/12\n' > /etc/opendkim/TrustedHosts
   # then add InternalHosts + ExternalIgnoreList pointing at that file in /etc/opendkim.conf
   ```

3. **Force IPv4** unless IPv6 rDNS *and* an `ip6:` SPF term are both in place. With
   `inet_protocols = all` Postfix prefers IPv6, and Gmail rejects IPv6 senders lacking valid PTR:
   ```
   postconf -e 'inet_protocols = ipv4'
   ```

4. **Postfix must accept relay from the containers** — `mynetworks` is loopback-only by default, and
   the firewall must allow the relay port from the docker bridge only (never publicly):
   ```
   postconf -e 'mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128 172.16.0.0/12'
   ufw allow from 172.16.0.0/12 to any port 2525 proto tcp
   ```

The sender is fronted by TLS (Caddy → `127.0.0.1:8095`) and must NOT be published on `0.0.0.0`:
it gets probed for `/.env` and `/.git/config` within hours of being exposed.

Verify with: `opendkim-testkey -d <domain> -s mail -vvv` (expect `key OK`; "key not secure" just
means no DNSSEC), then send a message and confirm a `DKIM-Signature:` header is present.
