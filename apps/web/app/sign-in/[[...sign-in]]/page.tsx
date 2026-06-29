import { redirect } from "next/navigation";

// Auth lives in the app (native sovereign auth). Bounce the legacy marketing route there.
export default function SignInPage() {
  redirect("https://app.mondaily.com/auth/shadow-login");
}
