import { Suspense } from "react";
import Link from "next/link";
import { Spinner } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · OneTableCircle" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-ink-soft">to start or join a table.</p>
      <Suspense fallback={<Spinner />}>
        <LoginForm />
      </Suspense>
      <p className="mt-auto pt-10 text-center text-xs text-ink-soft">
        By continuing you agree to how we handle your information in our{" "}
        <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </main>
  );
}
