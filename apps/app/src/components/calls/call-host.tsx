import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Phone, PhoneOff, Video } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { CALL_EVENT, type CallRequest } from "../../lib/call-bus";
import { useTableRealtime } from "../../hooks/useTableRealtime";
import { CallOverlay, type ActiveCall } from "./call-overlay";

interface IncomingCall { id: string; room: string; initiator_id: string; kind: "audio" | "video"; caller_name: string; caller_avatar: string | null }

/**
 * CallHost — mounted once in the dashboard layout. Owns the single active-call overlay,
 * listens for outbound `mondaily:call` requests (rings the invitee), and surfaces an
 * incoming-call prompt when a ringing call_session arrives (via Realtime, polling fallback).
 * Entirely inert when calling isn't configured (capability.enabled === false).
 */
export function CallHost() {
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);

  const capability = useQuery<{ enabled: boolean; recording?: boolean; transcription?: boolean }>({
    queryKey: ["call-capability"],
    queryFn: () => apiClient.get("/live-calls/capability"),
    staleTime: 10 * 60_000,
  });
  const enabled = !!capability.data?.enabled;
  const canRecord = !!capability.data?.recording;

  // Outbound: someone clicked "Call".
  useEffect(() => {
    if (!enabled) return;
    const handler = async (e: Event) => {
      const req = (e as CustomEvent<CallRequest>).detail;
      if (!req?.inviteeId || active) return;
      // Recording is opt-in AND only possible when the deployment has it configured.
      const record = !!req.record && canRecord;
      try {
        const res = await apiClient.post<{ session_id: string; room: string; token: string; url: string; recording?: boolean }>("/live-calls/rooms", { invitee_id: req.inviteeId, kind: req.kind, record });
        setActive({ sessionId: res.session_id, room: res.room, token: res.token, url: res.url, kind: req.kind, otherName: req.name || "Member", recording: !!res.recording });
      } catch { /* surfaced by the button's own error path if any */ }
    };
    window.addEventListener(CALL_EVENT, handler);
    return () => window.removeEventListener(CALL_EVENT, handler);
  }, [enabled, active, canRecord]);

  // Inbound: poll (fallback) + realtime invalidation for ringing calls addressed to me.
  const incomingQ = useQuery<{ incoming: IncomingCall[] }>({
    queryKey: ["call-incoming"],
    queryFn: () => apiClient.get("/live-calls/incoming"),
    enabled,
    refetchInterval: enabled ? 8_000 : false,
  });
  const live = useTableRealtime("call_sessions", useCallback(() => { if (enabled) incomingQ.refetch(); }, [enabled, incomingQ]));
  useEffect(() => {
    const next = incomingQ.data?.incoming?.[0];
    if (next && !active && (!incoming || incoming.id !== next.id)) setIncoming(next);
    if (!next && incoming) setIncoming(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingQ.data, active]);
  void live;

  const accept = async () => {
    if (!incoming) return;
    try {
      const res = await apiClient.post<{ room: string; token: string; url: string }>(`/live-calls/rooms/${incoming.id}/join`, {});
      setActive({ sessionId: incoming.id, room: res.room, token: res.token, url: res.url, kind: incoming.kind, otherName: incoming.caller_name });
    } catch { /* ignore */ }
    setIncoming(null);
  };
  const decline = async () => {
    if (!incoming) return;
    apiClient.post(`/live-calls/rooms/${incoming.id}/end`, { status: "declined" }).catch(() => {});
    setIncoming(null);
  };

  if (!enabled) return null;

  return (
    <>
      {active && <CallOverlay call={active} onClose={() => setActive(null)} />}
      {incoming && !active && (
        <div className="fixed bottom-6 right-6 z-[55] w-72 rounded-lg border p-4 shadow-2xl" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }} role="dialog" aria-label="Incoming call">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
              {incoming.caller_name?.trim()?.[0]?.toUpperCase() ?? "?"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{incoming.caller_name}</p>
              <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>Incoming {incoming.kind} call…</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={accept} className="flex flex-1 items-center justify-center gap-1.5 rounded-sm py-1.5 text-[12px] font-medium text-white" style={{ background: "#10b981" }}>
              {incoming.kind === "video" ? <Video size={13} /> : <Phone size={13} />} Accept
            </button>
            <button onClick={decline} className="flex flex-1 items-center justify-center gap-1.5 rounded-sm py-1.5 text-[12px] font-medium text-white" style={{ background: "#e11d48" }}>
              <PhoneOff size={13} /> Decline
            </button>
          </div>
        </div>
      )}
    </>
  );
}
