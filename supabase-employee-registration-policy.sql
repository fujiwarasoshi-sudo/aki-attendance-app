-- 従業員プロフィール登録用ポリシー
-- Supabase SQL Editorで実行してください。
-- 公開アプリには service_role key を入れず、管理者（藤原総司）のみ profiles を登録できるようにします。

drop policy if exists "manager inserts profiles" on public.profiles;

create policy "manager inserts profiles" on public.profiles
  for insert to authenticated
  with check (
    public.is_manager()
    and role = 'employee'
    and employee_code is distinct from 'fujiwara-soshi'
  );
