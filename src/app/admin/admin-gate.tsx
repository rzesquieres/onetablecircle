"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Notice, Spinner } from "@/components/ui";
import { useUser } from "@/lib/use-user";

/** Shows children only to platform admins. (The database enforces this as well.) */
export function AdminGate({ children }: { children: ReactNode }) {
  const { isAdmin, loading, user } = useUser();
  if (loading) return <Spinner />;
  if (!user || !isAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="warn">This area is for OneTableCircle admins only.</Notice>
        <Link href="/" className="text-brand">Back to home</Link>
      </div>
    );
  }
  return <>{children}</>;
}

export const STATUS_STYLE: Record<string, string> = {
  draft: "bg-warn/15 text-warn",
  published: "bg-ok/15 text-ok",
  archived: "bg-muted text-ink-soft",
};
