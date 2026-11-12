/**
 * Test harness: runs every migration (in order) against an in-memory
 * Postgres (PGlite) with a minimal stand-in for Supabase's `auth` schema.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role supabase_auth_admin nologin;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}',
    is_anonymous boolean not null default false,
    created_at timestamptz not null default now(),
    last_sign_in_at timestamptz,
    banned_until timestamptz
  );
  create table auth.sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade
  );
  create table auth.refresh_tokens (
    id bigint generated always as identity primary key,
    user_id varchar(255),
    session_id uuid references auth.sessions (id) on delete cascade
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;
  grant execute on function auth.uid() to anon, authenticated;
  grant execute on function auth.jwt() to anon, authenticated;
  create publication supabase_realtime;
  -- Minimal Supabase Storage tables (enough for bucket rows and policies).
  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text not null, owner uuid
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to authenticated;
  -- Supabase grants table access to these roles by default; mimic that so
  -- the migrations' explicit revokes are actually tested.
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(readFileSync(MIGRATIONS_DIR + file, "utf8"));
  }
  // Earlier phases' tests create new users freely; the invite-only tests turn it back on.
  await db.exec("update public.app_config set invite_only = false");
  return db;
}

export interface Actor {
  id: string;
  anonymous?: boolean;
}

/** Run `fn` as a signed-in user (role `authenticated`), optionally an anonymous guest. */
export async function as<T>(db: PGlite, actor: Actor | string, fn: () => Promise<T>): Promise<T> {
  const a = typeof actor === "string" ? { id: actor } : actor;
  const claims = JSON.stringify({ sub: a.id, role: "authenticated", is_anonymous: Boolean(a.anonymous) });
  await db.query(
    `select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`,
    [a.id, claims],
  );
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec(
      "reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false);",
    );
  }
}

/** Run `fn` with no session at all (role `anon`, like a visitor who isn't signed in). */
export async function asVisitor<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role anon");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
