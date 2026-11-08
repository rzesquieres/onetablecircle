import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { StoreEditor } from "./store-editor";

export const metadata = { title: "Edit store · OneTableCircle" };

export default function EditStorePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
      <Suspense fallback={<Spinner />}>
        <StoreEditor />
      </Suspense>
    </main>
  );
}
