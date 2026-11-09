import { Analytics } from "./analytics";

export const metadata = { title: "Analytics · OneTableCircle" };

export default function AnalyticsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
      <Analytics />
    </main>
  );
}
