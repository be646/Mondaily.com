import { useUser } from "@clerk/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function StepProfile() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.fullName ?? "");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  async function continueSetup() {
    setLoading(true);
    const [firstName, ...rest] = name.trim().split(/\s+/);
    await user?.update({ firstName, lastName: rest.join(" ") });
    localStorage.setItem("mondaily_job_title", title);
    navigate("/onboarding/workspace");
  }
  return (
    <section>
      <h1 className="text-2xl font-semibold">Your profile</h1><p className="mb-8 mt-1 text-sm text-slate-500">How should your teammates know you?</p>
      <div className="mb-6 grid h-16 w-16 place-items-center rounded-full bg-red-500/10 text-xl font-semibold text-red-400">{name.charAt(0).toUpperCase() || "?"}</div>
      <label className="mb-4 block text-sm">Full name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 outline-none focus:border-red-500/50" /></label>
      <label className="mb-8 block text-sm">Job title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Founder, Head of Sales..." className="mt-2 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 outline-none focus:border-red-500/50" /></label>
      <button onClick={continueSetup} disabled={!name.trim() || loading} className="h-10 w-full rounded-md bg-red-600 text-sm font-medium disabled:opacity-50">{loading ? "Saving..." : "Continue"}</button>
    </section>
  );
}
