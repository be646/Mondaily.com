import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { CheckCircle, AlertCircle, UserPlus, RotateCcw } from "lucide-react";
import { apiClient } from "../../lib/api-client";

interface Member { id: string; user_id: string; email: string; name: string; }
interface Task { id: string; title: string; assignee_id?: string; reviewer_id?: string; reviewer_name?: string; review_result?: string; status?: string; }
interface TaskReview {
  id: string; round: number; sent_by_name: string; sent_at: string;
  context: string; reviewer_id: string; reviewer_name: string;
  action?: string; action_note?: string; action_at?: string; status: string;
}

type Screen = "idle" | "send" | "action" | "reassign";

function Avatar({ name, size = 7 }: { name: string; size?: number }) {
  const colors = ["bg-indigo-500/20 text-indigo-600 dark:text-indigo-400","bg-blue-500/20 text-blue-600 dark:text-blue-400","bg-green-500/20 text-green-600 dark:text-green-400","bg-purple-500/20 text-purple-600 dark:text-purple-400","bg-orange-500/20 text-orange-600 dark:text-orange-400"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return <div className={`h-${size} w-${size} rounded-full ${color} flex items-center justify-center text-xs font-semibold shrink-0`}>{name.charAt(0).toUpperCase()}</div>;
}

function RoundBadge({ round }: { round: number }) {
  return <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>Round {round}</span>;
}

function ReviewHistoryItem({ review }: { review: TaskReview }) {
  const actionColor = review.action === "approved" ? "#10b981" : review.action === "changes_requested" ? "#d97706" : "var(--text-muted)";
  const actionLabel = review.action === "approved" ? "Approved" : review.action === "changes_requested" ? "Changes Requested" : review.action === "reassigned" ? "Reassigned" : "Pending";

  return (
    <div className="surface-card space-y-3 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <RoundBadge round={review.round}/>
        <span className="text-xs font-medium" style={{ color: review.status === "pending" ? "#3b82f6" : actionColor }}>
          {review.status === "pending" ? "Pending" : actionLabel}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Avatar name={review.sent_by_name} size={6}/>
        <div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Sent by <span style={{ color: "var(--text-primary)" }}>{review.sent_by_name}</span></p>
          <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>{new Date(review.sent_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      </div>

      {review.context && (
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
          <p className="text-[11px] mb-1" style={{ color: "var(--text-faint)" }}>What to review</p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{review.context}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Avatar name={review.reviewer_name} size={6}/>
        <div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Reviewer: <span style={{ color: "var(--text-primary)" }}>{review.reviewer_name}</span></p>
          {review.action_at && <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>{new Date(review.action_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
        </div>
      </div>

      {review.action_note && (
        <div className="rounded-lg px-3 py-2 border" style={review.action === "approved" ? { background: "rgba(16,185,129,0.06)", borderColor: "rgba(16,185,129,0.2)" } : { background: "rgba(217,119,6,0.06)", borderColor: "rgba(217,119,6,0.2)" }}>
          <p className="text-xs" style={{ color: review.action === "approved" ? "#10b981" : "#d97706" }}>{review.action_note}</p>
        </div>
      )}
    </div>
  );
}

export function TaskReviewTab({ task, members, onUpdate }: {
  task: Task; members: Member[]; onUpdate: () => void;
}) {
  const { user } = useUser();
  const userName = user?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || "Unknown";
  const userId = user?.id || "";
  const isOwner = !task.assignee_id || task.assignee_id === userId;
  const isReviewer = task.reviewer_id === userId;

  const [screen, setScreen] = useState<Screen>("idle");
  const [context, setContext] = useState("");
  const [selectedReviewer, setSelectedReviewer] = useState<Member | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [newReviewer, setNewReviewer] = useState<Member | null>(null);

  const reviewsQ = useQuery({
    queryKey: ["task-reviews", task.id],
    queryFn: () => apiClient.get<TaskReview[]>(`/tasks/${task.id}/reviews`)
  });

  const reviews = reviewsQ.data ?? [];
  const pendingReview = reviews.find(r => r.status === "pending");
  const history = reviews.filter(r => r.status === "completed");

  const sendReview = useMutation({
    mutationFn: () => apiClient.post(`/tasks/${task.id}/reviews`, {
      reviewer_id: selectedReviewer!.user_id,
      reviewer_name: selectedReviewer!.name || selectedReviewer!.email,
      sent_by_name: userName,
      context
    }),
    onSuccess: () => { reviewsQ.refetch(); onUpdate(); setScreen("idle"); setContext(""); setSelectedReviewer(null); }
  });

  const takeAction = useMutation({
    mutationFn: (action: "approved" | "changes_requested") =>
      apiClient.patch(`/tasks/${task.id}/reviews/${pendingReview!.id}`, {
        action, action_note: actionNote || undefined,
        reviewer_name: userName, owner_id: task.assignee_id || ""
      }),
    onSuccess: () => { reviewsQ.refetch(); onUpdate(); setScreen("idle"); setActionNote(""); setTimeout(() => { onUpdate(); }, 800); }
  });

  const reassign = useMutation({
    mutationFn: () => apiClient.patch(`/tasks/${task.id}/reviews/${pendingReview!.id}`, {
      action: "reassigned", action_note: actionNote || undefined,
      reviewer_name: userName, owner_id: task.assignee_id || "",
      new_reviewer_id: newReviewer!.user_id,
      new_reviewer_name: newReviewer!.name || newReviewer!.email,
      context: pendingReview?.context || ""
    }),
    onSuccess: () => { reviewsQ.refetch(); onUpdate(); setScreen("idle"); setActionNote(""); setNewReviewer(null); }
  });

  // SEND FOR REVIEW screen
  if (screen === "send") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Send for Review</h3>
          <button onClick={() => setScreen("idle")} className="text-xs transition-colors hover:text-indigo-600 dark:hover:text-indigo-400" style={{ color: "var(--text-muted)" }}>Cancel</button>
        </div>

        <div>
          <label className="text-xs mb-1.5 block" style={{ color: "var(--text-muted)" }}>What needs to be reviewed? *</label>
          <textarea value={context} onChange={e => setContext(e.target.value)} rows={3} autoFocus
            placeholder="e.g. Please check the pricing section and verify the client requirements are met..."
            className="key-input w-full px-3 py-2.5 text-sm resize-none"/>
        </div>

        <div>
          <label className="text-xs mb-1.5 block" style={{ color: "var(--text-muted)" }}>Choose reviewer *</label>
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {members.map(m => (
              <button key={m.user_id} onClick={() => setSelectedReviewer(m)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors"
                style={selectedReviewer?.user_id === m.user_id ? { borderColor: "var(--border-strong)", background: "var(--surface-selected)" } : { borderColor: "var(--border-soft)" }}>
                <Avatar name={m.name || m.email}/>
                <span className="flex-1 text-sm text-left" style={{ color: "var(--text-secondary)" }}>{m.name || m.email}</span>
                {selectedReviewer?.user_id === m.user_id && <CheckCircle size={14} className="text-emerald-500 dark:text-emerald-400 shrink-0"/>}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => context.trim() && selectedReviewer && sendReview.mutate()}
          disabled={!context.trim() || !selectedReviewer || sendReview.isPending}
          className="btn-primary w-full h-10 text-sm font-medium">
          {sendReview.isPending ? "Sending..." : "Send for Review →"}
        </button>
      </div>
    );
  }

  // TAKE ACTION screen
  if (screen === "action" && pendingReview) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Review Action</h3>
          <button onClick={() => setScreen("idle")} className="text-xs transition-colors hover:text-indigo-600 dark:hover:text-indigo-400" style={{ color: "var(--text-muted)" }}>Back</button>
        </div>

        <div className="surface-card rounded-xl p-4">
          <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>Reviewing</p>
          <p className="text-sm font-medium mb-3" style={{ color: "var(--text-primary)" }}>{pendingReview.context}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Sent by <span style={{ color: "var(--text-secondary)" }}>{pendingReview.sent_by_name}</span></p>
        </div>

        <div>
          <label className="text-xs mb-1.5 block" style={{ color: "var(--text-muted)" }}>Add a note (optional for approval, required for changes)</label>
          <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} rows={3}
            placeholder="Your feedback..."
            className="key-input w-full px-3 py-2.5 text-sm resize-none"/>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => takeAction.mutate("approved")} disabled={takeAction.isPending}
            className="flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{ background: "#10b981" }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#10b981"; }}>
            <CheckCircle size={15}/> Approve
          </button>
          <button onClick={() => actionNote.trim() && takeAction.mutate("changes_requested")} disabled={!actionNote.trim() || takeAction.isPending}
            className="btn-secondary flex items-center justify-center gap-2 h-10 text-sm font-medium">
            <AlertCircle size={15}/> Request Changes
          </button>
        </div>

        <button onClick={() => setScreen("reassign")} className="btn-ghost flex items-center justify-center gap-2 w-full h-9 border text-sm" style={{ borderColor: "var(--border-soft)" }}>
          <UserPlus size={14}/> Reassign to someone else
        </button>
      </div>
    );
  }

  // REASSIGN screen
  if (screen === "reassign" && pendingReview) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Reassign Review</h3>
          <button onClick={() => setScreen("action")} className="text-xs transition-colors hover:text-indigo-600 dark:hover:text-indigo-400" style={{ color: "var(--text-muted)" }}>Back</button>
        </div>

        <div>
          <label className="text-xs mb-1.5 block" style={{ color: "var(--text-muted)" }}>Choose new reviewer</label>
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {members.filter(m => m.user_id !== userId).map(m => (
              <button key={m.user_id} onClick={() => setNewReviewer(m)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors"
                style={newReviewer?.user_id === m.user_id ? { borderColor: "var(--border-strong)", background: "var(--surface-selected)" } : { borderColor: "var(--border-soft)" }}>
                <Avatar name={m.name || m.email}/>
                <span className="flex-1 text-sm text-left" style={{ color: "var(--text-secondary)" }}>{m.name || m.email}</span>
                {newReviewer?.user_id === m.user_id && <CheckCircle size={14} className="text-emerald-500 dark:text-emerald-400"/>}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs mb-1.5 block" style={{ color: "var(--text-muted)" }}>Reason for reassigning (optional)</label>
          <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} rows={2}
            placeholder="Why are you reassigning this?"
            className="key-input w-full px-3 py-2.5 text-sm resize-none"/>
        </div>

        <button onClick={() => newReviewer && reassign.mutate()} disabled={!newReviewer || reassign.isPending}
          className="btn-secondary flex items-center justify-center gap-2 w-full h-10 text-sm font-medium">
          <UserPlus size={14}/> Reassign Review
        </button>
      </div>
    );
  }

  // IDLE screen - main view
  return (
    <div className="space-y-4">

      {/* Pending review card */}
      {pendingReview && (
        <div className="surface-card space-y-3 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse"/>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Pending Review</span>
            </div>
            <RoundBadge round={pendingReview.round}/>
          </div>

          <div className="flex items-center gap-2">
            <Avatar name={pendingReview.sent_by_name} size={6}/>
            <div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Sent by <span style={{ color: "var(--text-primary)" }}>{pendingReview.sent_by_name}</span></p>
              <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>{new Date(pendingReview.sent_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
            </div>
          </div>

          <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
            <p className="text-[11px] mb-1" style={{ color: "var(--text-faint)" }}>What to review</p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{pendingReview.context}</p>
          </div>

          <div className="flex items-center gap-2">
            <Avatar name={pendingReview.reviewer_name} size={6}/>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Reviewer: <span style={{ color: "var(--text-primary)" }}>{pendingReview.reviewer_name}</span></p>
          </div>

          {/* Reviewer actions */}
          {isReviewer && (
            <button onClick={() => setScreen("action")} className="btn-primary w-full h-9 text-sm font-medium">
              Take Action →
            </button>
          )}

          {/* Owner can cancel */}
          {isOwner && !isReviewer && (
            <p className="text-xs text-center" style={{ color: "var(--text-faint)" }}>Waiting for {pendingReview.reviewer_name} to review</p>
          )}
        </div>
      )}

      {/* Review result */}
      {task.review_result && !pendingReview && (
        <div className="rounded-xl border p-4" style={task.review_result === "approved" ? { borderColor: "rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.05)" } : { borderColor: "rgba(217,119,6,0.2)", background: "rgba(217,119,6,0.05)" }}>
          <div className="flex items-center gap-2 mb-1">
            {task.review_result === "approved"
              ? <CheckCircle size={15} className="text-emerald-500 dark:text-emerald-400"/>
              : <AlertCircle size={15} className="text-amber-500 dark:text-amber-400"/>}
            <span className="text-sm font-medium" style={{ color: task.review_result === "approved" ? "#10b981" : "#d97706" }}>
              {task.review_result === "approved" ? "Approved" : "Changes Requested"}
            </span>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>by {task.reviewer_name} · See Comments tab for details</p>
          {task.review_result === "changes_requested" && isOwner && (
            <button onClick={() => setScreen("send")}
              className="btn-secondary mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs">
              <RotateCcw size={12}/> Resubmit for Review
            </button>
          )}
        </div>
      )}

      {/* Send for review button - only show if no pending and no result, or after approval */}
      {!pendingReview && (!task.review_result || task.review_result === "approved") && isOwner && (
        <button onClick={() => setScreen("send")} className="btn-ghost w-full h-10 border text-sm" style={{ borderColor: "var(--border-soft)" }}>
          Send for Review →
        </button>
      )}

      {/* Review history */}
      {history.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--text-faint)" }}>Review History</p>
          <div className="space-y-3">
            {history.map(r => <ReviewHistoryItem key={r.id} review={r}/>)}
          </div>
        </div>
      )}

      {reviews.length === 0 && !pendingReview && (
        <p className="text-sm text-center py-6" style={{ color: "var(--text-faint)" }}>No review history yet</p>
      )}
    </div>
  );
}
