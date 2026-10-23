-- Run this in Supabase: Dashboard → SQL → New query → paste all → Run
-- Stores each player's rank/tag and shows it on avatars.

alter table public.profiles
    add column if not exists rank text;

alter table public.profiles
    drop constraint if exists profiles_rank_check;

alter table public.profiles
    add constraint profiles_rank_check
    check (
        rank is null
        or rank in ('verified', 'player', 'studio_dev', 'admin')
    );

comment on column public.profiles.rank is
    'Player tag: verified | player | studio_dev | admin. Set in SQL; users cannot change their own rank.';

-- Keep players from assigning themselves a rank from the website.
create or replace function public.protect_profile_rank()
returns trigger
language plpgsql
as $$
begin
    -- SQL editor / service role can set ranks. Website users cannot.
    if current_user not in ('authenticated', 'anon') then
        return new;
    end if;

    if tg_op = 'INSERT' then
        new.rank := null;
    elsif tg_op = 'UPDATE' and new.rank is distinct from old.rank then
        new.rank := old.rank;
    end if;
    return new;
end;
$$;

drop trigger if exists protect_profile_rank on public.profiles;

create trigger protect_profile_rank
    before insert or update on public.profiles
    for each row
    execute function public.protect_profile_rank();

create or replace function public.get_public_profile(lookup text)
returns json
language sql
stable
security definer
set search_path = public
as $$
    select json_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'rank', p.rank
    )
    from public.profiles p
    where p.verified = true
      and (
          lower(p.username) = lower(trim(lookup))
          or p.id::text = trim(lookup)
      )
    limit 1;
$$;

grant execute on function public.get_public_profile(text) to anon, authenticated;

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

-- Assign ranks from the SQL editor (examples):
-- update public.profiles set rank = 'admin' where username = '#YourUsername';
-- update public.profiles set rank = 'verified' where username = '#Someone';
-- update public.profiles set rank = 'player' where username = '#Someone';
-- update public.profiles set rank = 'studio_dev' where username = '#Someone';
-- update public.profiles set rank = null where username = '#Someone';
