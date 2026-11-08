export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">OneTableCircle</h1>
        <p className="mt-2 text-lg text-zinc-600 dark:text-zinc-400">
          Order together, split fairly.
        </p>
      </div>
      <p className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        The project is set up and deployed. Features arrive in phases. Phase 1 adds
        login, table sessions, ordering and the delivery checklist.
      </p>
    </main>
  );
}
