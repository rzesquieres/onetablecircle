import { TestersAdmin } from "./testers-admin";

export const metadata = { title: "Testers · OneTableCircle" };

export default function TestersPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
      <TestersAdmin />
    </main>
  );
}
