import { SignIn } from "@clerk/react";
import { Logo } from "../../components/logo";

export function SignInPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-zinc-50 px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-4">
          <Logo size={44} />
          <div className="text-center">
            <h1 className="font-sans text-2xl font-semibold tracking-tight text-zinc-900">Welcome back</h1>
            <p className="mt-1.5 font-mono text-[13px] text-zinc-500">Sign in to your workspace</p>
          </div>
        </div>
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/home"
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
              identityPreviewText: "text-zinc-700 text-sm font-mono",
              formResendCodeLink: "text-indigo-600 hover:underline font-mono text-xs",
              alertText: "text-red-600 text-xs font-mono",
            }
          }}
        />
      </div>
    </div>
  );
}
