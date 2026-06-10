import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { CheckCircle, AlertCircle, UserPlus, Clock, RotateCcw } from "lucide-react";
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
  const colors = ["bg-red-500/20 text-red-400","bg-blue-500/20 text-blue-400","bg-green-500/20 text-green-400","bg-purple-500/20 text-purple-400","bg-orange-500/20 text-orange-400"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return <div className={`h-${size} w-${size} rounded-full ${color} flex items-center justify-center text-xs font-semibold shrink-0`}>{name.charAt(0).toUpperCase()}</div>;
}

function RoundBadge({ round }: { round: number }) {
  return <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400 font-medium">Round {round}</span>;
}

function ReviewHistoryItem({ review }: { review: TaskReview }) {
  const actionColor = review.action === "approved" ? "text-emerald-400" : review.action === "changes_requested" ? "text-orange-400" : "text-slate-400";
  const actionLabel = review.action === "approved" ? "Approved" : review.action === "changes_requested" ? "Changes Requested" : review.action === "reassigned" ? "Reassigned" : "Pending";

  return (
    <div className="rounded-xl border border-white/[.06] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <RoundBadge round={review.round}/>
        <span className={`text-xs font-medium ${review.status === "pending" ? "text-blue-400" : actionColor}`}>
          {review.status === "pending" ? "Pending" : actionLabel}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Avatar name={review.sent_by_name} size={6}/>
        <div>
          <p className="text-xs text-slate-400">Sent by <span className="text-white">{review.sent_by_name}</span></p>
          <p className="text-[11px] text-slate-600">{new Date(review.sent_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      </div>

      {review.context && (
        <div className="rounded-lg bg-white/[.03] border border-white/[.04] px-3 py-2">
          <p className="text-[11px] text-slate-500 mb-1">What to review</p>
          <p className="text-xs text-slate-300">{review.context}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Avatar name={review.reviewer_name} size={6}/>
        <div>
          <p className="text-xs text-slate-400">Reviewer: <span className="text-white">{review.reviewer_name}</span></p>
          {review.action_at && <p className="text-[11px] text-slate-600">{new Date(review.action_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
        </div>
      </div>

      {review.action_note && (
        <div className={`rounded-lg px-3 py-2 border ${review.action === "approved" ? "bg-emerald-500/5 border-emerald-500/20" : "bg-orange-500/5 border-orange-500/20"}`}>
          <p className={`text-xs ${review.action === "approved" ? "text-emerald-400" : "text-orange-400"}`}>{review.action_note}</p>
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
    onSuccess: () => { reviewsQ.refetch(); onUpdate(); setScreen("idle"); setActionNote(""); }
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
          <h3 className="text-sm font-semibold text-white">Send for Review</h3>
          <button onClick={() => setScreen("idle")} className="text-xs text-slate-500 hover:text-white">Cancel</button>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1.5 block">What needs to be reviewed? *</label>
          <textarea value={context} onChange={e => setContext(e.target.value)} rows={3} autoFocus
            placeholder="e.g. Please check the pricing section and verify the client requirements are met..."
            className="w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none resize-none focus:border-white/20"/>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1.5 block">Choose reviewer *</label>
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {members.map(m => (
              <button key={m.user_id} onClick={() => setSelectedReviewer(m)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors ${selectedReviewer?.user_id === m.user_id ? "border-white/20 bg-white/[.06]" : "border-white/[.06] hover:border-white/10 hover:bg-white/[.03]"}`}>
                <Avatar name={m.name || m.email}/>
                <span className="flex-1 text-sm text-slate-200 text-left">{m.name || m.email}</span>
                {selectedReviewer?.user_id === m.user_id && <CheckCircle size={14} className="text-emerald-400 shrink-0"/>}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => context.trim() && selectedReviewer && sendReview.mutate()}
          disabled={!context.trim() || !selectedReviewer || sendReview.isPending}
          className="w-full h-10 rounded-xl bg-white text-sm font-medium text-black disabled:opacity-30 hover:bg-white/90 transition-colors">
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
          <h3 className="text-sm font-semibold text-white">Review Action</h3>
          <button onClick={() => setScreen("idle")} className="text-xs text-slate-500 hover:text-white">Back</button>
        </div>

        <div className="rounded-xl border border-white/[.06] p-4">
          <p className="text-xs text-slate-500 mb-1">Reviewing</p>
          <p className="text-sm text-white font-medium mb-3">{pendingReview.context}</p>
          <p className="text-xs text-slate-500">Sent by <span className="text-slate-300">{pendingReview.sent_by_name}</span></p>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1.5 block">Add a note (optional for approval, required for changes)</label>
          <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} rows={3}
            placeholder="Your feedback..."
            className="w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none resize-none focus:border-white/20"/>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => takeAction.mutate("approved")} disabled={takeAction.isPending}
            className="flex items-center justify-center gap-2 h-10 rounded-xl bg-emerald-600/90 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors">
            <CheckCircle size={15}/> Approve
          </button>
          <button onClick={() => actionNote.trim() && takeAction.mutate("changes_requested")} disabled={!actionNote.trim() || takeAction.isPending}
            className="flex items-center justify-center gap-2 h-10 rounded-xl bg-white/[.07] text-sm font-medium text-slate-300 hover:bg-white/[.10] border border-white/10 disabled:opacity-50 transition-colors">
            <AlertCircle size={15}/> Request Changes
          </button>
        </div>

        <button onClick={() => setScreen("reassign")}
          className="flex items-center justify-center gap-2 w-full h-9 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white hover:border-white/20 transition-colors">
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
          <h3 className="text-sm font-semibold text-white">Reassign Review</h3>
          <button onClick={() => setScreen("action")} className="text-xs text-slate-500 hover:text-white">Back</button>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1.5 block">Choose new reviewer</label>
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {members.filter(m => m.user_id !== userId).map(m => (
              <button key={m.user_id} onClick={() => setNewReviewer(m)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors ${newReviewer?.user_id === m.user_id ? "border-white/20 bg-white/[.06]" : "border-white/[.06] hover:border-white/10"}`}>
                <Avatar name={m.name || m.email}/>
                <span className="flex-1 text-sm text-slate-200 text-left">{m.name || m.email}</span>
                {newReviewer?.user_id === m.user_id && <CheckCircle size={14} className="text-emerald-400"/>}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1.5 block">Reason for reassigning (optional)</label>
          <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} rows={2}
            placeholder="Why are you reassigning this?"
            className="w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none resize-none"/>
        </div>

        <button onClick={() => newReviewer && reassign.mutate()} disabled={!newReviewer || reassign.isPending}
          className="flex items-center justify-center gap-2 w-full h-10 rounded-xl bg-white/[.07] border border-white/10 text-sm font-medium text-white disabled:opacity-30 hover:bg-white/[.10] transition-colors">
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
        <div className="rounded-xl border border-white/10 bg-white/[.02] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse"/>
              <span className="text-sm font-medium text-white">Pending Review</span>
            </div>
            <RoundBadge round={pendingReview.round}/>
          </div>

          <div className="flex items-center gap-2">
            <Avatar name={pendingReview.sent_by_name} size={6}/>
            <div>
              <p className="text-xs text-slate-400">Sent by <span className="text-white">{pendingReview.sent_by_name}</span></p>
              <p className="text-[11px] text-slate-600">{new Date(pendingReview.sent_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
            </div>
          </div>

          <div className="rounded-lg bg-white/[.03] border border-white/[.04] px-3 py-2">
            <p className="text-[11px] text-slate-500 mb-1">What to review</p>
            <p className="text-xs text-slate-300">{pendingReview.context}</p>
          </div>

          <div className="flex items-center gap-2">
            <Avatar name={pendingReview.reviewer_name} size={6}/>
            <p className="text-xs text-slate-400">Reviewer: <span className="text-white">{pendingReview.reviewer_name}</span></p>
          </div>

          {/* Reviewer actions */}
          {isReviewer && (
            <button onClick={() => setScreen("action")}
              className="w-full h-9 rounded-xl bg-white text-sm font-medium text-black hover:bg-white/90 transition-colors">
              Take Action →
            </button>
          )}

          {/* Owner can cancel */}
          {isOwner && !isReviewer && (
            <p className="text-xs text-slate-600 text-center">Waiting for {pendingReview.reviewer_name} to review</p>
          )}
        </div>
      )}

      {/* Review result */}
      {task.review_result && !pendingReview && (
        <div className={`rounded-xl border p-4 ${task.review_result === "approved" ? "border-emerald-500/20 bg-emerald-500/5" : "border-orange-500/20 bg-orange-500/5"}`}>
          <div className="flex items-center gap-2 mb-1">
            {task.review_result === "approved"
              ? <CheckCircle size={15} className="text-emerald-400"/>
              : <AlertCircle size={15} className="text-orange-400"/>}
            <span className={`text-sm font-medium ${task.review_result === "approved" ? "text-emerald-400" : "text-orange-400"}`}>
              {task.review_result === "approved" ? "Approved" : "Changes Requested"}
            </span>
          </div>
          <p className="text-xs text-slate-500">by {task.reviewer_name} · See Comments tab for details</p>
          {task.review_result === "changes_requested" && isOwner && (
            <button onClick={() => setScreen("send")}
              className="mt-3 flex items-center gap-1.5 text-xs text-white border border-white/10 rounded-lg px-3 py-1.5 hover:bg-white/[.05] transition-colors">
              <RotateCcw size={12}/> Resubmit for Review
            </button>
          )}
        </div>
      )}

      {/* Send for review button - only show if no pending and no result, or after approval */}
      {!pendingReview && (!task.review_result || task.review_result === "approved") && isOwner && (
        <button onClick={() => setScreen("send")}
          className="w-full h-10 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white hover:border-white/20 hover:bg-white/[.03] transition-colors">
          Send for Review →
        </button>
      )}

      {/* Review history */}
      {history.length > 0 && (
        <div>
          <p className="text-xs text-slate-600 uppercase tracking-wider mb-3">Review History</p>
          <div className="space-y-3">
            {history.map(r => <ReviewHistoryItem key={r.id} review={r}/>)}
          </div>
        </div>
      )}

      {reviews.length === 0 && !pendingReview && (
        <p className="text-sm text-slate-600 text-center py-6">No review history yet</p>
      )}
    </div>
  );
}
