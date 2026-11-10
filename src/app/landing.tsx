import Link from "next/link";
import type { ReactNode } from "react";
import { allocate } from "@/lib/bill";
import { formatMoney } from "@/lib/money";

/*
 * Signed-out landing page. The hero is a top-down drawing of a round table:
 * one shared dish in the middle, split three ways with the app's real
 * allocate(), so the amounts shown are exactly what the app would charge.
 */

const DISH = { name: "Crispy pata", price: 89500 };

// Angles in degrees, clockwise from 3 o'clock (SVG coordinates).
const SEATS = [
  { name: "Mia", angle: -120, shares: true },
  { name: "Jo", angle: -60, shares: true },
  { name: "Ana", angle: 25, shares: false },
  { name: "Bea", angle: 110, shares: false },
  { name: "Ron", angle: 180, shares: true },
];

const CX = 160;
const CY = 155;
const TABLE_R = 110;
const SEAT_ORBIT = 133;
const SEAT_R = 21;
const DISH_R = 42;
const CHIP_AT = 78;

function polar(r: number, angle: number) {
  const a = (angle * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

function TableDiagram() {
  const sharers = SEATS.filter((s) => s.shares);
  const shares = allocate(DISH.price, sharers.map(() => 1));
  let k = 0;

  return (
    <figure className="mx-auto w-full max-w-[20rem] md:max-w-[28rem]">
      <svg
        viewBox="0 0 320 310"
        className="w-full"
        role="img"
        aria-label={`${DISH.name}, ${formatMoney(DISH.price)}, shared by ${sharers.map((s) => s.name).join(", ")}: ${shares
          .map((c) => formatMoney(c))
          .join(", ")}.`}
      >
        <circle cx={CX} cy={CY} r={TABLE_R} className="fill-muted stroke-line" strokeWidth={1.5} />

        {SEATS.map((seat) => {
          if (!seat.shares) return null;
          const i = k++;
          const from = polar(DISH_R + 4, seat.angle);
          const to = polar(SEAT_ORBIT - SEAT_R - 4, seat.angle);
          const chip = polar(CHIP_AT, seat.angle);
          return (
            <g key={seat.name}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                pathLength={1}
                className="otc-draw stroke-brand"
                strokeWidth={2.5}
                strokeLinecap="round"
                style={{ animationDelay: `${300 + i * 140}ms` }}
              />
              <g className="otc-pop" style={{ animationDelay: `${800 + i * 140}ms` }}>
                <rect x={chip.x - 34} y={chip.y - 12} width={68} height={24} rx={12} className="fill-brand" />
                <text
                  x={chip.x}
                  y={chip.y + 4.5}
                  textAnchor="middle"
                  className="fill-white text-[12.5px] font-semibold tabular-nums"
                >
                  {formatMoney(shares[i])}
                </text>
              </g>
            </g>
          );
        })}

        <circle cx={CX} cy={CY} r={DISH_R} className="fill-surface stroke-line" strokeWidth={1.5} />
        <text x={CX} y={CY - 3} textAnchor="middle" className="fill-ink-soft text-[11.5px]">
          {DISH.name}
        </text>
        <text x={CX} y={CY + 14} textAnchor="middle" className="fill-ink text-[14px] font-bold tabular-nums">
          {formatMoney(DISH.price)}
        </text>

        {SEATS.map((seat) => {
          const p = polar(SEAT_ORBIT, seat.angle);
          return (
            <g key={seat.name}>
              <circle
                cx={p.x}
                cy={p.y}
                r={SEAT_R}
                className={seat.shares ? "fill-surface stroke-brand" : "fill-surface stroke-line"}
                strokeWidth={seat.shares ? 2.5 : 1.5}
              />
              <text
                x={p.x}
                y={p.y + 4.5}
                textAnchor="middle"
                className={`text-[13px] font-semibold ${seat.shares ? "fill-ink" : "fill-ink-soft"}`}
              >
                {seat.name}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 text-center text-sm text-ink-soft">
        Mia, Jo and Ron shared the crispy pata. The extra centavo goes to one of them, so the shares add up exactly.
      </figcaption>
    </figure>
  );
}

const STEPS = [
  {
    title: "Start a table",
    text: "Pick the restaurant and open a table. You get a QR code and a link to share.",
  },
  {
    title: "Everyone orders from their own phone",
    text: "Friends join with just their name and add what they want. You get one clean list to read to the waiter, and you can tick items off as they arrive.",
  },
  {
    title: "Split the bill",
    text: "Mark which dishes were shared. The app works out each person's share, with VAT and service charge included.",
  },
];

const SETTLE = [
  { from: "Mia", amount: 124000 },
  { from: "Jo", amount: 98650 },
  { from: "Ana", amount: 110525 },
  { from: "Bea", amount: 53225 },
];

function SettledBill() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 md:p-6">
      <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-line pb-3">
        <span className="font-semibold">Ron paid the bill</span>
        <span className="font-semibold tabular-nums">{formatMoney(486200)}</span>
      </div>
      <ul className="divide-y divide-dashed divide-line">
        {SETTLE.map((row) => (
          <li key={row.from} className="flex items-baseline justify-between gap-3 py-3">
            <span>
              {row.from} pays <span className="font-semibold">Ron</span>
            </span>
            <span className="font-semibold tabular-nums">{formatMoney(row.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-dashed border-line pt-3 text-sm text-ink-soft">
        Includes 10% service charge, split in proportion to what each person ordered.
      </p>
    </div>
  );
}

export function Landing({ joinForm }: { joinForm: ReactNode }) {
  return (
    <div className="font-display">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 pt-4 md:px-8">
        <span className="text-lg font-bold tracking-tight">OneTableCircle</span>
        <nav className="flex items-center gap-1">
          <Link href="/pricing" className="inline-flex min-h-11 items-center px-3 text-sm text-ink-soft">
            Pricing
          </Link>
          <Link href="/login" className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-brand">
            Sign in
          </Link>
        </nav>
      </header>

      {/* Phone: headline, table drawing, then actions. Desktop: text left, drawing right. */}
      <section className="mx-auto grid w-full max-w-5xl gap-6 px-4 pt-6 pb-12 md:grid-cols-2 md:grid-rows-[auto_auto] md:gap-x-12 md:gap-y-6 md:px-8 md:pt-14 md:pb-20">
        <div className="md:self-end">
          <h1 className="text-[2.6rem] leading-[1.02] font-extrabold tracking-[-0.03em] text-balance md:text-[4rem]">
            Share the dishes. Split the bill to the centavo.
          </h1>
          <p className="mt-4 max-w-[34ch] text-lg text-ink-soft">
            Your group orders together from their own phones, and everyone sees exactly what they owe.
          </p>
        </div>
        <div className="md:col-start-2 md:row-span-2 md:row-start-1 md:self-center">
          <TableDiagram />
        </div>
        <div className="flex flex-col gap-6">
          <Link
            href="/login"
            className="inline-flex min-h-14 items-center justify-center rounded-xl bg-brand px-6 text-lg font-semibold text-white active:bg-brand-strong md:self-start"
          >
            Start a table
          </Link>
          <div className="max-w-sm">
            <p className="mb-2 text-sm text-ink-soft">Got a table code from a friend? You don&apos;t need an account.</p>
            {joinForm}
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-12 md:px-8 md:py-16">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">How it works</h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4 md:flex-col md:gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-brand font-bold text-brand tabular-nums">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-lg font-semibold leading-snug">{step.title}</span>
                  <span className="mt-1 block text-ink-soft">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl items-center gap-8 px-4 py-12 md:grid-cols-2 md:gap-12 md:px-8 md:py-16">
        <div>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Settle up in one step</h2>
          <p className="mt-3 max-w-[38ch] text-ink-soft">
            When the bill comes, one person pays the waiter. Everyone else sees one line: who to pay, and how much.
          </p>
        </div>
        <SettledBill />
      </section>
    </div>
  );
}
