/**
 * 共有シフト表 → Supabase 自動同期
 *
 * 氏名・パスワード・同期秘密はコードへ直接書きません。
 * Apps Scriptの「スクリプト プロパティ」へ次を登録します。
 *
 * SUPABASE_URL        https://xxxx.supabase.co
 * SUPABASE_KEY        sb_publishable_...
 * SYNC_SECRET         管理者が発行した同期用秘密
 * EMPLOYEE_CODE_MAP   {"シート上の氏名":"employee-code", ...}
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("勤怠アプリ連携")
    .addItem("現在の月を今すぐ同期", "syncActiveShiftSheet")
    .addItem("全シフト月を同期", "syncAllShiftSheets")
    .addToUi();
}

function installedOnEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (!isShiftSheet_(sheet.getName())) return;
  if (e.range.getRow() < 5 || e.range.getRow() > 35) return;
  if (e.range.getColumn() < 2 || e.range.getColumn() > 18) return;
  syncShiftSheet_(sheet);
}

function syncActiveShiftSheet() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!isShiftSheet_(sheet.getName())) {
    throw new Error("R数字 月数字のシフト月タブを開いて実行してください。");
  }
  syncShiftSheet_(sheet);
}

function syncAllShiftSheets() {
  SpreadsheetApp.getActive()
    .getSheets()
    .filter(sheet => isShiftSheet_(sheet.getName()))
    .forEach(syncShiftSheet_);
}

function syncShiftSheet_(sheet) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("SUPABASE_URL");
  const key = props.getProperty("SUPABASE_KEY");
  const secret = props.getProperty("SYNC_SECRET");
  const employeeMap = JSON.parse(props.getProperty("EMPLOYEE_CODE_MAP") || "{}");
  if (!url || !key || !secret || !Object.keys(employeeMap).length) {
    throw new Error("スクリプト プロパティの設定が不足しています。");
  }

  const month = parseReiwaMonth_(sheet.getName());
  const values = sheet.getRange("B5:W35").getDisplayValues();
  const rows = buildRows_(values, month, employeeMap);
  if (!rows.length) throw new Error("同期対象の従業員シフトが見つかりません。");

  const response = UrlFetchApp.fetch(url + "/rest/v1/rpc/sync_shifts_from_sheet", {
    method: "post",
    contentType: "application/json",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key
    },
    payload: JSON.stringify({ p_secret: secret, p_rows: rows }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() >= 300) {
    throw new Error("同期に失敗しました: " + response.getContentText());
  }
  console.log(sheet.getName() + " synced: " + response.getContentText());
}

function buildRows_(values, month, employeeMap) {
  const output = [];
  values.forEach((row, rowIndex) => {
    if (row[0] !== "日付") return;
    const dates = row.slice(1);
    for (let employeeRow = rowIndex + 2; employeeRow < values.length; employeeRow++) {
      const name = normalizeName_(values[employeeRow][0]);
      if (name === "日付") break;
      if (!name) continue;
      const code = findEmployeeCode_(employeeMap, name);
      if (!code) continue;
      dates.forEach((dayText, index) => {
        const day = Number(dayText);
        if (!day) return;
        output.push({
          employee_code: code,
          shift_date: month + "-" + String(day).padStart(2, "0"),
          shift_value: normalizeShift_(values[employeeRow][index + 1])
        });
      });
    }
  });
  return output;
}

function findEmployeeCode_(employeeMap, normalizedName) {
  const originalName = Object.keys(employeeMap)
    .find(name => normalizeName_(name) === normalizedName);
  return originalName ? employeeMap[originalName] : "";
}

function normalizeName_(value) {
  return String(value || "").replace(/[\s　]+/g, "");
}

function normalizeShift_(value) {
  return String(value || "")
    .trim()
    .replace(/[～〜]/g, "-")
    .replace(/^〇$/, "早");
}

function isShiftSheet_(name) {
  return /^R\d+\s+\d{1,2}$/.test(name);
}

function parseReiwaMonth_(name) {
  const match = name.match(/^R(\d+)\s+(\d{1,2})$/);
  if (!match) throw new Error("シート名から年月を判定できません。");
  const year = 2018 + Number(match[1]);
  return year + "-" + String(Number(match[2])).padStart(2, "0");
}
