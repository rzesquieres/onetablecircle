import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { TableScreen } from "./table-screen";

export const metadata = { title: "Table · OneTableCircle" };

export default function TablePage() {
  return (
    <Suspense fallback={<Spinner label="Loading table…" />}>
      <TableScreen />
    </Suspense>
  );
}
