import Link from "next/link";
import { YouTubeChannelLink } from "@/components/youtube-link";
import { HomeScreen } from "./home-screen";

export default function Home() {
  return (
    <main className="flex w-full flex-1 flex-col">
      <HomeScreen />
      <footer className="mx-auto mt-auto w-full max-w-5xl px-4 pt-10 pb-8 text-center text-xs text-ink-soft md:px-8">
        <Link href="/pricing" className="underline">Pricing</Link> ·{" "}
        <Link href="/terms" className="underline">Terms of Service</Link> ·{" "}
        <Link href="/privacy" className="underline">Privacy Policy</Link> ·{" "}
        <YouTubeChannelLink />
      </footer>
    </main>
  );
}
