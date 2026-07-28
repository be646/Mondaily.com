/**
 * Canonical LiveKit room-name derivations. Kept in ONE place so every surface that needs to reference a
 * meeting's room (call token, guest link, end-call, and now the Phase B saved live transcript) computes
 * the exact same string — if these ever drifted, saved transcript lines would key to a different room than
 * the one participants actually joined. Rooms are workspace-namespaced so tokens can never cross tenants.
 */

/** The internal, workspace-namespaced room for a calendar-event/meeting call. Never surfaced to users. */
export const meetingRoom = (workspaceId: string, eventId: string): string => `ws_${workspaceId}__meeting__${eventId}`;
