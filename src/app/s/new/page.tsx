import { NewTableForm } from "./new-table-form";

export const metadata = { title: "Start a table · OneTableCircle" };

export default function NewTablePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <h1 className="text-2xl font-semibold">Start a table</h1>
      <NewTableForm />
    </main>
  );
}
