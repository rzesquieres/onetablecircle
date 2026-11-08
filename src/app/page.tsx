import { HomeScreen } from "./home-screen";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">OneTableCircle</h1>
      <p className="mt-1 text-ink-soft">Order together, split fairly.</p>
      <HomeScreen />
    </main>
  );
}
