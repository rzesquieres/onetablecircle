/**
 * Running balances across meals in a saved Circle (OTC-34). Pure functions,
 * integer centavos only.
 *
 * At each table everyone pays the host (who paid the restaurant). An unpaid
 * share is a debt from that person to the host. Recorded settle-ups
 * ("Ana paid Ben ₱340") cancel debts. Only Circle members count: people at a
 * table who aren't in the Circle are left out.
 */

export interface LedgerMember {
  id: string;
  name: string;
}

export interface LedgerTable {
  sessionId: string;
  title: string;
  /** When the bill was sent (ISO). */
  date: string;
  /** The Circle member who hosted (paid the restaurant), or null if the host isn't in the Circle. */
  hostMemberId: string | null;
  shares: { memberId: string; total: number; paid: boolean }[];
}

export interface LedgerSettlement {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  createdAt: string;
  note: string;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface HistoryEntry {
  kind: "meal" | "settle";
  date: string;
  title: string;
  /** For this member: positive = they're owed more, negative = they owe more. */
  amount: number;
  sessionId?: string;
  settlementId?: string;
}

export interface Ledger {
  /** Net per member: positive = is owed, negative = owes. Adds up to zero. */
  balances: Record<string, number>;
  /** Who owes whom directly, each pair netted (free). */
  pairs: Transfer[];
  /** The fewest transfers that settle everyone (Circle Plus). */
  simplified: Transfer[];
  /** Per member, newest first: the meals and settle-ups behind their balance (Circle Plus). */
  history: Record<string, HistoryEntry[]>;
}

export function computeLedger(members: LedgerMember[], tables: LedgerTable[], settlements: LedgerSettlement[]): Ledger {
  const ids = new Set(members.map((m) => m.id));
  const order = new Map(members.map((m, i) => [m.id, i]));
  const balances: Record<string, number> = Object.fromEntries(members.map((m) => [m.id, 0]));
  const history: Record<string, HistoryEntry[]> = Object.fromEntries(members.map((m) => [m.id, []]));
  // owed[a][b]: how much a owes b, before netting the pair.
  const owed = new Map<string, Map<string, number>>();
  const addDebt = (from: string, to: string, amount: number) => {
    if (!owed.has(from)) owed.set(from, new Map());
    const row = owed.get(from)!;
    row.set(to, (row.get(to) ?? 0) + amount);
  };

  for (const t of tables) {
    const host = t.hostMemberId;
    if (!host || !ids.has(host)) continue;
    let hostGets = 0;
    for (const s of t.shares) {
      if (s.paid || s.total <= 0 || s.memberId === host || !ids.has(s.memberId)) continue;
      addDebt(s.memberId, host, s.total);
      balances[s.memberId] -= s.total;
      hostGets += s.total;
      history[s.memberId].push({ kind: "meal", date: t.date, title: t.title, amount: -s.total, sessionId: t.sessionId });
    }
    if (hostGets) {
      balances[host] += hostGets;
      history[host].push({ kind: "meal", date: t.date, title: t.title, amount: hostGets, sessionId: t.sessionId });
    }
  }

  for (const s of settlements) {
    if (!ids.has(s.fromMemberId) || !ids.has(s.toMemberId) || s.amount <= 0 || s.fromMemberId === s.toMemberId) continue;
    // Paying someone cancels what you owe them (or puts them in your debt).
    addDebt(s.toMemberId, s.fromMemberId, s.amount);
    balances[s.fromMemberId] += s.amount;
    balances[s.toMemberId] -= s.amount;
    const title = s.note || "Settled up";
    history[s.fromMemberId].push({ kind: "settle", date: s.createdAt, title, amount: s.amount, settlementId: s.id });
    history[s.toMemberId].push({ kind: "settle", date: s.createdAt, title, amount: -s.amount, settlementId: s.id });
  }

  const pairs: Transfer[] = [];
  const sorted = [...ids].sort((a, b) => order.get(a)! - order.get(b)!);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const net = (owed.get(a)?.get(b) ?? 0) - (owed.get(b)?.get(a) ?? 0);
      if (net > 0) pairs.push({ from: a, to: b, amount: net });
      else if (net < 0) pairs.push({ from: b, to: a, amount: -net });
    }
  }

  for (const id of ids) history[id].sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  return { balances, pairs, simplified: simplify(balances, order), history };
}

/**
 * Settle net balances with as few transfers as a simple greedy method gives:
 * the biggest debtor pays the biggest creditor, repeatedly. At most n - 1
 * transfers. Ties go to whoever is first in the Circle, so results are stable.
 */
export function simplify(balances: Record<string, number>, order?: Map<string, number>): Transfer[] {
  const rank = (id: string) => order?.get(id) ?? 0;
  const owe = Object.entries(balances)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, left: -v }));
  const get = Object.entries(balances)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, left: v }));
  const byLeft = (a: { id: string; left: number }, b: { id: string; left: number }) => b.left - a.left || rank(a.id) - rank(b.id);
  const out: Transfer[] = [];
  for (;;) {
    owe.sort(byLeft);
    get.sort(byLeft);
    const d = owe[0];
    const c = get[0];
    if (!d || !c || d.left === 0 || c.left === 0) break;
    const amount = Math.min(d.left, c.left);
    out.push({ from: d.id, to: c.id, amount });
    d.left -= amount;
    c.left -= amount;
  }
  return out;
}
