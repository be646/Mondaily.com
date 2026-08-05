import { useCallback, useRef, useState } from "react";
import { BASE_URL } from "./api-client";

/**
 * Native proof-of-work client. Fetches a signed challenge from the API, then brute-forces a nonce
 * whose sha256(`${challenge}:${nonce}`) starts with 0000 (~65k Web Crypto hashes — sub-second for a
 * human, a real cost for a bot). Zero third-party scripts (no reCAPTCHA). The shield hook exposes
 * the live solve state so forms can render it.
 */
const AUTH_URL = `${BASE_URL}/api/v1/auth`;

export type Pow = { pow_challenge: string; pow_nonce: string };

/**
 * What the solve actually cost. Reported rather than discarded so the sign-in console can show the
 * true attempt count and digest — the numbers are the evidence that the shield is real work and not
 * a spinner, and they differ on every solve because the challenge does.
 */
export interface PowResult { nonce: string; attempts: number; ms: number; digest: string }

export async function solvePowDetailed(challenge: string): Promise<PowResult> {
  const enc = new TextEncoder();
  const t0 = performance.now();
  for (let nonce = 0; nonce < 8_000_000; nonce++) {
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(`${challenge}:${nonce}`));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (hex.startsWith("0000")) {
      return { nonce: String(nonce), attempts: nonce + 1, ms: Math.round(performance.now() - t0), digest: hex };
    }
  }
  throw new Error("Could not complete the security check. Please try again.");
}

export async function solvePow(challenge: string): Promise<string> {
  return (await solvePowDetailed(challenge)).nonce;
}

/** Real steps, emitted as they happen. Absent when the caller does not want a console. */
export type PowTrace = {
  challenge?: (challenge: string) => void;
  solving?: () => void;
  solved?: (r: PowResult) => void;
  unavailable?: () => void;
};

export async function getPow(trace?: PowTrace): Promise<Pow> {
  const res = await fetch(`${AUTH_URL}/challenge`, { credentials: "include" }).then(r => r.json()).catch(() => ({}));
  const challenge = (res as { challenge?: string }).challenge ?? "";
  // No challenge means the deployment has PoW off. Say nothing rather than narrate a shield that
  // is not there — a console that reports work it did not do is worse than no console.
  if (!challenge) { trace?.unavailable?.(); return { pow_challenge: "", pow_nonce: "" }; }
  trace?.challenge?.(challenge);
  trace?.solving?.();
  const r = await solvePowDetailed(challenge);
  trace?.solved?.(r);
  return { pow_challenge: challenge, pow_nonce: r.nonce };
}

export type ShieldStatus = "armed" | "solving" | "validated";

/** Drives a visible PoW status line: armed → solving → validated. */
export function usePowShield(trace?: PowTrace) {
  const [status, setStatus] = useState<ShieldStatus>("armed");
  // Held in a ref so a caller can pass a fresh closure each render without re-creating `solve` and
  // re-firing the mount effect that arms the shield.
  const traceRef = useRef(trace);
  traceRef.current = trace;
  const solve = useCallback(async (): Promise<Pow> => {
    setStatus("solving");
    try {
      const pow = await getPow(traceRef.current);
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
  const color = status === "validated" ? "var(--accent)" : status === "solving" ? "#c6892e" : "var(--text-faint)";
  return (
    <p className="select-none font-mono text-[10.5px] tracking-wider" style={{ color }}>
      {LABEL[status]}
      {status === "solving" && <span className="ml-0.5 animate-pulse">▍</span>}
    </p>
  );
}
