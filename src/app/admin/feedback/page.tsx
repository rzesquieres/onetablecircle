import { FeedbackInbox } from "./feedback-inbox";

export const metadata = { title: "Feedback · OneTableCircle" };

export default function FeedbackAdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
      <FeedbackInbox />
    </main>
  );
}
