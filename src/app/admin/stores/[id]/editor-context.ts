import { parseMoney } from "@/lib/money";
import type { Menu } from "@/lib/types";

/** What every section of the store editor gets. */
export interface EditorProps {
  menu: Menu;
  /** Run a Supabase write, show any error, then reload the menu. Returns true on success. */
  act: (action: PromiseLike<{ error: unknown }>) => Promise<boolean>;
  reload: () => Promise<void>;
}

/** Price box text -> centavos ("" counts as 0). Null if it isn't a valid amount. */
export function pesoInput(text: string): number | null {
  return text.trim() ? parseMoney(text) : 0;
}

/** centavos -> "180" or "180.50" for an input box. */
export { moneyInputText as pesoText } from "@/lib/money";
