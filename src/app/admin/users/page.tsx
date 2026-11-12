import { UsersAdmin } from "./users-admin";

export const metadata = { title: "Users · OneTableCircle" };

export default function UsersPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
      <UsersAdmin />
    </main>
  );
}
