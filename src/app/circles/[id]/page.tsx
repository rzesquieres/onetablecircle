import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { CircleScreen } from "./circle-screen";

export const metadata = { title: "Circle balances · OneTableCircle" };

export default function CirclePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <Suspense fallback={<Spinner label="Loading balances…" />}>
        <CircleScreen />
      </Suspense>
    </main>
  );
}
