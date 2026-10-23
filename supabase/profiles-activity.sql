-- Run this in Supabase: Dashboard → SQL → New query → paste all → Run
-- Needed for the Profiles page (most active users + search)

alter table public.profiles add column if not exists visit_count integer default 0 not null;
alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.record_profile_activity()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        return;
    end if;

    update public.profiles
    set
        visit_count = visit_count + 1,
        last_seen_at = now()
    where id = auth.uid()
      and verified = true;
end;
$$;

grant execute on function public.record_profile_activity() to authenticated;

create or replace function public.list_active_profiles(search_query text default '', result_limit integer default 24)
returns json
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(json_agg(row_to_json(t)), '[]'::json)
    from (
        select
            p.id,
            p.username,
            p.display_name,
            p.avatar_url,
            p.rank,
            p.visit_count,
            p.last_seen_at
        from public.profiles p
        where p.verified = true
          and (
              search_query is null
              or trim(search_query) = ''
              or lower(p.username) like '%' || lower(trim(search_query)) || '%'
              or lower(p.display_name) like '%' || lower(trim(search_query)) || '%'
          )
        order by
            p.visit_count desc,
            p.last_seen_at desc nulls last,
            p.created_at desc
        limit greatest(1, least(result_limit, 50))
    ) t;
$$;

grant execute on function public.list_active_profiles(text, integer) to anon, authenticated;
