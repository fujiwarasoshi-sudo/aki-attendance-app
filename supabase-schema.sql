-- あき調剤薬局 シフト・勤怠管理
-- Supabase SQL Editorで一度だけ実行してください。

create extension if not exists pgcrypto;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  latitude double precision,
  longitude double precision,
  radius_m integer not null default 100 check (radius_m between 20 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  employee_code text unique,
  role text not null default 'employee' check (role in ('employee','manager','admin')),
  job_title text not null default '一般従事者'
    check (job_title in ('薬剤師','一般従事者')),
  home_store_id uuid references public.stores(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists job_title text not null default '一般従事者';

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  store_id uuid not null references public.stores(id),
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  in_latitude double precision,
  in_longitude double precision,
  in_accuracy_m double precision,
  in_distance_m double precision,
  out_latitude double precision,
  out_longitude double precision,
  out_accuracy_m double precision,
  out_distance_m double precision,
  device_clock_in_at timestamptz,
  device_clock_out_at timestamptz,
  break_minutes integer not null default 60 check (break_minutes between 0 and 600),
  status text not null default 'normal' check (status in ('normal','review','corrected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);

alter table public.attendance_sessions
  add column if not exists break_minutes integer not null default 60;

create unique index if not exists one_active_session_per_employee
  on public.attendance_sessions(profile_id)
  where clock_out_at is null;

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.paid_leave_grants (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  grant_date date not null,
  days numeric(4,1) not null check (days > 0 and days <= 40),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  request_date date not null,
  leave_type text not null default 'paid' check (leave_type in ('paid','unpaid','other')),
  days numeric(3,1) not null default 1 check (days in (0.5, 1)),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.shift_entries (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null,
  shift_date date not null,
  shift_value text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique(employee_code, shift_date)
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.sheet_sync_secrets (
  id boolean primary key default true check (id),
  secret_hash text not null,
  updated_at timestamptz not null default now()
);

create index if not exists shift_entries_date_idx
  on public.shift_entries(shift_date);

create index if not exists attendance_sessions_clock_in_idx
  on public.attendance_sessions(clock_in_at);

insert into public.stores(code, name)
values ('beppu', '別府店'), ('hiyoshi', '日吉店')
on conflict (code) do update set name = excluded.name;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and employee_code = 'fujiwara-soshi'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, full_name, employee_code, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'employee_code', ''),
    'employee'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.distance_meters(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

create or replace function public.clock_attendance(
  p_action text,
  p_store_id uuid,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null,
  p_device_time timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_session public.attendance_sessions%rowtype;
  v_distance double precision;
  v_status text := 'normal';
begin
  if v_user_id is null then raise exception 'ログインが必要です'; end if;
  if p_action not in ('in','out') then raise exception '打刻種別が不正です'; end if;

  select * into v_store from public.stores where id = p_store_id and active = true;
  if not found then raise exception '店舗が見つかりません'; end if;

  if v_store.latitude is null or v_store.longitude is null
     or p_latitude is null or p_longitude is null then
    v_status := 'review';
  else
    v_distance := public.distance_meters(
      v_store.latitude, v_store.longitude, p_latitude, p_longitude
    );
    if v_distance > v_store.radius_m
       or coalesce(p_accuracy_m, 99999) > greatest(v_store.radius_m, 150) then
      v_status := 'review';
    end if;
  end if;

  if p_action = 'in' then
    if exists (
      select 1 from public.attendance_sessions
      where profile_id = v_user_id and clock_out_at is null
    ) then raise exception 'すでに出勤中です'; end if;

    insert into public.attendance_sessions(
      profile_id, store_id, clock_in_at,
      in_latitude, in_longitude, in_accuracy_m, in_distance_m,
      device_clock_in_at, status
    ) values (
      v_user_id, p_store_id, now(),
      p_latitude, p_longitude, p_accuracy_m, v_distance,
      p_device_time, v_status
    ) returning * into v_session;
  else
    select * into v_session
    from public.attendance_sessions
    where profile_id = v_user_id and clock_out_at is null
    for update;
    if not found then raise exception '出勤中の記録がありません'; end if;

    update public.attendance_sessions set
      clock_out_at = now(),
      out_latitude = p_latitude,
      out_longitude = p_longitude,
      out_accuracy_m = p_accuracy_m,
      out_distance_m = v_distance,
      device_clock_out_at = p_device_time,
      status = case when status = 'review' or v_status = 'review' then 'review' else status end,
      updated_at = now()
    where id = v_session.id
    returning * into v_session;
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (
    v_user_id, 'clock_' || p_action, 'attendance_session', v_session.id,
    jsonb_build_object('store_id', p_store_id, 'distance_m', v_distance, 'status', v_session.status)
  );

  return to_jsonb(v_session);
end;
$$;

create or replace function public.sync_shifts_from_sheet(
  p_secret text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_secret_hash text;
  v_count integer;
begin
  select secret_hash into v_secret_hash
  from private.sheet_sync_secrets
  where id = true;

  if v_secret_hash is null
     or crypt(coalesce(p_secret, ''), v_secret_hash) <> v_secret_hash then
    raise exception '同期認証に失敗しました';
  end if;

  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 1500 then
    raise exception '同期データが不正です';
  end if;

  insert into public.shift_entries(
    employee_code, shift_date, shift_value, updated_by, updated_at
  )
  select
    item->>'employee_code',
    (item->>'shift_date')::date,
    left(coalesce(item->>'shift_value', ''), 40),
    null,
    now()
  from jsonb_array_elements(p_rows) item
  where item->>'employee_code' ~ '^[a-z0-9][a-z0-9-]{1,63}$'
    and item->>'shift_date' ~ '^\d{4}-\d{2}-\d{2}$'
  on conflict (employee_code, shift_date) do update
    set shift_value = excluded.shift_value,
        updated_by = null,
        updated_at = now();

  get diagnostics v_count = row_count;
  return jsonb_build_object('synced', v_count);
end;
$$;

alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.paid_leave_grants enable row level security;
alter table public.leave_requests enable row level security;
alter table public.shift_entries enable row level security;

drop policy if exists "authenticated read stores" on public.stores;
create policy "authenticated read stores" on public.stores
  for select to authenticated using (true);

drop policy if exists "manager update stores" on public.stores;
create policy "manager update stores" on public.stores
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists "read own profile or manager" on public.profiles;
create policy "read own profile or manager" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_manager());

drop policy if exists "update own profile or manager" on public.profiles;
drop policy if exists "manager updates profiles" on public.profiles;
create policy "manager updates profiles" on public.profiles
  for update to authenticated using (public.is_manager())
  with check (public.is_manager());

drop policy if exists "read own attendance or manager" on public.attendance_sessions;
create policy "read own attendance or manager" on public.attendance_sessions
  for select to authenticated using (profile_id = auth.uid() or public.is_manager());

drop policy if exists "manager reads audit logs" on public.audit_logs;
create policy "manager reads audit logs" on public.audit_logs
  for select to authenticated using (public.is_manager());

drop policy if exists "read own leave grants or manager" on public.paid_leave_grants;
create policy "read own leave grants or manager" on public.paid_leave_grants
  for select to authenticated using (profile_id = auth.uid() or public.is_manager());

drop policy if exists "manager inserts leave grants" on public.paid_leave_grants;
create policy "manager inserts leave grants" on public.paid_leave_grants
  for insert to authenticated with check (public.is_manager() and created_by = auth.uid());

drop policy if exists "manager updates leave grants" on public.paid_leave_grants;
create policy "manager updates leave grants" on public.paid_leave_grants
  for update to authenticated using (public.is_manager())
  with check (public.is_manager());

drop policy if exists "manager deletes leave grants" on public.paid_leave_grants;
create policy "manager deletes leave grants" on public.paid_leave_grants
  for delete to authenticated using (public.is_manager());

drop policy if exists "read own leave requests or manager" on public.leave_requests;
create policy "read own leave requests or manager" on public.leave_requests
  for select to authenticated using (profile_id = auth.uid() or public.is_manager());

drop policy if exists "employee creates own leave request" on public.leave_requests;
create policy "employee creates own leave request" on public.leave_requests
  for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists "manager updates leave requests" on public.leave_requests;
create policy "manager updates leave requests" on public.leave_requests
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists "authenticated reads shifts" on public.shift_entries;
create policy "authenticated reads shifts" on public.shift_entries
  for select to authenticated using (true);

drop policy if exists "manager inserts shifts" on public.shift_entries;
create policy "manager inserts shifts" on public.shift_entries
  for insert to authenticated with check (public.is_manager() and updated_by = auth.uid());

drop policy if exists "manager updates shifts" on public.shift_entries;
create policy "manager updates shifts" on public.shift_entries
  for update to authenticated using (public.is_manager())
  with check (public.is_manager() and updated_by = auth.uid());

revoke all on function public.clock_attendance(
  text, uuid, double precision, double precision, double precision, timestamptz
) from public, anon;
grant execute on function public.clock_attendance(
  text, uuid, double precision, double precision, double precision, timestamptz
) to authenticated;

revoke all on function public.sync_shifts_from_sheet(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_shifts_from_sheet(text, jsonb)
  to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attendance_sessions'
  ) then
    alter publication supabase_realtime add table public.attendance_sessions;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shift_entries'
  ) then
    alter publication supabase_realtime add table public.shift_entries;
  end if;
end $$;

-- 初期管理者設定例（ユーザー作成後にメールアドレスを置き換えて実行）
-- 管理者は employee_code = 'fujiwara-soshi' の admin 1名だけに制限します。
-- update public.profiles
-- set role = case when id = (select id from auth.users where email = 'あなたのメールアドレス') then 'admin' else 'employee' end,
--     employee_code = case when id = (select id from auth.users where email = 'あなたのメールアドレス') then 'fujiwara-soshi' else employee_code end
-- where true;
