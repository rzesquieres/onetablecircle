"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Notice, Spinner } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase/client";

export function JoinTable() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .rpc("join_session", { p_code: code })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(friendlyError(error));
        else router.replace(`/s/${data}`);
      });
    return () => {
      cancelled = true;
    };
  }, [code, router]);

  if (!error) return <Spinner label="Joining table…" />;
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="error">{error}</Notice>
      <Link href="/" className="text-brand">Back to home</Link>
    </div>
  );
}
