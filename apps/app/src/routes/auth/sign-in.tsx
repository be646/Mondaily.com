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
              footer: { "& .cl-internal-wkkub3": { display: "none" } },
            },
          }}
        />
      </div>
    </div>
  );
}
