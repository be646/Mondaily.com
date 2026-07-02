/**
 * Call bus — lets any component start a call without prop-drilling. Mirrors ask-bus: a
 * component dispatches `mondaily:call`, and the app-level CallHost (mounted once in the
 * dashboard layout) picks it up, rings the invitee, and opens the call overlay.
 */
export const CALL_EVENT = "mondaily:call";
export interface CallRequest { inviteeId: string; kind: "audio" | "video"; name?: string }

export function requestCall(req: CallRequest) {
  window.dispatchEvent(new CustomEvent<CallRequest>(CALL_EVENT, { detail: req }));
}
