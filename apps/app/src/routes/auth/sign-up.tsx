import { SignUp, useAuth } from "@clerk/react";
import { useEffect, useLayoutEffect } from "react";
import { Logo } from "../../components/logo";

function useLightAuthTheme() {
  useLayoutEffect(() => {
    const prev = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("dark");
    document.body.style.background = "#f4f5f8";
    document.body.style.color = "#0f172a";

    return () => {
      if (prev) document.documentElement.dataset.theme = prev;
      document.body.style.background = "";
      document.body.style.color = "";
    };
  }, []);
}

export function SignUpPage() {
  useLightAuthTheme();

  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      window.location.replace("/onboarding/profile");
    }
  }, [isLoaded, isSignedIn]);

  return (
    <div className="min-h-screen bg-[#f4f5f8] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-8">
          <Logo size={40} />
        </div>

        <div className="mb-6">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-black/[.08] bg-white px-3 py-1 text-xs text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Free to start · no credit card
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500">Your fully AI business OS</p>
        </div>

        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/onboarding/profile"
          forceRedirectUrl="/onboarding/profile"
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "w-full border border-black/[.08] shadow-none rounded-2xl",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
              socialButtonsBlockButton: "rounded-xl border border-black/[.08]",
              formButtonPrimary: "rounded-xl bg-indigo-600 hover:bg-indigo-500",
              formFieldInput: "rounded-xl border border-black/[.08]",
              footerActionLink: "text-indigo-600 hover:text-indigo-500",
            },
          }}
        />
      </div>
    </div>
  );
}
