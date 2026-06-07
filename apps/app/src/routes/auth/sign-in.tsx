import { SignIn } from "@clerk/react";

export function SignInPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#0b0d10] px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-3 text-sm font-semibold tracking-wide text-red-500">MONDAILY</div>
          <h1 className="text-2xl font-semibold text-white">Welcome to Mondaily</h1>
          <p className="mt-2 text-sm text-slate-500">Sign in to your workspace</p>
        </div>
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          forceRedirectUrl="/onboarding"
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "shadow-none border border-white/10 rounded-lg bg-[#111419] p-6",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
              socialButtonsBlockButton: "border border-white/10 rounded-md h-10 text-sm font-medium hover:bg-white/[.04]",
              dividerLine: "bg-white/10",
              dividerText: "text-slate-500 text-xs",
              formFieldInput: "border border-white/10 rounded-md h-10 px-3 text-sm bg-[#0b0d10]",
              formButtonPrimary: "bg-red-600 text-white rounded-md h-10 text-sm font-medium hover:bg-red-500",
              footerActionLink: "text-red-400 hover:underline"
            }
          }}
        />
      </div>
    </div>
  );
}
