import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Set a new password · OneTableCircle" };

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <h1 className="text-2xl font-semibold">Set a new password</h1>
      <ResetPasswordForm />
    </main>
  );
}
