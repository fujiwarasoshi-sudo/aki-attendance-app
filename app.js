const scheduleData = window.HIYOSHI_SCHEDULE;
const roleTimes = {
  "薬剤師": { "早": "8:30〜17:30", "遅": "9:30〜18:30" },
  "一般従事者": { "早": "8:00〜17:00", "遅": "9:30〜18:30" }
};

const demoAttendance = [
  { name: "佐藤 太郎", store: "別府店", since: "8:55", status: "デモ打刻" },
  { name: "鈴木 美咲", store: "日吉店", since: "9:02", status: "デモ打刻" }
];

const roleSelect = document.querySelector("#roleSelect");
const employeeView = document.querySelector("#employeeView");
const managerView = document.querySelector("#managerView");
const monthlyScheduleView = document.querySelector("#monthlyScheduleView");
const monthlyScheduleButton = document.querySelector("#monthlyScheduleButton");
const closeMonthlyScheduleButton = document.querySelector("#closeMonthlyScheduleButton");
const employeeSelect = document.querySelector("#employeeSelect");
const clockInButton = document.querySelector("#clockInButton");
const clockOutButton = document.querySelector("#clockOutButton");
const workStatus = document.querySelector("#workStatus");
const locationMessage = document.querySelector("#locationMessage");
const appDialog = document.querySelector("#appDialog");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogBody = document.querySelector("#dialogBody");
const dialogConfirm = document.querySelector("#dialogConfirm");
const toast = document.querySelector("#toast");
const installButton = document.querySelector("#installButton");
const installGuideButton = document.querySelector("#installGuideButton");
const mobileNavButtons = [...document.querySelectorAll(".mobile-nav-button")];
const authView = document.querySelector("#authView");
const loginForm = document.querySelector("#loginForm");
const loginButton = document.querySelector("#loginButton");
const loginMessage = document.querySelector("#loginMessage");
const logoutButton = document.querySelector("#logoutButton");
const connectionBadge = document.querySelector("#connectionBadge");
const mainElement = document.querySelector("main");
const appHeader = document.querySelector(".app-header");
const laborReportView = document.querySelector("#laborReportView");
const laborReportButton = document.querySelector("#laborReportButton");
const closeLaborReportButton = document.querySelector("#closeLaborReportButton");
const refreshLaborReportButton = document.querySelector("#refreshLaborReportButton");
const exportXlsxButton = document.querySelector("#exportXlsxButton");
const exportCsvButton = document.querySelector("#exportCsvButton");
const leaveEmployeeSelect = document.querySelector("#leaveEmployeeSelect");
const leaveGrantDate = document.querySelector("#leaveGrantDate");
const leaveGrantDays = document.querySelector("#leaveGrantDays");
const saveLeaveGrantButton = document.querySelector("#saveLeaveGrantButton");
const scheduleEditorView = document.querySelector("#scheduleEditorView");
const scheduleEditorButton = document.querySelector("#scheduleEditorButton");
const closeScheduleEditorButton = document.querySelector("#closeScheduleEditorButton");
const scheduleEditorMonth = document.querySelector("#scheduleEditorMonth");
const saveScheduleButton = document.querySelector("#saveScheduleButton");
const copyPreviousMonthButton = document.querySelector("#copyPreviousMonthButton");
const clearScheduleButton = document.querySelector("#clearScheduleButton");
const employeeScheduleMonth = document.querySelector("#employeeScheduleMonth");
const monthlyScheduleMonth = document.querySelector("#monthlyScheduleMonth");
const settingsStore = document.querySelector("#settingsStore");
const settingsLatitude = document.querySelector("#settingsLatitude");
const settingsLongitude = document.querySelector("#settingsLongitude");
const settingsRadius = document.querySelector("#radius");
const saveStoreSettingsButton = document.querySelector("#saveStoreSettingsButton");

let selectedEmployeeId = localStorage.getItem("attendance-demo-employee") || scheduleData.employees[0].id;
let previousMainView = "employee";
let installPrompt = null;

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function updateInstallButtonVisibility() {
  if (isStandaloneApp()) {
    installButton.hidden = true;
    if (installGuideButton) installGuideButton.hidden = true;
    return;
  }
  const isSmallScreen = window.matchMedia("(max-width: 680px)").matches;
  installButton.hidden = !(installPrompt || isSmallScreen);
}
let cloudState = { ...window.CloudAPI.state };
let cloudMode = false;
let laborReportRows = [];
let dialogConfirmHandler = null;
let scheduleDraft = null;
let lastScheduleChangedMonth = null;

function hasManagerAccess() {
  if (!cloudMode) return true;
  return Boolean(window.CloudAPI.hasAdminAccess?.(cloudState.profile));
}

function blockManagerAccess() {
  employeeView.hidden = false;
  managerView.hidden = true;
  laborReportView.hidden = true;
  scheduleEditorView.hidden = true;
  roleSelect.value = "employee";
  setMobileNavActive("employee");
  showToast("管理画面は管理者のみ利用できます。");
}

function applyCloudEmployees() {
  if (!cloudMode || !cloudState.employeeProfiles?.length) return;
  const employees = cloudState.employeeProfiles
    .filter(profile => profile.employee_code)
    .map(profile => ({
      id: profile.employee_code,
      profileId: profile.id,
      name: profile.full_name,
      role: profile.job_title || "一般従事者",
      shifts: []
    }));
  if (employees.length) scheduleData.employees = employees;
}

function availableMonthKeys() {
  const now = new Date();
  const keys = new Set(["2026-07", "2026-08"]);
  for (let offset = -1; offset <= 12; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    keys.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return [...keys].sort();
}

function populateMonthSelectors() {
  const options = availableMonthKeys()
    .map(monthKey => `<option value="${monthKey}">${monthLabel(monthKey)}</option>`)
    .join("");
  [employeeScheduleMonth, monthlyScheduleMonth].forEach(select => {
    const previous = select.value;
    select.innerHTML = options;
    select.value = availableMonthKeys().includes(previous) ? previous : "2026-07";
  });
  const now = new Date();
  const min = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const max = new Date(now.getFullYear() + 1, now.getMonth() + 1, 0);
  const managerDate = document.querySelector("#managerDate");
  managerDate.min = min.toISOString().slice(0, 10);
  managerDate.max = max.toISOString().slice(0, 10);
}

function ensureMonthOption(monthKey) {
  [employeeScheduleMonth, monthlyScheduleMonth].forEach(select => {
    if (!select.querySelector(`option[value="${monthKey}"]`)) {
      const option = document.createElement("option");
      option.value = monthKey;
      option.textContent = monthLabel(monthKey);
      select.append(option);
    }
  });
}

function renderStoreSettings() {
  if (!cloudMode) return;
  const store = cloudState.stores.find(item => item.code === settingsStore.value);
  if (!store) return;
  settingsLatitude.value = store.latitude ?? "";
  settingsLongitude.value = store.longitude ?? "";
  settingsRadius.value = String(store.radius_m || 100);
}

async function saveStoreSettings() {
  if (!cloudMode) {
    showToast("店舗設定はクラウド接続後に保存できます。");
    return;
  }
  const store = cloudState.stores.find(item => item.code === settingsStore.value);
  const latitude = Number(settingsLatitude.value);
  const longitude = Number(settingsLongitude.value);
  const radiusM = Number(settingsRadius.value);
  if (!store || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    showToast("店舗の緯度と経度を入力してください。");
    return;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    showToast("緯度・経度の値を確認してください。");
    return;
  }
  saveStoreSettingsButton.disabled = true;
  try {
    await window.CloudAPI.updateStoreSettings(store.id, latitude, longitude, radiusM);
    showToast(`${store.name}の位置設定を保存しました。`);
  } catch (error) {
    showToast(error.message || "店舗設定を保存できませんでした。");
  } finally {
    saveStoreSettingsButton.disabled = false;
  }
}

function scheduleStorageKey(monthKey) {
  return `attendance-schedule-${monthKey}`;
}

function emptyMonthSchedule(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const count = new Date(year, month, 0).getDate();
  return Object.fromEntries(scheduleData.employees.map(employee => [
    employee.id, Array(count).fill("")
  ]));
}

function julyBaseSchedule() {
  return Object.fromEntries(scheduleData.employees.map(employee => [
    employee.id, [...employee.shifts]
  ]));
}

function getLocalMonthSchedule(monthKey) {
  const saved = localStorage.getItem(scheduleStorageKey(monthKey));
  if (saved) return JSON.parse(saved);
  return monthKey === "2026-07" ? julyBaseSchedule() : emptyMonthSchedule(monthKey);
}

function saveLocalMonthSchedule(monthKey, matrix) {
  localStorage.setItem(scheduleStorageKey(monthKey), JSON.stringify(matrix));
}

function getEmployeeMonthShifts(employeeId, monthKey) {
  const matrix = getLocalMonthSchedule(monthKey);
  return matrix[employeeId] || emptyMonthSchedule(monthKey)[employeeId] || [];
}

function monthParts(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month, days: new Date(year, month, 0).getDate() };
}

function monthLabel(monthKey) {
  const { year, month } = monthParts(monthKey);
  return `${year}年${month}月`;
}

async function syncMonthFromCloud(monthKey) {
  if (!cloudMode) return;
  try {
    ensureMonthOption(monthKey);
    const rows = await window.CloudAPI.getMonthSchedule(monthKey);
    // 初回導入時、クラウドがまだ空なら取込済みのローカル予定を保持する。
    // 管理者が保存すると、その月の予定がクラウドへ登録される。
    if (!rows.length) return;
    const matrix = emptyMonthSchedule(monthKey);
    rows.forEach(row => {
      const day = Number(row.shift_date.slice(-2));
      if (matrix[row.employee_code]) matrix[row.employee_code][day - 1] = row.shift_value;
    });
    saveLocalMonthSchedule(monthKey, matrix);
    renderEmployeeSchedule();
    renderManagerSchedule();
    renderMonthlySchedule();
  } catch (error) {
    showToast(error.message || "クラウドのシフトを取得できませんでした。");
  }
}

function demoLeaveStorageKey(employeeId) {
  return `attendance-demo-leave-${employeeId}`;
}

function demoLeaveRequestsKey(employeeId) {
  return `attendance-demo-leave-requests-${employeeId}`;
}

function getDemoLeaveLedger(employeeId) {
  const grants = JSON.parse(localStorage.getItem(demoLeaveStorageKey(employeeId)) || "[]");
  const requests = JSON.parse(localStorage.getItem(demoLeaveRequestsKey(employeeId)) || "[]");
  const granted = grants.reduce((sum, item) => sum + Number(item.days), 0);
  const used = requests.filter(item => item.status === "approved")
    .reduce((sum, item) => sum + Number(item.days), 0);
  return { grants, requests, granted, used, remaining: granted - used };
}

function populateLeaveEmployees() {
  const employees = cloudMode && cloudState.employeeProfiles.length
    ? cloudState.employeeProfiles.map(profile => ({
        id: profile.id, name: profile.full_name, code: profile.employee_code
      }))
    : scheduleData.employees.map(employee => ({
        id: employee.id, name: employee.name, code: employee.id
      }));
  leaveEmployeeSelect.innerHTML = employees.map(employee =>
    `<option value="${employee.id}">${employee.name}</option>`
  ).join("");
  if (employees.length) loadLeaveLedger();
}

async function loadLeaveLedger() {
  const employeeId = leaveEmployeeSelect.value;
  if (!employeeId) return;
  try {
    const ledger = cloudMode
      ? await window.CloudAPI.getLeaveLedger(employeeId)
      : getDemoLeaveLedger(employeeId);
    renderLeaveLedger(ledger);
  } catch (error) {
    showToast(error.message || "有給台帳を取得できませんでした。");
  }
}

function renderLeaveLedger(ledger) {
  document.querySelector("#leaveGrantedTotal").textContent = `${ledger.granted}日`;
  document.querySelector("#leaveUsedTotal").textContent = `${ledger.used}日`;
  document.querySelector("#leaveRemainingTotal").textContent = `${ledger.remaining}日`;
  document.querySelector("#leaveGrantHistoryBody").innerHTML = ledger.grants.length
    ? ledger.grants.map(item => `<tr>
        <td>${new Date(`${item.grant_date}T00:00:00`).toLocaleDateString("ja-JP")}</td>
        <td>${Number(item.days)}日</td>
        <td>${item.note || "定期付与"}</td>
      </tr>`).join("")
    : `<tr><td colspan="3">有給付与履歴はありません。</td></tr>`;
}

async function saveLeaveGrant() {
  const employeeId = leaveEmployeeSelect.value;
  const grantDate = leaveGrantDate.value;
  const days = Number(leaveGrantDays.value);
  if (!employeeId || !grantDate || !days) {
    showToast("従業員、付与日、付与日数を入力してください。");
    return;
  }
  saveLeaveGrantButton.disabled = true;
  try {
    if (cloudMode) {
      await window.CloudAPI.addLeaveGrant(employeeId, grantDate, days, "管理者による付与");
    } else {
      const grants = getDemoLeaveLedger(employeeId).grants;
      grants.push({ id: crypto.randomUUID(), grant_date: grantDate, days, note: "管理者による付与" });
      localStorage.setItem(demoLeaveStorageKey(employeeId), JSON.stringify(grants));
    }
    await loadLeaveLedger();
    showToast(`${days}日の有給を付与しました。`);
  } catch (error) {
    showToast(error.message || "有給を付与できませんでした。");
  } finally {
    saveLeaveGrantButton.disabled = false;
  }
}

async function submitShiftRequest() {
  const requestType = document.querySelector("#shiftRequestType").value;
  const requestDate = document.querySelector("#shiftRequestDate").value;
  const note = document.querySelector("#shiftRequestNote").value;
  if (!requestDate) throw new Error("希望日を入力してください。");
  if (requestType !== "paid") {
    showToast("シフト希望を提出しました（試作版）。");
    return;
  }
  const days = Number(document.querySelector("#paidLeaveDays").value);
  if (cloudMode) {
    await window.CloudAPI.createLeaveRequest(requestDate, days, note);
  } else {
    const employeeId = selectedEmployee().id;
    const requests = getDemoLeaveLedger(employeeId).requests;
    requests.push({
      id: crypto.randomUUID(), request_date: requestDate, days,
      status: "pending", note, leave_type: "paid"
    });
    localStorage.setItem(demoLeaveRequestsKey(employeeId), JSON.stringify(requests));
  }
  showToast(`${days}日の有給希望を提出しました。`);
}

function selectedEmployee() {
  if (cloudMode && cloudState.profile && !hasManagerAccess()) {
    const normalizedName = cloudState.profile.full_name.replace(/\s/g, "");
    return scheduleData.employees.find(employee =>
      employee.name.replace(/\s/g, "") === normalizedName ||
      employee.id === cloudState.profile.employee_code
    ) || scheduleData.employees[0];
  }
  return scheduleData.employees.find(employee => employee.id === selectedEmployeeId) || scheduleData.employees[0];
}

function workStorageKey() {
  return `attendance-demo-working-${selectedEmployeeId}`;
}

function isWorking() {
  if (cloudMode) return Boolean(cloudState.activeSession);
  return localStorage.getItem(workStorageKey()) === "true";
}

function shiftDetails(employee, value) {
  if (!value) return {
    label: "未設定（打刻できます）",
    store: "予定店舗なし",
    className: "off-day",
    canClock: true
  };
  if (value === "休み") return { label: "休み", store: "—", className: "off-day", canClock: false };
  if (value === "有給") return { label: "有給休暇", store: "—", className: "off-day", canClock: false };
  if (value === "別府") return { label: "別府店勤務", store: "別府店", className: "other-store", canClock: false };
  const label = roleTimes[employee.role]?.[value] || value.replace("-", "〜");
  return { label, store: "日吉店", className: "", canClock: true };
}

function dateForDay(day, monthKey = "2026-07") {
  const { year, month } = monthParts(monthKey);
  return new Date(year, month - 1, day);
}

function dateLabel(day, monthKey = "2026-07") {
  return dateForDay(day, monthKey).toLocaleDateString("ja-JP", {
    month: "long", day: "numeric", weekday: "short"
  });
}

function populateEmployees() {
  employeeSelect.innerHTML = scheduleData.employees.map(employee =>
    `<option value="${employee.id}">${employee.name}（${employee.role}）</option>`
  ).join("");
  employeeSelect.value = selectedEmployeeId;
  const employeeLocked = cloudMode && !hasManagerAccess();
  employeeSelect.disabled = employeeLocked;
  employeeSelect.closest("label").hidden = employeeLocked;
}

function renderEmployeeSchedule() {
  const employee = selectedEmployee();
  const monthKey = employeeScheduleMonth.value;
  const shifts = getEmployeeMonthShifts(employee.id, monthKey);
  document.querySelector("#employeeScheduleTitle").textContent = `${monthLabel(monthKey)}の予定`;
  document.querySelector("#shiftList").innerHTML = shifts.map((value, index) => {
    const detail = shiftDetails(employee, value);
    return `<div class="shift-row ${detail.className}">
      <strong>${dateLabel(index + 1, monthKey)}</strong>
      <span>${detail.store}</span>
      <span>${detail.label}</span>
    </div>`;
  }).join("");
  renderTodayShift();
  syncWorkState();
}

function renderTodayShift() {
  const employee = selectedEmployee();
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentShifts = getEmployeeMonthShifts(employee.id, currentMonthKey);
  if (currentShifts.length) {
    const detail = shiftDetails(employee, currentShifts[now.getDate() - 1]);
    document.querySelector("#todayShift").innerHTML = `本日の予定：<strong>${detail.store} ${detail.label}</strong>`;
    clockInButton.disabled = !detail.canClock || isWorking();
    return;
  }
  const displayedMonth = employeeScheduleMonth.value;
  const displayedShifts = getEmployeeMonthShifts(employee.id, displayedMonth);
  const firstWorkIndex = displayedShifts.findIndex(value =>
    value && value !== "休み" && value !== "有給" && value !== "別府"
  );
  if (firstWorkIndex < 0) {
    document.querySelector("#todayShift").textContent = "次の勤務予定は未設定です。";
    return;
  }
  const detail = shiftDetails(employee, displayedShifts[firstWorkIndex]);
  document.querySelector("#todayShift").innerHTML =
    `次の日吉店勤務：<strong>${dateLabel(firstWorkIndex + 1, displayedMonth)} ${detail.label}</strong>`;
}

function renderManagerSchedule() {
  const dateValue = document.querySelector("#managerDate").value;
  const monthKey = dateValue.slice(0, 7);
  const day = Number(dateValue.split("-")[2]);
  const matrix = getLocalMonthSchedule(monthKey);
  document.querySelector("#managerShiftList").innerHTML = scheduleData.employees.map(employee => {
    const detail = shiftDetails(employee, matrix[employee.id]?.[day - 1] || "");
    return `<div class="shift-row ${detail.className}">
      <strong>${employee.name}<small class="muted">${employee.role}</small></strong>
      <span>${detail.store}</span>
      <span>${detail.label}</span>
    </div>`;
  }).join("");
}

function scheduleCellClass(value) {
  if (!value) return "off";
  if (value === "早") return "early";
  if (value === "遅") return "late";
  if (value === "休み") return "off";
  if (value === "別府") return "beppu";
  if (value === "有給") return "paid";
  return "custom";
}

function weekdayLabel(day, monthKey = "2026-07") {
  return dateForDay(day, monthKey).toLocaleDateString("ja-JP", { weekday: "short" });
}

function renderMonthlySchedule() {
  const monthKey = monthlyScheduleMonth.value;
  const { days: dayCount } = monthParts(monthKey);
  const matrix = getLocalMonthSchedule(monthKey);
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  document.querySelector("#monthlyScheduleSource").textContent =
    "共有Googleスプレッドシートまたは管理者画面";
  document.querySelector("#monthlyScheduleTitle").textContent = `${monthLabel(monthKey)} シフト一覧表`;
  const header = days.map(day => {
    const weekday = weekdayLabel(day, monthKey);
    const weekendClass = weekday === "日" ? "sunday" : weekday === "土" ? "saturday" : "";
    return `<th class="${weekendClass}">${day}<small class="role-label">${weekday}</small></th>`;
  }).join("");

  const rows = scheduleData.employees.map(employee => {
    const cells = (matrix[employee.id] || []).map(value =>
      `<td class="schedule-cell ${scheduleCellClass(value)}">${value}</td>`
    ).join("");
    return `<tr>
      <th class="name-column">${employee.name}<small class="role-label">${employee.role}</small></th>
      ${cells}
    </tr>`;
  }).join("");

  document.querySelector("#monthlyScheduleTable").innerHTML = `
    <thead><tr><th class="name-column">氏名</th>${header}</tr></thead>
    <tbody>${rows}</tbody>`;
}

function editorOptions(value) {
  const standard = ["", "早", "遅", "休み", "別府", "有給"];
  const isCustom = value && !standard.includes(value);
  const options = [
    ["", "未設定"], ["早", "早"], ["遅", "遅"], ["休み", "休み"],
    ["別府", "別府"], ["有給", "有給"], ["__custom__", "個別時間"]
  ];
  return options.map(([optionValue, label]) => {
    const selected = isCustom
      ? optionValue === "__custom__"
      : optionValue === value;
    return `<option value="${optionValue}" ${selected ? "selected" : ""}>${isCustom && optionValue === "__custom__" ? value : label}</option>`;
  }).join("");
}

function renderScheduleEditor(useExistingDraft = false) {
  const monthKey = scheduleEditorMonth.value;
  const { days: dayCount } = monthParts(monthKey);
  if (!useExistingDraft || !scheduleDraft) {
    scheduleDraft = structuredClone(getLocalMonthSchedule(monthKey));
  }
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  const header = days.map(day => {
    const weekday = weekdayLabel(day, monthKey);
    const weekendClass = weekday === "日" ? "sunday" : weekday === "土" ? "saturday" : "";
    return `<th class="${weekendClass}">${day}<small class="role-label">${weekday}</small></th>`;
  }).join("");
  const rows = scheduleData.employees.map(employee => {
    const shifts = scheduleDraft[employee.id] || Array(dayCount).fill("");
    scheduleDraft[employee.id] = shifts;
    return `<tr>
      <th class="name-column">${employee.name}<small class="role-label">${employee.role}</small></th>
      ${days.map(day => {
        const value = shifts[day - 1] || "";
        return `<td class="schedule-cell ${scheduleCellClass(value)}">
          <select data-employee-id="${employee.id}" data-day="${day}" aria-label="${employee.name} ${day}日">
            ${editorOptions(value)}
          </select>
        </td>`;
      }).join("")}
    </tr>`;
  }).join("");
  document.querySelector("#scheduleEditorTable").innerHTML =
    `<thead><tr><th class="name-column">氏名</th>${header}</tr></thead><tbody>${rows}</tbody>`;
}

function showScheduleEditor() {
  if (!hasManagerAccess()) return blockManagerAccess();
  employeeView.hidden = true;
  managerView.hidden = true;
  monthlyScheduleView.hidden = true;
  laborReportView.hidden = true;
  scheduleEditorView.hidden = false;
  renderScheduleEditor();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeScheduleEditor() {
  scheduleEditorView.hidden = true;
  if (!hasManagerAccess()) {
    blockManagerAccess();
    return;
  }
  managerView.hidden = false;
  roleSelect.value = "manager";
  renderManagerSchedule();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveScheduleDraft() {
  if (!hasManagerAccess()) return blockManagerAccess();
  const monthKey = scheduleEditorMonth.value;
  saveScheduleButton.disabled = true;
  saveScheduleButton.textContent = "保存中…";
  try {
    saveLocalMonthSchedule(monthKey, scheduleDraft);
    if (cloudMode) await window.CloudAPI.saveMonthSchedule(monthKey, scheduleDraft);
    ensureMonthOption(monthKey);
    employeeScheduleMonth.value = monthKey;
    monthlyScheduleMonth.value = monthKey;
    renderEmployeeSchedule();
    renderMonthlySchedule();
    showToast(`${monthLabel(monthKey)}のシフトを保存しました。`);
  } catch (error) {
    showToast(error.message || "シフトを保存できませんでした。");
  } finally {
    saveScheduleButton.disabled = false;
    saveScheduleButton.textContent = "シフトを保存";
  }
}

function copyPreviousMonth() {
  const { year, month, days } = monthParts(scheduleEditorMonth.value);
  const previous = new Date(year, month - 2, 1);
  const previousKey = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
  const previousMatrix = getLocalMonthSchedule(previousKey);
  scheduleDraft = Object.fromEntries(scheduleData.employees.map(employee => [
    employee.id,
    Array.from({ length: days }, (_, index) => previousMatrix[employee.id]?.[index] || "")
  ]));
  renderScheduleEditor(true);
  showToast(`${monthLabel(previousKey)}をコピーしました。`);
}

function clearScheduleDraft() {
  scheduleDraft = emptyMonthSchedule(scheduleEditorMonth.value);
  renderScheduleEditor(true);
  showToast("入力をクリアしました。保存するまで共有されません。");
}

function showMonthlySchedule() {
  previousMainView = managerView.hidden ? "employee" : "manager";
  employeeView.hidden = true;
  managerView.hidden = true;
  laborReportView.hidden = true;
  scheduleEditorView.hidden = true;
  monthlyScheduleView.hidden = false;
  monthlyScheduleButton.textContent = "一覧を表示中";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeMonthlySchedule() {
  monthlyScheduleView.hidden = true;
  employeeView.hidden = previousMainView !== "employee";
  managerView.hidden = previousMainView !== "manager" || !hasManagerAccess();
  if (!hasManagerAccess()) employeeView.hidden = false;
  monthlyScheduleButton.textContent = "シフト一覧表";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function parseTimeRange(value, fallbackStart = "8:30", fallbackEnd = "17:30") {
  if (value === "早" || value === "遅") return null;
  if (value === "別府") return { start: fallbackStart, end: fallbackEnd };
  const normalized = value.replace("～", "-").replace("〜", "-");
  if (!normalized.includes("-")) return null;
  const [start, end] = normalized.split("-");
  if (!start) return null;
  return { start, end: end || "18:30" };
}

function minutesBetween(start, end) {
  const [startHour, startMinute = 0] = start.split(":").map(Number);
  const [endHour, endMinute = 0] = end.split(":").map(Number);
  return Math.max(0, (endHour * 60 + endMinute) - (startHour * 60 + startMinute));
}

function scheduledMinutesFor(employeeName, date, defaultBreak, standardMinutes) {
  const employee = scheduleData.employees.find(item =>
    item.name.replace(/\s/g, "") === employeeName.replace(/\s/g, "")
  );
  if (!employee) return standardMinutes;
  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const value = getEmployeeMonthShifts(employee.id, monthKey)[date.getDate() - 1];
  if (!value || value === "休み" || value === "有給") return 0;
  if (value === "別府") return standardMinutes;
  if (value === "早" || value === "遅") {
    const range = roleTimes[employee.role][value].replace("〜", "-").split("-");
    return Math.max(0, minutesBetween(range[0], range[1]) - defaultBreak);
  }
  const customRange = parseTimeRange(value);
  if (!customRange) return standardMinutes;
  const span = minutesBetween(customRange.start, customRange.end);
  const breakMinutes = span > 360 ? defaultBreak : 0;
  return Math.max(0, span - breakMinutes);
}

function scheduledEndFor(employeeName, clockIn, defaultBreak, standardMinutes) {
  const employee = scheduleData.employees.find(item =>
    item.name.replace(/\s/g, "") === employeeName.replace(/\s/g, "")
  );
  let endTime = null;

  if (employee) {
    const monthKey = `${clockIn.getFullYear()}-${String(clockIn.getMonth() + 1).padStart(2, "0")}`;
    const value = getEmployeeMonthShifts(employee.id, monthKey)[clockIn.getDate() - 1];
    if (value === "早" || value === "遅") {
      endTime = roleTimes[employee.role][value].replace("〜", "-").split("-")[1];
    } else if (value === "別府") {
      endTime = "17:30";
    } else {
      endTime = parseTimeRange(value)?.end || null;
    }
  }

  if (endTime) {
    const [hour, minute = 0] = endTime.split(":").map(Number);
    return new Date(
      clockIn.getFullYear(), clockIn.getMonth(), clockIn.getDate(), hour, minute
    );
  }

  return new Date(clockIn.getTime() + (standardMinutes + defaultBreak) * 60000);
}

window.AttendanceCalculations = {
  scheduledEndFor,
  postShiftOvertimeMinutes(clockOut, scheduledEnd) {
    return Math.max(0, (clockOut - scheduledEnd) / 60000);
  }
};

function demoMonthlyAttendance(year, month, breakMinutes) {
  if (year !== 2026 || month !== 7) return [];
  const rows = [];
  scheduleData.employees.forEach((employee, employeeIndex) => {
    employee.shifts.forEach((value, index) => {
      if (value === "休み") return;
      let range;
      if (value === "早" || value === "遅") {
        const [start, end] = roleTimes[employee.role][value].replace("〜", "-").split("-");
        range = { start, end };
      } else {
        range = parseTimeRange(value);
      }
      if (!range) range = { start: "8:30", end: "17:30" };
      const day = index + 1;
      const earlyArrivalMinutes = (day + employeeIndex) % 4 === 0 ? 20 : 0;
      const overtimeMinutes = (day + employeeIndex) % 5 === 0 ? 30 : 0;
      const startParts = range.start.split(":").map(Number);
      const inAt = new Date(year, month - 1, day, startParts[0], startParts[1] - earlyArrivalMinutes);
      const endParts = range.end.split(":").map(Number);
      const outAt = new Date(year, month - 1, day, endParts[0], endParts[1] + overtimeMinutes);
      rows.push({
        id: `demo-${employee.id}-${day}`,
        profile: { full_name: employee.name, employee_code: employee.id },
        store: { name: value === "別府" ? "別府店" : "日吉店" },
        clock_in_at: inAt.toISOString(),
        clock_out_at: outAt.toISOString(),
        break_minutes: breakMinutes,
        status: "normal"
      });
    });
  });
  return rows;
}

function formatMinutes(minutes) {
  const safe = Math.max(0, Math.round(minutes || 0));
  return `${Math.floor(safe / 60)}時間${safe % 60 ? `${safe % 60}分` : ""}`;
}

function formatClock(iso) {
  if (!iso) return "未打刻";
  return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

async function loadLaborReport() {
  const [year, month] = document.querySelector("#reportMonth").value.split("-").map(Number);
  const defaultBreak = Number(document.querySelector("#defaultBreakMinutes").value);
  const standardMinutes = Number(document.querySelector("#standardWorkMinutes").value);
  const overtimeRule = document.querySelector("#overtimeRule").value;
  refreshLaborReportButton.disabled = true;
  refreshLaborReportButton.textContent = "集計中…";

  try {
    const sourceRows = cloudMode
      ? await window.CloudAPI.getMonthlyAttendance(year, month)
      : demoMonthlyAttendance(year, month, defaultBreak);
    laborReportRows = sourceRows.map(row => {
      const clockIn = new Date(row.clock_in_at);
      const clockOut = row.clock_out_at ? new Date(row.clock_out_at) : null;
      const breakMinutes = Number(row.break_minutes ?? defaultBreak);
      const spanMinutes = clockOut ? Math.max(0, (clockOut - clockIn) / 60000) : 0;
      const actualMinutes = Math.max(0, spanMinutes - breakMinutes);
      const employeeName = row.profile?.full_name || "従業員";
      const scheduledMinutes = scheduledMinutesFor(employeeName, clockIn, defaultBreak, standardMinutes);
      const scheduledEnd = scheduledEndFor(employeeName, clockIn, defaultBreak, standardMinutes);
      const overtimeMinutes = overtimeRule === "after-shift"
        ? Math.max(0, clockOut ? (clockOut - scheduledEnd) / 60000 : 0)
        : Math.max(0, actualMinutes - scheduledMinutes);
      const needsReview = row.status === "review" || !clockOut;
      return {
        ...row,
        employeeName,
        storeName: row.store?.name || "未設定",
        date: clockIn,
        breakMinutes,
        actualMinutes,
        scheduledMinutes,
        scheduledEnd,
        overtimeMinutes,
        needsReview
      };
    });
    renderLaborReport();
  } catch (error) {
    showToast(error.message || "勤怠集計を取得できませんでした。");
  } finally {
    refreshLaborReportButton.disabled = false;
    refreshLaborReportButton.textContent = "集計する";
  }
}

function renderLaborReport() {
  const grouped = new Map();
  laborReportRows.forEach(row => {
    const current = grouped.get(row.employeeName) || {
      name: row.employeeName, days: 0, actual: 0, overtime: 0, reviews: 0
    };
    current.days += 1;
    current.actual += row.actualMinutes;
    current.overtime += row.overtimeMinutes;
    current.reviews += row.needsReview ? 1 : 0;
    grouped.set(row.employeeName, current);
  });

  const summaries = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  document.querySelector("#laborSummaryBody").innerHTML = summaries.length
    ? summaries.map(item => `<tr>
        <td>${item.name}</td><td>${item.days}</td><td>${formatMinutes(item.actual)}</td>
        <td>${formatMinutes(item.overtime)}</td><td>${item.reviews}</td>
      </tr>`).join("")
    : `<tr><td colspan="5">対象月の勤怠データはありません。</td></tr>`;

  document.querySelector("#laborDetailBody").innerHTML = laborReportRows.length
    ? laborReportRows.map(row => `<tr class="${row.needsReview ? "review-row" : ""}">
        <td>${row.date.toLocaleDateString("ja-JP")}</td>
        <td>${row.employeeName}</td><td>${row.storeName}</td>
        <td>${formatClock(row.clock_in_at)}</td><td>${formatClock(row.clock_out_at)}</td>
        <td>${row.breakMinutes}分</td><td>${formatMinutes(row.actualMinutes)}</td>
        <td>${formatMinutes(row.scheduledMinutes)}</td>
        <td>${row.scheduledEnd.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</td>
        <td>${formatMinutes(row.overtimeMinutes)}</td>
        <td>${row.needsReview ? "要確認" : "確定"}</td>
      </tr>`).join("")
    : `<tr><td colspan="11">対象月の勤怠データはありません。</td></tr>`;

  document.querySelector("#totalActualHours").textContent =
    formatMinutes(laborReportRows.reduce((sum, row) => sum + row.actualMinutes, 0));
  document.querySelector("#totalOvertimeHours").textContent =
    formatMinutes(laborReportRows.reduce((sum, row) => sum + row.overtimeMinutes, 0));
  document.querySelector("#laborReviewCount").textContent =
    `${laborReportRows.filter(row => row.needsReview).length}件`;
}

function showLaborReport() {
  if (!hasManagerAccess()) return blockManagerAccess();
  employeeView.hidden = true;
  managerView.hidden = true;
  monthlyScheduleView.hidden = true;
  scheduleEditorView.hidden = true;
  laborReportView.hidden = false;
  setMobileNavActive("manager");
  window.scrollTo({ top: 0, behavior: "smooth" });
  loadLaborReport();
}

function closeLaborReport() {
  laborReportView.hidden = true;
  if (!hasManagerAccess()) {
    blockManagerAccess();
    return;
  }
  managerView.hidden = false;
  roleSelect.value = "manager";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function reportExportRows() {
  return laborReportRows.map(row => ({
    "日付": row.date.toLocaleDateString("ja-JP"),
    "氏名": row.employeeName,
    "店舗": row.storeName,
    "出勤時刻": formatClock(row.clock_in_at),
    "退勤時刻": formatClock(row.clock_out_at),
    "休憩分": row.breakMinutes,
    "実労働分": Math.round(row.actualMinutes),
    "所定労働分": Math.round(row.scheduledMinutes),
    "予定退勤時刻": row.scheduledEnd.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }),
    "残業分": Math.round(row.overtimeMinutes),
    "残業計算ルール": document.querySelector("#overtimeRule").value === "after-shift"
      ? "予定退勤後のみ（前残業なし）"
      : "実労働－所定時間",
    "状態": row.needsReview ? "要確認" : "確定"
  }));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportLaborCsv() {
  const rows = reportExportRows();
  if (!rows.length) return showToast("出力する勤怠データがありません。");
  const headers = Object.keys(rows[0]);
  const escape = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [headers.map(escape).join(","), ...rows.map(row =>
    headers.map(header => escape(row[header])).join(",")
  )].join("\r\n");
  const month = document.querySelector("#reportMonth").value;
  downloadBlob(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    `あき調剤薬局_勤怠明細_${month}.csv`);
}

function exportLaborXlsx() {
  const rows = reportExportRows();
  if (!rows.length) return showToast("出力する勤怠データがありません。");
  const summaries = {};
  rows.forEach(row => {
    const item = summaries[row["氏名"]] || {
      "氏名": row["氏名"], "勤務日数": 0, "実労働分": 0, "残業分": 0, "要確認件数": 0
    };
    item["勤務日数"] += 1;
    item["実労働分"] += row["実労働分"];
    item["残業分"] += row["残業分"];
    if (row["状態"] === "要確認") item["要確認件数"] += 1;
    summaries[row["氏名"]] = item;
  });
  if (!window.XLSX) {
    exportLaborExcelXml(Object.values(summaries), rows);
    return;
  }
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(Object.values(summaries));
  const detailSheet = XLSX.utils.json_to_sheet(rows);
  summarySheet["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  detailSheet["!cols"] = [
    { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 9 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 9 },
    { wch: 24 }, { wch: 10 }
  ];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "従業員別集計");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "日別勤怠明細");
  XLSX.writeFile(workbook, `あき調剤薬局_勤怠集計_${document.querySelector("#reportMonth").value}.xlsx`);
}

function exportLaborExcelXml(summaryRows, detailRows) {
  const escapeXml = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
  const worksheetXml = (name, rows) => {
    const headers = Object.keys(rows[0] || {});
    const headerCells = headers.map(header =>
      `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`
    ).join("");
    const dataRows = rows.map(row => `<Row>${headers.map(header => {
      const value = row[header];
      const numeric = typeof value === "number";
      return `<Cell><Data ss:Type="${numeric ? "Number" : "String"}">${escapeXml(value)}</Data></Cell>`;
    }).join("")}</Row>`).join("");
    return `<Worksheet ss:Name="${escapeXml(name)}"><Table><Row>${headerCells}</Row>${dataRows}</Table></Worksheet>`;
  };
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial"/></Style>
  <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#D80A68" ss:Pattern="Solid"/></Style>
 </Styles>
 ${worksheetXml("従業員別集計", summaryRows)}
 ${worksheetXml("日別勤怠明細", detailRows)}
</Workbook>`;
  const month = document.querySelector("#reportMonth").value;
  downloadBlob(
    new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" }),
    `あき調剤薬局_勤怠集計_${month}.xls`
  );
  showToast("Excel互換形式で出力しました。");
}

function setMobileNavActive(view) {
  mobileNavButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.mobileView === view);
  });
}

function showEmployeeClock() {
  monthlyScheduleView.hidden = true;
  managerView.hidden = true;
  laborReportView.hidden = true;
  scheduleEditorView.hidden = true;
  employeeView.hidden = false;
  roleSelect.value = "employee";
  monthlyScheduleButton.textContent = "シフト一覧表";
  setMobileNavActive("employee");
  document.querySelector(".clock-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showMyShifts() {
  monthlyScheduleView.hidden = true;
  managerView.hidden = true;
  laborReportView.hidden = true;
  scheduleEditorView.hidden = true;
  employeeView.hidden = false;
  roleSelect.value = "employee";
  monthlyScheduleButton.textContent = "シフト一覧表";
  setMobileNavActive("my-shifts");
  document.querySelector("#shiftList").closest(".card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showManagerMobile() {
  if (!hasManagerAccess()) return blockManagerAccess();
  monthlyScheduleView.hidden = true;
  employeeView.hidden = true;
  laborReportView.hidden = true;
  scheduleEditorView.hidden = true;
  managerView.hidden = false;
  roleSelect.value = "manager";
  monthlyScheduleButton.textContent = "シフト一覧表";
  setMobileNavActive("manager");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openInstallHelp() {
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isIos) {
    openForm(
      "iPhoneへ追加する方法",
      `<ol class="install-steps">
        <li>この画面を<strong>Safari</strong>で開きます。</li>
        <li>下部の共有ボタン（□から↑）を押します。</li>
        <li><strong>「ホーム画面に追加」</strong>を選びます。</li>
        <li>名前が「あき勤怠」になっていることを確認し、<strong>追加</strong>を押します。</li>
      </ol>
      <p class="muted">追加後はホーム画面のアイコンから起動してください。位置情報は打刻時だけ確認します。</p>`,
      "わかりました"
    );
    return;
  }
  openForm(
    "Androidへ追加する方法",
    `<ol class="install-steps">
      <li>Chromeでこの画面を開きます。</li>
      <li>画面上に<strong>「インストール」</strong>が出た場合は押します。</li>
      <li>出ない場合は右上メニューから<strong>「アプリをインストール」</strong>または<strong>「ホーム画面に追加」</strong>を選びます。</li>
    </ol>
    <p class="muted">追加後はホーム画面のアイコンから起動できます。</p>`,
    "わかりました"
  );
}

function updateClock() {
  const now = new Date();
  document.querySelector("#currentTime").textContent = now.toLocaleTimeString("ja-JP");
  document.querySelector("#todayLabel").textContent = now.toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "short"
  });
}

function renderAttendance(filter = "all") {
  const sourceRows = cloudMode ? cloudState.attendanceRows.map(row => ({
    name: row.profile?.full_name || cloudState.profile?.full_name || "従業員",
    store: row.store?.name || "店舗未設定",
    since: new Date(row.clock_in_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }),
    status: row.status === "review" ? "要確認" : "店舗確認済み"
  })) : demoAttendance;
  const rows = sourceRows.filter(person => filter === "all" || person.store === filter);
  document.querySelector("#workingCount").textContent = `${rows.length}人`;
  document.querySelector("#reviewCount").textContent =
    `${sourceRows.filter(person => person.status === "要確認").length}件`;
  if (!rows.length) {
    document.querySelector("#attendanceList").innerHTML =
      `<p class="muted">現在出勤中の従業員はいません。</p>`;
    return;
  }
  document.querySelector("#attendanceList").innerHTML = rows.map(person => `
    <div class="attendance-row">
      <strong>${person.name}</strong>
      <span>${person.store}・${person.since}出勤</span>
      <span class="tag ${person.status === "要確認" ? "warn" : ""}">${person.status}</span>
    </div>`).join("");
}

function syncWorkState() {
  const working = isWorking();
  workStatus.textContent = working ? "勤務中" : "未出勤";
  workStatus.className = `status ${working ? "on" : "off"}`;
  clockOutButton.disabled = !working;
  renderTodayShiftButtons();
}

function renderTodayShiftButtons() {
  if (isWorking()) {
    clockInButton.disabled = true;
    return;
  }
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const value = getEmployeeMonthShifts(selectedEmployee().id, monthKey)[now.getDate() - 1];
  clockInButton.disabled = !shiftDetails(selectedEmployee(), value).canClock;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3200);
}

function getLocation(action) {
  locationMessage.textContent = "位置情報を確認しています…";
  if (!navigator.geolocation) return completeClock(action, null, "位置情報を利用できません（要確認）");
  navigator.geolocation.getCurrentPosition(
    position => completeClock(action, position.coords, `位置を確認しました（精度 約${Math.round(position.coords.accuracy)}m）`),
    () => completeClock(action, null, "位置情報を取得できませんでした（要確認）"),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function resolveClockStore() {
  if (!cloudMode) return null;
  const employee = selectedEmployee();
  const now = new Date();
  let storeName = cloudState.profile?.home_store?.name || "日吉店";
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const value = getEmployeeMonthShifts(employee.id, monthKey)[now.getDate() - 1];
  if (value === "別府") storeName = "別府店";
  else if (value && value !== "休み" && value !== "有給") storeName = "日吉店";
  return cloudState.stores.find(store => store.name === storeName) ||
    cloudState.stores.find(store => store.id === cloudState.profile?.home_store_id) ||
    cloudState.stores[0];
}

async function completeClock(action, coords, message) {
  if (cloudMode) {
    const store = action === "out"
      ? cloudState.stores.find(item => item.id === cloudState.activeSession?.store_id)
      : resolveClockStore();
    if (!store) {
      locationMessage.textContent = "打刻先店舗が設定されていません。";
      showToast("管理者が店舗設定を完了する必要があります。");
      return;
    }
    try {
      clockInButton.disabled = true;
      clockOutButton.disabled = true;
      const result = await window.CloudAPI.clock(action, store.id, coords);
      locationMessage.textContent =
        result.status === "review" ? `${message}・管理者確認が必要です。` : message;
      showToast(action === "in"
        ? `${store.name}への出勤を共有しました。`
        : `${store.name}からの退勤を共有しました。`);
    } catch (error) {
      locationMessage.textContent = "打刻を保存できませんでした。";
      showToast(error.message || "クラウド保存に失敗しました。");
    } finally {
      syncWorkState();
    }
    return;
  }
  localStorage.setItem(workStorageKey(), String(action === "in"));
  localStorage.setItem(`attendance-demo-last-clock-${selectedEmployeeId}`, JSON.stringify({
    employeeId: selectedEmployeeId, action, time: new Date().toISOString(),
    latitude: coords?.latitude, longitude: coords?.longitude, accuracy: coords?.accuracy
  }));
  locationMessage.textContent = message;
  syncWorkState();
  showToast(action === "in" ? "出勤を記録しました。" : "退勤を記録しました。お疲れさまでした。");
}

function applyCloudState(nextState) {
  cloudState = nextState;
  cloudMode = Boolean(nextState.configured && nextState.session);
  connectionBadge.className = "connection-badge";

  if (!nextState.configured) {
    connectionBadge.classList.add("demo");
    connectionBadge.textContent = "試作モード";
    authView.hidden = true;
    mainElement.hidden = false;
    logoutButton.hidden = true;
    return;
  }

  if (!nextState.connected || nextState.lastError) {
    connectionBadge.classList.add("offline");
    connectionBadge.textContent = "接続エラー";
  } else {
    connectionBadge.classList.add("online");
    connectionBadge.textContent = nextState.session ? "クラウド同期中" : "ログイン待ち";
  }

  const signedIn = Boolean(nextState.session && nextState.profile);
  authView.hidden = signedIn;
  mainElement.hidden = !signedIn;
  logoutButton.hidden = !signedIn;
  monthlyScheduleButton.hidden = !signedIn;
  roleSelect.closest("label").hidden = !signedIn;

  if (!signedIn) return;

  const manager = hasManagerAccess();
  roleSelect.querySelector('option[value="manager"]').disabled = !manager;
  document.querySelector('[data-mobile-view="manager"]').hidden = !manager;
  if (!manager && roleSelect.value === "manager") {
    roleSelect.value = "employee";
    employeeView.hidden = false;
    managerView.hidden = true;
    laborReportView.hidden = true;
    scheduleEditorView.hidden = true;
  }
  applyCloudEmployees();
  const matchedEmployee = scheduleData.employees.find(employee =>
    employee.id === nextState.profile.employee_code ||
    employee.name.replace(/\s/g, "") === nextState.profile.full_name.replace(/\s/g, "")
  );
  if (matchedEmployee) selectedEmployeeId = matchedEmployee.id;

  populateEmployees();
  populateLeaveEmployees();
  renderStoreSettings();
  renderEmployeeSchedule();
  renderAttendance(document.querySelector("#storeFilter").value);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthsToSync = new Set(["2026-07", "2026-08", currentMonth]);
  monthsToSync.forEach(monthKey => syncMonthFromCloud(monthKey));
  if (nextState.scheduleChangedMonth &&
      nextState.scheduleChangedMonth !== lastScheduleChangedMonth) {
    lastScheduleChangedMonth = nextState.scheduleChangedMonth;
    syncMonthFromCloud(nextState.scheduleChangedMonth);
  }
}

function openForm(title, body, confirmLabel = "保存する", onConfirm = null) {
  dialogTitle.textContent = title;
  dialogBody.innerHTML = body;
  dialogConfirm.textContent = confirmLabel;
  dialogConfirmHandler = onConfirm;
  appDialog.showModal();
}

employeeSelect.addEventListener("change", event => {
  selectedEmployeeId = event.target.value;
  localStorage.setItem("attendance-demo-employee", selectedEmployeeId);
  renderEmployeeSchedule();
});
roleSelect.addEventListener("change", event => {
  const manager = event.target.value === "manager";
  if (manager && !hasManagerAccess()) {
    blockManagerAccess();
    return;
  }
  monthlyScheduleView.hidden = true;
  laborReportView.hidden = true;
  scheduleEditorView.hidden = true;
  employeeView.hidden = manager;
  managerView.hidden = !manager;
  monthlyScheduleButton.textContent = "シフト一覧表";
  setMobileNavActive(manager ? "manager" : "employee");
});
monthlyScheduleButton.addEventListener("click", () => {
  showMonthlySchedule();
  setMobileNavActive("monthly");
});
closeMonthlyScheduleButton.addEventListener("click", closeMonthlySchedule);
scheduleEditorButton.addEventListener("click", showScheduleEditor);
closeScheduleEditorButton.addEventListener("click", closeScheduleEditor);
scheduleEditorMonth.addEventListener("change", () => renderScheduleEditor());
saveScheduleButton.addEventListener("click", saveScheduleDraft);
copyPreviousMonthButton.addEventListener("click", copyPreviousMonth);
clearScheduleButton.addEventListener("click", clearScheduleDraft);
employeeScheduleMonth.addEventListener("change", renderEmployeeSchedule);
monthlyScheduleMonth.addEventListener("change", renderMonthlySchedule);
document.querySelector("#scheduleEditorTable").addEventListener("change", event => {
  const select = event.target.closest("select[data-employee-id]");
  if (!select) return;
  const employeeId = select.dataset.employeeId;
  const dayIndex = Number(select.dataset.day) - 1;
  let value = select.value;
  if (value === "__custom__") {
    value = window.prompt(
      "勤務時間を入力してください（例：9:00-14:00）",
      scheduleDraft[employeeId][dayIndex] || "9:00-14:00"
    );
    if (value === null) {
      renderScheduleEditor(true);
      return;
    }
    value = value.trim();
  }
  scheduleDraft[employeeId][dayIndex] = value;
  const cell = select.closest("td");
  cell.className = `schedule-cell ${scheduleCellClass(value)}`;
  if (value && !["早", "遅", "休み", "別府", "有給"].includes(value)) {
    select.options[select.selectedIndex].textContent = value;
  }
});
laborReportButton.addEventListener("click", showLaborReport);
closeLaborReportButton.addEventListener("click", closeLaborReport);
refreshLaborReportButton.addEventListener("click", loadLaborReport);
exportXlsxButton.addEventListener("click", exportLaborXlsx);
exportCsvButton.addEventListener("click", exportLaborCsv);
leaveEmployeeSelect.addEventListener("change", loadLeaveLedger);
saveLeaveGrantButton.addEventListener("click", saveLeaveGrant);
mobileNavButtons.forEach(button => {
  button.addEventListener("click", () => {
    const view = button.dataset.mobileView;
    if (view === "employee") showEmployeeClock();
    if (view === "my-shifts") showMyShifts();
    if (view === "monthly") {
      showMonthlySchedule();
      setMobileNavActive("monthly");
    }
    if (view === "manager") showManagerMobile();
  });
});
installButton.addEventListener("click", async () => {
  if (!installPrompt) {
    openInstallHelp();
    return;
  }
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  updateInstallButtonVisibility();
});
if (installGuideButton) installGuideButton.addEventListener("click", openInstallHelp);
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  updateInstallButtonVisibility();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  updateInstallButtonVisibility();
  showToast("ホーム画面に追加されました。");
});
loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginMessage.textContent = "";
  loginButton.disabled = true;
  loginButton.textContent = "ログイン中…";
  try {
    await window.CloudAPI.signIn(
      document.querySelector("#loginEmail").value.trim(),
      document.querySelector("#loginPassword").value
    );
  } catch (error) {
    loginMessage.textContent = error.message || "ログインできませんでした。";
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "ログイン";
  }
});
logoutButton.addEventListener("click", async () => {
  try {
    await window.CloudAPI.signOut();
  } catch (error) {
    showToast(error.message || "ログアウトできませんでした。");
  }
});
clockInButton.addEventListener("click", () => getLocation("in"));
clockOutButton.addEventListener("click", () => getLocation("out"));
document.querySelector("#storeFilter").addEventListener("change", event => renderAttendance(event.target.value));
document.querySelector("#managerDate").addEventListener("change", renderManagerSchedule);
settingsStore.addEventListener("change", renderStoreSettings);
saveStoreSettingsButton.addEventListener("click", saveStoreSettings);

document.querySelector("#correctionButton").addEventListener("click", () => openForm(
  "勤怠の修正申請",
  `<div class="form-grid">
    <label>修正する日<input type="date"></label>
    <label>内容<select><option>出勤打刻を忘れた</option><option>退勤打刻を忘れた</option><option>時刻を間違えた</option></select></label>
    <label>正しい時刻<input type="time"></label>
    <label>理由<textarea rows="3" placeholder="理由を入力してください"></textarea></label>
  </div>`,
  "申請する"
));

document.querySelector("#requestShiftButton").addEventListener("click", () => openForm(
  "シフト希望を提出",
  `<div class="form-grid">
    <label>希望日<input id="shiftRequestDate" type="date"></label>
    <label>希望
      <select id="shiftRequestType">
        <option value="available">出勤可能</option>
        <option value="off">休み希望</option>
        <option value="paid">有給休暇</option>
        <option value="time">時間を指定</option>
      </select>
    </label>
    <label>有給日数
      <select id="paidLeaveDays">
        <option value="1">1日</option>
        <option value="0.5">半日</option>
      </select>
    </label>
    <label>備考<textarea id="shiftRequestNote" rows="3"></textarea></label>
  </div>`,
  "提出する",
  submitShiftRequest
));

document.querySelector("#addShiftButton").addEventListener("click", () => openForm(
  "シフトを追加",
  `<div class="form-grid">
    <label>従業員<select>${scheduleData.employees.map(employee => `<option>${employee.name}</option>`).join("")}</select></label>
    <label>勤務日<input type="date" min="2026-07-01" max="2026-12-31"></label>
    <label>店舗<select><option>日吉店</option><option>別府店</option></select></label>
    <label>出勤<input type="time"></label>
    <label>退勤<input type="time"></label>
  </div>`
));

appDialog.addEventListener("close", async () => {
  if (appDialog.returnValue !== "confirm") {
    dialogConfirmHandler = null;
    return;
  }
  if (!dialogConfirmHandler) {
    showToast("内容を保存しました（試作版）。");
    return;
  }
  try {
    await dialogConfirmHandler();
  } catch (error) {
    showToast(error.message || "保存できませんでした。");
  } finally {
    dialogConfirmHandler = null;
  }
});

populateMonthSelectors();
populateEmployees();
updateClock();
setInterval(updateClock, 1000);
renderEmployeeSchedule();
renderManagerSchedule();
renderAttendance();
renderMonthlySchedule();
populateLeaveEmployees();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js");
}

updateInstallButtonVisibility();
const mobileScreenQuery = window.matchMedia("(max-width: 680px)");
if (mobileScreenQuery.addEventListener) {
  mobileScreenQuery.addEventListener("change", updateInstallButtonVisibility);
} else if (mobileScreenQuery.addListener) {
  mobileScreenQuery.addListener(updateInstallButtonVisibility);
}

window.CloudAPI.subscribe(applyCloudState);
window.CloudAPI.init().then(applyCloudState).catch(error => {
  connectionBadge.className = "connection-badge offline";
  connectionBadge.textContent = "接続エラー";
  showToast(error.message || "クラウドへ接続できませんでした。");
});
