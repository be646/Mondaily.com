#!/usr/bin/env node
/**
 * Idempotently ensure the PRIVATE `meeting-recordings` storage bucket exists (Phase 1 Meeting Memory
 * uploads). Safe to run repeatedly. Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in the environment.
 *
 *   node scripts/ensure-meeting-recordings-bucket.mjs
 *
 * If it cannot create the bucket, it prints the exact manual Supabase setup and exits non-zero.
 */
import { createClient } from "@supabase/supabase-js";

const BUCKET = "meeting-recordings";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

const manual = () => {
  console.error(
    `\nManual setup needed — create the bucket in Supabase → Storage:\n` +
      `  • Name: ${BUCKET}\n` +
      `  • Public: OFF (private)\n` +
      `  • Allowed MIME types: audio/mpeg, audio/mp4, audio/x-m4a, audio/wav, audio/x-wav, audio/webm, audio/ogg\n` +
      `  • File size limit: 500 MB\n` +
      `Access is always via short-lived signed URLs from the API (never public).\n`,
  );
};

async function main() {
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.");
    manual();
    process.exit(1);
  }
  const sb = createClient(url, key);
  const { data: existing } = await sb.storage.getBucket(BUCKET);
  if (existing) {
    console.log(`✓ Bucket "${BUCKET}" already exists (public=${existing.public}).`);
    if (existing.public) console.warn("⚠ Bucket is PUBLIC — it should be private. Fix in Supabase Storage settings.");
    return;
  }
  const mimes = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg"];
  // Try with a generous per-bucket size cap; if the project's global storage limit rejects it, fall
  // back to no per-bucket cap (the API enforces MAX_UPLOAD_BYTES itself). Private either way.
  let { error } = await sb.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "500MB", allowedMimeTypes: mimes });
  if (error && /maximum allowed size|exceeded/i.test(error.message)) {
    ({ error } = await sb.storage.createBucket(BUCKET, { public: false, allowedMimeTypes: mimes }));
    if (!error) console.log("  (per-bucket size cap not set — the API enforces the upload size limit.)");
  }
  if (error) {
    console.error(`Could not create bucket "${BUCKET}": ${error.message}`);
    manual();
    process.exit(1);
  }
  console.log(`✓ Created private bucket "${BUCKET}".`);
}

main().catch((e) => { console.error(e?.message || e); manual(); process.exit(1); });
