import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { JoinTable } from "./join-table";

export const metadata = { title: "Join table · OneTableCircle" };

export default function JoinPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <Suspense fallback={<Spinner label="Joining table…" />}>
        <JoinTable />
      </Suspense>
    </main>
  );
}
