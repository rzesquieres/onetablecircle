import { CirclesList } from "./circles-list";

export const metadata = { title: "Circles · OneTableCircle" };

export default function CirclesPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <CirclesList />
    </main>
  );
}
