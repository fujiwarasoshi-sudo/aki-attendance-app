-- 有給付与の編集・削除用ポリシー
-- Supabase SQL Editorで実行してください。
-- 管理者（藤原総司: role='admin' and employee_code='fujiwara-soshi'）のみ、
-- paid_leave_grants の付与内容を編集・削除できるようにします。

alter table public.paid_leave_grants enable row level security;

drop policy if exists "manager updates leave grants" on public.paid_leave_grants;
create policy "manager updates leave grants" on public.paid_leave_grants
  for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

drop policy if exists "manager deletes leave grants" on public.paid_leave_grants;
create policy "manager deletes leave grants" on public.paid_leave_grants
  for delete to authenticated
  using (public.is_manager());

