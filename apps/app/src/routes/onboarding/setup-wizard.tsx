import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { AuthShell, GlowButton, SAGE } from "../../components/auth/auth-shell";
import { apiClient } from "../../lib/api-client";

type Track = "solo" | "business";

const TRACKS: { id: Track; title: string; subtitle: string }[] = [
  { id: "solo", title: "Personal / Solo Operator", subtitle: "Free forever · 50,000 AI credits" },
  { id: "business", title: "Business / Corporate Group", subtitle: "14-day Pro trial · 500,000 AI credits" },
];

const INDUSTRIES = ["Technology", "Real Estate", "Finance", "Professional Services", "Healthcare", "Retail", "Other"];
const TEAM_SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"];
const GOALS = ["Find leads", "Manage deals", "Automate tasks", "Track finances", "Team collaboration"];

const SELECT_CLS =
  "w-full appearance-none rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-[13px] text-zinc-100 outline-none transition-colors focus:border-[#8fcf7f]";

const stepVariants = {
  enter: { opacity: 0, x: 16 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
};

export function SetupWizardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [track, setTrack] = useState<Track | null>(null);
  const [industry, setIndustry] = useState<string>(INDUSTRIES[0] ?? "Other");
  const [teamSize, setTeamSize] = useState<string>(TEAM_SIZES[0] ?? "Just me");
  const [goals, setGoals] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleGoal(goal: string) {
    setGoals(prev => (prev.includes(goal) ? prev.filter(g => g !== goal) : [...prev, goal]));
  }

  async function complete() {
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post("/onboarding/complete", { track, industry, team_size: teamSize, goals });
      localStorage.removeItem("mondaily_needs_onboarding");
      navigate("/home");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      kicker={`Step ${step} of 3`}
      title={step === 1 ? "Choose your track" : step === 2 ? "Tell us about your work" : "You're all set"}
      subtitle={
        step === 1
          ? "How will you be running Mondaily?"
          : step === 2
            ? "We'll tune the workspace to fit."
            : "Review and launch your Neural Operation Center."
      }
    >
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="step1" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.22 }}>
            <div className="space-y-3">
              {TRACKS.map(t => {
                const selected = track === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTrack(t.id)}
                    className={`w-full rounded-xl border px-4 py-3.5 text-left transition-all ${
                      selected ? "border-[#8fcf7f]" : "border-zinc-800 hover:border-zinc-700"
                    }`}
                    style={selected ? { boxShadow: `0 0 18px ${SAGE}22`, background: `${SAGE}10` } : undefined}
                  >
                    <span className="block text-[13px] font-semibold text-zinc-100">{t.title}</span>
                    <span className="mt-1 block text-[11px] text-zinc-500">{t.subtitle}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-5">
              <GlowButton disabled={!track} onClick={() => setStep(2)}>
                Continue
              </GlowButton>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="step2" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.22 }}>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[10.5px] uppercase tracking-wider text-zinc-500">Industry</span>
                <select value={industry} onChange={e => setIndustry(e.target.value)} className={SELECT_CLS}>
                  {INDUSTRIES.map(opt => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10.5px] uppercase tracking-wider text-zinc-500">Team size</span>
                <select value={teamSize} onChange={e => setTeamSize(e.target.value)} className={SELECT_CLS}>
                  {TEAM_SIZES.map(opt => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <span className="mb-1.5 block text-[10.5px] uppercase tracking-wider text-zinc-500">Goals</span>
                <div className="flex flex-wrap gap-2">
                  {GOALS.map(goal => {
                    const on = goals.includes(goal);
                    return (
                      <button
                        key={goal}
                        onClick={() => toggleGoal(goal)}
                        className={`rounded-full border px-3 py-1.5 text-[11.5px] transition-all ${
                          on ? "border-[#8fcf7f] text-zinc-100" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
                        }`}
                        style={on ? { background: `${SAGE}12`, boxShadow: `0 0 12px ${SAGE}1f` } : undefined}
                      >
                        {goal}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setStep(1)}
                className="rounded-xl border border-zinc-800 px-4 py-2.5 text-[12.5px] font-semibold tracking-wide text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
              >
                Back
              </button>
              <div className="flex-1">
                <GlowButton onClick={() => setStep(3)}>Continue</GlowButton>
              </div>
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="step3" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.22 }}>
            <dl className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3.5 text-[12px]">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Track</dt>
                <dd className="text-right text-zinc-200">{track === "business" ? "Business / Corporate Group" : "Personal / Solo Operator"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Industry</dt>
                <dd className="text-right text-zinc-200">{industry}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Team size</dt>
                <dd className="text-right text-zinc-200">{teamSize}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Goals</dt>
                <dd className="text-right text-zinc-200">{goals.length ? goals.join(", ") : "—"}</dd>
              </div>
            </dl>

            {error && <p className="mt-3 text-[11px] text-rose-400">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setStep(2)}
                disabled={submitting}
                className="rounded-xl border border-zinc-800 px-4 py-2.5 text-[12.5px] font-semibold tracking-wide text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
              >
                Back
              </button>
              <div className="flex-1">
                <GlowButton loading={submitting} onClick={complete}>
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  Enter Mondaily
                </GlowButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
