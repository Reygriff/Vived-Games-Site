-- Run this in Supabase SQL Editor (Dashboard → SQL → New query)

create table if not exists public.profiles (
    id uuid references auth.users on delete cascade primary key,
    username text not null unique,
    display_name text not null,
    avatar_url text,
    verified boolean default false not null,
    created_at timestamptz default now() not null,
    constraint username_starts_with_hash check (username ~ '^#')
);

-- If profiles already exists without avatar_url, run:
-- alter table public.profiles add column if not exists avatar_url text;

alter table public.profiles enable row level security;

drop policy if exists "Anyone can read profiles" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Anyone can read profiles"
    on public.profiles for select
    using (true);

create policy "Users can insert own profile"
    on public.profiles for insert
    to authenticated
    with check (auth.uid() = id);

create policy "Users can update own profile"
    on public.profiles for update
    to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id);

create index if not exists profiles_username_idx on public.profiles (username);

-- Auto-create profile when auth user is created (bypasses RLS)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, username, display_name, verified)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'username', '#User'),
        coalesce(new.raw_user_meta_data->>'display_name', 'Player'),
        false
    )
    on conflict (id) do update set
        username = excluded.username,
        display_name = excluded.display_name;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Mark profile verified (called after email code check)
create or replace function public.mark_profile_verified(user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'You must be signed in to verify your account';
    end if;

    if auth.uid() <> user_id then
        raise exception 'Not authorized';
    end if;

    update public.profiles
    set verified = true
    where id = user_id;

    if not found then
        insert into public.profiles (id, username, display_name, verified)
        select
            u.id,
            coalesce(u.raw_user_meta_data->>'username', '#User'),
            coalesce(u.raw_user_meta_data->>'display_name', 'Player'),
            true
        from auth.users u
        where u.id = user_id;
    end if;
end;
$$;

grant execute on function public.mark_profile_verified(uuid) to authenticated;

-- Apply email change after EmailJS code verification (bypasses Supabase double-confirm)
create or replace function public.update_user_email(new_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    normalized_email text := lower(trim(new_email));
    uid uuid := auth.uid();
begin
    if uid is null then
        raise exception 'You must be signed in to change your email';
    end if;

    if normalized_email is null or length(normalized_email) < 5 or position('@' in normalized_email) = 0 then
        raise exception 'Invalid email address';
    end if;

    if exists (
        select 1 from auth.users
        where lower(email) = normalized_email
          and id <> uid
    ) then
        raise exception 'That email is already used by another account';
    end if;

    update auth.users
    set
        email = normalized_email,
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = uid;

    if not found then
        raise exception 'User not found';
    end if;

    -- MUST sync auth.identities or sign-in (grant_type=password) returns 500
    update auth.identities
    set
        provider_id = normalized_email,
        identity_data = jsonb_set(
            jsonb_set(
                coalesce(identity_data, '{}'::jsonb),
                '{email}',
                to_jsonb(normalized_email)
            ),
            '{email_verified}',
            'true'::jsonb
        ),
        updated_at = now()
    where user_id = uid
      and provider = 'email';

    if not found then
        insert into auth.identities (
            id,
            provider_id,
            user_id,
            identity_data,
            provider,
            last_sign_in_at,
            created_at,
            updated_at
        )
        values (
            gen_random_uuid(),
            normalized_email,
            uid,
            jsonb_build_object(
                'sub', uid::text,
                'email', normalized_email,
                'email_verified', true
            ),
            'email',
            now(),
            now(),
            now()
        );
    end if;

    begin
        update auth.users
        set email_change = null,
            email_change_token_new = null,
            email_change_token_current = null
        where id = uid;
    exception when undefined_column then
        null;
    end;
end;
$$;

grant execute on function public.update_user_email(text) to authenticated;

-- ONE-TIME FIX: run this if sign-in returns 500 after an email change
create or replace function public.repair_auth_email_identities()
returns integer
language plpgsql
security definer
set search_path = auth
as $$
declare
    fixed integer := 0;
    r record;
begin
    for r in
        select u.id as user_id, lower(u.email) as email
        from auth.users u
        where u.email is not null
          and length(trim(u.email)) > 0
    loop
        update auth.identities
        set
            provider_id = r.email,
            identity_data = jsonb_set(
                jsonb_set(
                    coalesce(identity_data, '{}'::jsonb),
                    '{email}',
                    to_jsonb(r.email)
                ),
                '{email_verified}',
                'true'::jsonb
            ),
            updated_at = now()
        where user_id = r.user_id
          and provider = 'email';

        if found then
            fixed := fixed + 1;
        else
            insert into auth.identities (
                id,
                provider_id,
                user_id,
                identity_data,
                provider,
                last_sign_in_at,
                created_at,
                updated_at
            )
            values (
                gen_random_uuid(),
                r.email,
                r.user_id,
                jsonb_build_object(
                    'sub', r.user_id::text,
                    'email', r.email,
                    'email_verified', true
                ),
                'email',
                now(),
                now(),
                now()
            );
            fixed := fixed + 1;
        end if;
    end loop;

    return fixed;
end;
$$;

-- Read real email from auth (JWT may still show old email until re-login)
create or replace function public.get_my_account_email()
returns text
language sql
stable
security definer
set search_path = auth
as $$
    select email from auth.users where id = auth.uid();
$$;

grant execute on function public.get_my_account_email() to authenticated;

-- Delete unverified accounts older than 24 hours (current signed-in user)
create or replace function public.delete_unverified_account_if_expired()
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if auth.uid() is null then
        return false;
    end if;

    if exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.verified = false
          and p.created_at < now() - interval '1 day'
    ) then
        delete from auth.users where id = auth.uid();
        return true;
    end if;

    return false;
end;
$$;

grant execute on function public.delete_unverified_account_if_expired() to authenticated;

-- Bulk purge for scheduled cleanup (pg_cron hourly)
create or replace function public.purge_expired_unverified_accounts()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    removed integer;
begin
    with expired as (
        select p.id
        from public.profiles p
        where p.verified = false
          and p.created_at < now() - interval '1 day'
    ),
    deleted as (
        delete from auth.users u
        where u.id in (select id from expired)
        returning u.id
    )
    select count(*) into removed from deleted;

    return removed;
end;
$$;

-- Optional: run every hour (enable pg_cron in Supabase Dashboard first)
-- select cron.schedule(
--     'purge-unverified-vived-accounts',
--     '0 * * * *',
--     $$ select public.purge_expired_unverified_accounts(); $$
-- );

-- Public profile lookup for website + games (read avatar_url from any client)
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

-- Profile picture files live in Supabase Storage (public read).
-- Run ALL of the section below once in SQL Editor.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
drop policy if exists "Users can upload own avatar" on storage.objects;
drop policy if exists "Users can update own avatar" on storage.objects;
drop policy if exists "Users can delete own avatar" on storage.objects;

create policy "Avatar images are publicly accessible"
    on storage.objects for select
    using (bucket_id = 'avatars');

create policy "Users can upload own avatar"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Users can update own avatar"
    on storage.objects for update
    to authenticated
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Users can delete own avatar"
    on storage.objects for delete
    to authenticated
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Profile activity (most active users on Profiles page)
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
