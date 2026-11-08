import { ReportsList } from "./reports-list";

export const metadata = { title: "Problem reports · OneTableCircle" };

export default function ReportsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
      <ReportsList />
    </main>
  );
}
