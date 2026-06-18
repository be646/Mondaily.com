import { SignIn } from "@clerk/react";
import { useLayoutEffect } from "react";
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

export function SignInPage() {
  useLightAuthTheme();

  return (
    <div className="min-h-screen bg-[#f4f5f8] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-8">
          <Logo size={40} />
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your workspace</p>
        </div>

        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/home"
          forceRedirectUrl="/home"
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
