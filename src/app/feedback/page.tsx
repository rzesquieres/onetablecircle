import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { FeedbackForm } from "./feedback-form";

export const metadata = {
  title: "Send feedback · OneTableCircle",
  description: "Tell us what's working, what isn't, and what you'd like next.",
};

export default function FeedbackPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <Suspense fallback={<Spinner />}>
        <FeedbackForm />
      </Suspense>
    </main>
  );
}
