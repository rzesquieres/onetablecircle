import { AdminHome } from "./admin-home";

export const metadata = { title: "Admin · OneTableCircle" };

export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
      <AdminHome />
    </main>
  );
}
