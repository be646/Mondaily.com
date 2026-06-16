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
          forceRedirectUrl="/onboarding-setup"
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "shadow-none border border-black/[.08] rounded-2xl bg-white p-6",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
              logoBox: "hidden",
              badge: "hidden",
              socialButtonsBlockButton: "border border-black/[.08] rounded-xl h-11 text-sm font-mono text-zinc-700 hover:bg-zinc-50 transition-colors",
              dividerLine: "bg-black/[.06]",
              dividerText: "text-zinc-400 text-xs font-mono",
              formFieldLabel: "text-zinc-600 text-xs font-mono mb-1",
              formFieldInput: "border border-black/[.08] rounded-xl h-11 px-4 text-sm bg-white text-zinc-900 font-mono outline-none focus:border-indigo-500/40 transition-colors",
              formButtonPrimary: "bg-indigo-600 text-white rounded-xl h-11 text-sm font-mono font-medium hover:bg-indigo-500 transition-colors",
              footerActionLink: "text-indigo-600 hover:underline font-mono text-xs",
              footerActionText: "text-zinc-500 font-mono text-xs",
              alertText: "text-red-600 text-xs font-mono",
            }
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
