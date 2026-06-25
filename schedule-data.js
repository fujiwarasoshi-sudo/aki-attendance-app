/*
 * 公開用ファイルには従業員名や実シフトを保存しません。
 * ログイン後、Supabaseから権限に応じた情報を取得します。
 */
window.HIYOSHI_SCHEDULE = {
  source: { title: "共有シフト表", year: 2026, month: 7 },
  employees: [{
    id: "login-user",
    name: "ログインユーザー",
    role: "一般従事者",
    shifts: []
  }]
};
