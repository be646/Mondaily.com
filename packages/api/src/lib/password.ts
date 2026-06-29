import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Promise wrapper over the options-taking scrypt overload (promisify infers the wrong one).
function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => (err ? reject(err) : resolve(derivedKey)));
  });
}

/**
 * Password hashing via scrypt — Node's built-in, memory-hard KDF. Chosen over Argon2id
 * because the API ships as a single self-contained serverless bundle (tsup noExternal),
 * which a native .node module can't be part of. scrypt is dependency-free (maximally
 * sovereign), cryptographically sound, and bundles cleanly.
 *
 * Plaintext is NEVER logged or stored. The stored string is self-describing — it embeds
 * the cost params + a unique 16-byte salt — so verification needs no out-of-band config and
 * params can be tuned later without breaking old hashes:  scrypt$N$r$p$salt$hash  (base64).
 */
const N = 32_768; // CPU/memory cost (2^15)
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024; // headroom above 128*N*r (~33 MiB)

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = (await scryptAsync(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${dk.toString("base64")}`;
}

/** Constant-time verify against the stored digest. False on any malformed/mismatched input. */
export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64!, "base64");
    const expected = Buffer.from(hashB64!, "base64");
    const dk = (await scryptAsync(plain, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM })) as Buffer;
    return dk.length === expected.length && timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}
