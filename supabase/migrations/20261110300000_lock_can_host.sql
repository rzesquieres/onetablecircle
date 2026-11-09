-- OneTableCircle — only signed-in people (including guests) can ask "may I host?"
--
-- How to apply: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.
--
-- New functions are callable by everyone by default; can_host() didn't need
-- to be, and calling it signed-out revealed whether the app is invite-only.

revoke execute on function public.can_host() from public, anon;
grant execute on function public.can_host() to authenticated;
