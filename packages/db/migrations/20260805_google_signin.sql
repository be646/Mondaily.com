-- Sign in with Google — identity columns on the sovereign credential table.
--
-- Why this exists: measured on 2026-08-05, thirteen accounts had registered in three weeks and NOT
-- ONE had ever verified its email; nine of the thirteen were Gmail dot-abuse or SMS gateways. A
-- Google sign-in fixes both at once — Google has already proven mailbox control, so the account is
-- verified the moment it lands with no link to deliver, and nobody can OAuth into an inbox they do
-- not own, which is the entire basis of the dot-abuse trick.

-- The Google account id. NOT the email: an email can change hands, `sub` is stable and unique per
-- Google account forever, and it is what stops a re-registered address inheriting the old account.
alter table auth_credentials add column if not exists google_sub text;

-- One Mondaily account per Google account. Without this, two rows could claim the same identity and
-- sign-in would resolve to whichever the query happened to return first.
create unique index if not exists auth_credentials_google_sub_key
  on auth_credentials (google_sub) where google_sub is not null;

-- A Google-only account genuinely has no password, and NOT NULL here would force us to invent one.
-- That is worse than it sounds: a random hash nobody knows is still a password credential, and
-- "forgot password" would happily reset it — silently converting an OAuth account into a password
-- account. The login route refuses null hashes explicitly rather than relying on the verifier.
alter table auth_credentials alter column password_hash drop not null;

-- Prove the shape is usable, rather than trusting that ALTER succeeded. A green DDL says nothing
-- about whether an insert of the new shape actually works.
do $$
declare v_id text := 'usr_selftest_google';
begin
  insert into auth_credentials (user_id, email, password_hash, email_verified, verified_at, google_sub)
  values (v_id, 'selftest-google@mondaily.invalid', null, true, now(), 'selftest-sub-0000');
  delete from auth_credentials where user_id = v_id;
  raise notice 'google sign-in shape OK: null password_hash + google_sub accepted';
end $$;
