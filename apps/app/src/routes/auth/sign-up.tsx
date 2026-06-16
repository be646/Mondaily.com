import { SignUp } from "@clerk/react";
import { Logo } from "../../components/logo";

export function SignUpPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-zinc-50 px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-4">
          <Logo size={44} />
          <div className="text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-black/[.06] bg-white px-3 py-1 font-mono text-xs text-zinc-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Free to start · no credit card
            </div>
            <h1 className="font-sans text-2xl font-semibold tracking-tight text-zinc-900">Create your account</h1>
            <p className="mt-1.5 font-mono text-[13px] text-zinc-500">Your fully AI business OS</p>
          </div>
        </div>
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          forceRedirectUrl="/onboarding/profile"
          appearance={{
            variables: {
              colorPrimary: "#4f46e5",
              colorBackground: "#ffffff",
              colorText: "#18181b",
              colorTextSecondary: "#71717a",
              colorInputBackground: "#ffffff",
              colorInputText: "#18181b",
              colorNeutral: "#18181b",
              borderRadius: "0.75rem",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "13px",
            },
            elements: {
              card: "shadow-none border border-black/[.08] bg-white",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
              logoBox: "hidden",
              badge: "hidden",
            },
          }}
        />
        <p className="mt-4 text-center font-mono text-xs text-zinc-400">
          By signing up you agree to our{" "}
          <a href="https://mondaily.com/legal/terms" className="text-indigo-600 hover:underline">Terms</a>{" "}
          and{" "}
          <a href="https://mondaily.com/legal/privacy" className="text-indigo-600 hover:underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
