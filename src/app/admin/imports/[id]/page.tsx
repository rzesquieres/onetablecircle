import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { ImportReview } from "./import-review";

export const metadata = { title: "Review AI import · OneTableCircle" };

export default function ImportReviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
      <Suspense fallback={<Spinner />}>
        <ImportReview />
      </Suspense>
    </main>
  );
}
