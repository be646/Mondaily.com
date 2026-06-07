import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiClient } from "../../lib/api-client";
import { PageSkeleton } from "../ui/page-state";
import { NoteEditor } from "../notes/note-editor";

interface RecordDetailData { id: string; object_type: string; data: Record<string, unknown>; ai_summary?: string; activities?: { id: string; action: string; ai_summary?: string; created_at: string }[] }

export function RecordDetail({ recordId }: { recordId: string }) {
  const qc = useQueryClient();
  const [noteContent, setNoteContent] = useState("<p></p>");
  const query = useQuery({ queryKey: ["record", recordId], queryFn: () => apiClient.get<RecordDetailData>(`/nodes/${recordId}`) });
  const notes = useQuery({ queryKey: ["record-notes", recordId], queryFn: () => apiClient.get<{ id: string; content: string; author_name: string; created_at: string }[]>(`/notes?node_id=${recordId}`) });
  const addNote = useMutation({
    mutationFn: () => apiClient.post("/notes", { node_id: recordId, content: noteContent }),
    onSuccess: () => {
      setNoteContent("<p></p>");
      qc.invalidateQueries({ queryKey: ["record-notes", recordId] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });
  if (query.isLoading) return <div className="p-8"><PageSkeleton /></div>;
  if (!query.data) return <div className="p-8 text-sm text-slate-500">Record not found.</div>;
  const record = query.data;
  return <div className="grid gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[340px_1fr]"><aside className="rounded-lg border border-white/10 p-5"><p className="text-xs uppercase text-red-400">{record.object_type}</p><h1 className="mt-2 text-xl font-semibold">{String(record.data.name ?? record.data.title ?? record.id)}</h1><div className="mt-6 space-y-4">{Object.entries(record.data).map(([key, value]) => <div key={key}><p className="text-xs capitalize text-slate-600">{key.replaceAll("_", " ")}</p><p className="mt-1 break-words text-sm text-slate-300">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</p></div>)}</div></aside><section className="rounded-lg border border-white/10 p-5"><h2 className="text-sm font-semibold">AI summary</h2><p className="mt-3 text-sm leading-6 text-slate-400">{record.ai_summary || "Mondaily has not summarized this record yet."}</p><h2 className="mb-3 mt-8 text-sm font-semibold">Add note</h2><NoteEditor value={noteContent} onChange={setNoteContent} onSave={() => addNote.mutate()} saving={addNote.isPending} /><h2 className="mb-3 mt-8 text-sm font-semibold">Activity timeline</h2>{notes.data?.length ? <div className="space-y-3">{notes.data.map((note) => <div key={note.id} className="border-l border-white/10 pl-4"><p className="text-xs text-slate-500">{note.author_name} · {new Date(note.created_at).toLocaleString()}</p><div className="mt-1 text-sm text-slate-300" dangerouslySetInnerHTML={{ __html: note.content }} /></div>)}</div> : record.activities?.length ? <div className="space-y-3">{record.activities.map((activity) => <div key={activity.id} className="border-l border-white/10 pl-4"><p className="text-sm capitalize">{activity.action}</p><p className="mt-1 text-xs text-slate-500">{activity.ai_summary || new Date(activity.created_at).toLocaleString()}</p></div>)}</div> : <p className="text-sm text-slate-500">No activity recorded.</p>}</section></div>;
}
