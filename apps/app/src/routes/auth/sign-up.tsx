import { SignUp } from "@clerk/react";

export function SignUpPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#0b0d10] px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Free to start, no credit card
          </div>
          <h1 className="text-2xl font-semibold text-white">Create your account</h1>
          <p className="mt-2 text-sm text-slate-500">Your fully AI business OS</p>
        </div>
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          forceRedirectUrl="/onboarding/profile"
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "shadow-none border border-white/10 rounded-lg bg-[#111419] p-6",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
              logoBox: "hidden",
              badge: "hidden",
              socialButtonsBlockButton: "border border-white/10 rounded-md h-10 text-sm font-medium hover:bg-white/[.04]",
              formFieldInput: "border border-white/10 rounded-md h-10 px-3 text-sm bg-[#0b0d10]",
              formButtonPrimary: "bg-red-600 text-white rounded-md h-10 text-sm font-medium",
              footerActionLink: "text-red-400 hover:underline"
            }
          }}
        />
        <p className="mt-4 text-center text-xs text-slate-500">
          By signing up you agree to our <a href="/legal/terms" className="text-red-400 hover:underline">Terms</a> and <a href="/legal/privacy" className="text-red-400 hover:underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
