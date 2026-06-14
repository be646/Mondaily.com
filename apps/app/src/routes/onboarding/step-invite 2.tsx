import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/api-client";

export function StepInvite() {
  const navigate = useNavigate();
  const [emails, setEmails] = useState([""]);
  const [role, setRole] = useState("member");
  const [sent, setSent] = useState(false);
  async function sendInvites() {
    const valid = emails.filter((email) => email.includes("@"));
    await Promise.all(valid.map((email) => apiClient.post("/invites", { email, role })));
    setSent(true);
  }
  if (sent) return <section className="text-center"><h1 className="text-2xl font-semibold">Invitations sent</h1><p className="mb-8 mt-2 text-sm text-slate-500">Your team can join securely from their invitation links.</p><button onClick={() => navigate("/onboarding/import")} className="rounded-md bg-red-600 px-6 py-2 text-sm font-medium">Continue</button></section>;
  return (
    <section>
      <h1 className="text-2xl font-semibold">Invite your team</h1><p className="mb-7 mt-1 text-sm text-slate-500">Add teammates now or continue on your own.</p>
      <label className="mb-4 block text-sm">Role<select value={role} onChange={(event) => setRole(event.target.value)} className="ml-3 rounded-md border border-white/10 bg-[#0b0d10] px-3 py-2"><option value="member">Member</option><option value="admin">Admin</option></select></label>
      <div className="space-y-2">{emails.map((email, index) => <div key={index} className="flex gap-2"><input value={email} onChange={(event) => setEmails((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="colleague@company.com" className="h-10 flex-1 rounded-md border border-white/10 bg-transparent px-3 text-sm" />{emails.length > 1 ? <button onClick={() => setEmails((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid w-10 place-items-center rounded-md border border-white/10"><X size={14} /></button> : null}</div>)}</div>
      <button onClick={() => setEmails((current) => [...current, ""])} className="my-6 flex items-center gap-1 text-sm text-slate-400"><Plus size={14} /> Add another</button>
      <div className="flex gap-3"><button onClick={sendInvites} disabled={!emails.some((email) => email.includes("@"))} className="h-10 flex-1 rounded-md bg-red-600 text-sm font-medium disabled:opacity-50">Send invites</button><button onClick={() => navigate("/onboarding/import")} className="rounded-md border border-white/10 px-4 text-sm">Skip</button></div>
    </section>
  );
}
