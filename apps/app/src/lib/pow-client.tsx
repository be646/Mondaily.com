import { useCallback, useState } from "react";
import { BASE_URL } from "./api-client";

/**
 * Native proof-of-work client. Fetches a signed challenge from the API, then brute-forces a nonce
 * whose sha256(`${challenge}:${nonce}`) starts with 0000 (~65k Web Crypto hashes — sub-second for a
 * human, a real cost for a bot). Zero third-party scripts (no reCAPTCHA). The shield hook exposes
 * the live solve state so forms can render it.
 */
const AUTH_URL = `${BASE_URL}/api/v1/auth`;

export type Pow = { pow_challenge: string; pow_nonce: string };

export async function solvePow(challenge: string): Promise<string> {
  const enc = new TextEncoder();
  for (let nonce = 0; nonce < 8_000_000; nonce++) {
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(`${challenge}:${nonce}`));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (hex.startsWith("0000")) return String(nonce);
  }
  throw new Error("Could not complete the security check. Please try again.");
}

export async function getPow(): Promise<Pow> {
  const res = await fetch(`${AUTH_URL}/challenge`, { credentials: "include" }).then(r => r.json()).catch(() => ({}));
  const challenge = (res as { challenge?: string }).challenge ?? "";
  return challenge ? { pow_challenge: challenge, pow_nonce: await solvePow(challenge) } : { pow_challenge: "", pow_nonce: "" };
}

export type ShieldStatus = "armed" | "solving" | "validated";

/** Drives a visible PoW status line: armed → solving → validated. */
export function usePowShield() {
  const [status, setStatus] = useState<ShieldStatus>("armed");
  const solve = useCallback(async (): Promise<Pow> => {
    setStatus("solving");
    try {
      const pow = await getPow();
      setStatus("validated");
      return pow;
    } catch (e) {
      setStatus("armed");
      throw e;
    }
  }, []);
  return { status, solve, reset: useCallback(() => setStatus("armed"), []) };
}

const LABEL: Record<ShieldStatus, string> = {
  armed: "[NATIVE ANTI-BOT SHIELD: ARMED]",
  solving: "[NATIVE ANTI-BOT SHIELD: SOLVING CRYPTOGRAPHIC NONCE...]",
  validated: "[NATIVE ANTI-BOT SHIELD: VALIDATED ✓]",
};

/** Subtle, low-profile terminal status line for the auth forms. */
export function PowShieldLine({ status }: { status: ShieldStatus }) {
  const color = status === "validated" ? "var(--accent)" : status === "solving" ? "#97824f" : "var(--text-faint)";
  return (
    <p className="select-none font-mono text-[10.5px] tracking-wider" style={{ color }}>
      {LABEL[status]}
      {status === "solving" && <span className="ml-0.5 animate-pulse">▍</span>}
    </p>
  );
}
