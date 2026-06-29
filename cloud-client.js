(function () {
  const SOLE_ADMIN_EMPLOYEE_CODE = "fujiwara-soshi";
  const listeners = new Set();
  const state = {
    configured: false,
    connected: false,
    session: null,
    authUser: null,
    profile: null,
    stores: [],
    activeSession: null,
    attendanceRows: [],
    employeeProfiles: [],
    scheduleChangedMonth: null,
    lastError: null
  };
  let client = null;
  let realtimeChannel = null;

  function hasAdminAccess(profile = state.profile) {
    return profile?.role === "admin" && profile?.employee_code === SOLE_ADMIN_EMPLOYEE_CODE;
  }

  function emit() {
    listeners.forEach(listener => listener({ ...state }));
  }

  function isConfigured() {
    const config = window.APP_CONFIG || {};
    return Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
  }

  async function init() {
    state.configured = isConfigured();
    if (!state.configured) {
      emit();
      return { ...state };
    }

    try {
      client = window.supabase.createClient(
        window.APP_CONFIG.supabaseUrl,
        window.APP_CONFIG.supabaseAnonKey,
        { auth: { persistSession: true, autoRefreshToken: true } }
      );
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      state.session = data.session;
      state.authUser = data.session?.user
        ? { id: data.session.user.id, email: data.session.user.email }
        : null;
      state.connected = true;
      if (state.session) await loadUserContext();

      client.auth.onAuthStateChange(async (_event, session) => {
        state.session = session;
        state.authUser = session?.user
          ? { id: session.user.id, email: session.user.email }
          : null;
        if (session) await loadUserContext();
        else clearUserContext();
        emit();
      });
    } catch (error) {
      state.connected = false;
      state.lastError = error.message;
    }
    emit();
    return { ...state };
  }

  function clearUserContext() {
    state.profile = null;
    state.authUser = null;
    state.stores = [];
    state.activeSession = null;
    state.attendanceRows = [];
    if (realtimeChannel && client) client.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  async function signIn(email, password) {
    if (!client) throw new Error("クラウド設定が完了していません。");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function loadUserContext() {
    const userId = state.session.user.id;
    const [profileResult, storesResult, activeResult] = await Promise.all([
      client
        .from("profiles")
        .select("id, full_name, role, job_title, employee_code, home_store_id, home_store:stores!home_store_id(id,name,code)")
        .eq("id", userId)
        .maybeSingle(),
      client.from("stores").select("id,name,code,latitude,longitude,radius_m").eq("active", true).order("name"),
      client
        .from("attendance_sessions")
        .select("id,profile_id,store_id,clock_in_at,status,store:stores(id,name,code)")
        .eq("profile_id", userId)
        .is("clock_out_at", null)
        .maybeSingle()
    ]);

    if (storesResult.error) throw storesResult.error;
    if (activeResult.error) throw activeResult.error;
    if (profileResult.error) throw profileResult.error;

    state.profile = profileResult.data;
    state.stores = storesResult.data || [];
    state.activeSession = activeResult.data;
    if (!state.profile) {
      state.employeeProfiles = [];
      state.attendanceRows = [];
      if (realtimeChannel && client) client.removeChannel(realtimeChannel);
      realtimeChannel = null;
      return;
    }
    if (hasAdminAccess()) {
      const profilesResult = await client
        .from("profiles")
        .select("id,full_name,employee_code,role,job_title,home_store_id,home_store:stores!home_store_id(id,name,code)")
        .order("full_name");
      if (profilesResult.error) throw profilesResult.error;
      state.employeeProfiles = profilesResult.data || [];
    } else {
      state.employeeProfiles = [state.profile];
    }
    await loadAttendanceRows();
    subscribeRealtime();
  }

  async function loadAttendanceRows() {
    if (!client || !state.session) return;
    if (!hasAdminAccess()) {
      state.attendanceRows = state.activeSession ? [state.activeSession] : [];
      return;
    }
    const { data, error } = await client
      .from("attendance_sessions")
      .select(`
        id, profile_id, store_id, clock_in_at, clock_out_at, status,
        in_distance_m, in_accuracy_m,
        profile:profiles!profile_id(full_name,employee_code),
        store:stores!store_id(name,code)
      `)
      .is("clock_out_at", null)
      .order("clock_in_at", { ascending: true });
    if (error) throw error;
    state.attendanceRows = data || [];
  }

  function subscribeRealtime() {
    if (!client || realtimeChannel) return;
    realtimeChannel = client
      .channel("attendance-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance_sessions" },
        async () => {
          await refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_entries" },
        async payload => {
          const shiftDate = payload.new?.shift_date || payload.old?.shift_date;
          state.scheduleChangedMonth = shiftDate ? shiftDate.slice(0, 7) : null;
          emit();
        }
      )
      .subscribe();
  }

  async function refresh() {
    if (!client || !state.session) return;
    const { data, error } = await client
      .from("attendance_sessions")
      .select("id,profile_id,store_id,clock_in_at,status,store:stores(id,name,code)")
      .eq("profile_id", state.session.user.id)
      .is("clock_out_at", null)
      .maybeSingle();
    if (error) throw error;
    state.activeSession = data;
    await loadAttendanceRows();
    emit();
  }

  async function getMonthlyAttendance(year, month) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    if (!hasAdminAccess()) {
      throw new Error("管理者権限が必要です。");
    }
    const start = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const end = new Date(Date.UTC(year, month, 1)).toISOString();
    const { data, error } = await client
      .from("attendance_sessions")
      .select(`
        id, profile_id, store_id, clock_in_at, clock_out_at, break_minutes, status,
        in_distance_m, out_distance_m,
        profile:profiles!profile_id(full_name,employee_code),
        store:stores!store_id(name,code)
      `)
      .gte("clock_in_at", start)
      .lt("clock_in_at", end)
      .order("clock_in_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function clock(action, storeId, coords) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    const { data, error } = await client.rpc("clock_attendance", {
      p_action: action,
      p_store_id: storeId,
      p_latitude: coords?.latitude ?? null,
      p_longitude: coords?.longitude ?? null,
      p_accuracy_m: coords?.accuracy ?? null,
      p_device_time: new Date().toISOString()
    });
    if (error) throw error;
    await refresh();
    return data;
  }

  async function createLeaveRequest(requestDate, days, note) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    const { error } = await client.from("leave_requests").insert({
      profile_id: state.session.user.id,
      request_date: requestDate,
      leave_type: "paid",
      days,
      note: note || null
    });
    if (error) throw error;
  }

  async function getLeaveLedger(profileId) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    const [grantsResult, requestsResult] = await Promise.all([
      client.from("paid_leave_grants")
        .select("id,profile_id,grant_date,days,note,created_at")
        .eq("profile_id", profileId)
        .order("grant_date", { ascending: false }),
      client.from("leave_requests")
        .select("id,request_date,days,status,note")
        .eq("profile_id", profileId)
        .eq("leave_type", "paid")
    ]);
    if (grantsResult.error) throw grantsResult.error;
    if (requestsResult.error) throw requestsResult.error;
    const allGrants = grantsResult.data || [];
    const cancelledGrantIds = new Set();
    allGrants.forEach(item => {
      const note = String(item.note || "");
      const match = note.match(/^削除済み:([0-9a-f-]+)/i);
      if (match) cancelledGrantIds.add(match[1]);
    });
    const grants = allGrants.filter(item =>
      Number(item.days) > 0 &&
      !String(item.note || "").startsWith("削除済み") &&
      !cancelledGrantIds.has(item.id)
    );
    const requests = requestsResult.data || [];
    const granted = grants.reduce((sum, item) => sum + Number(item.days), 0);
    const used = requests
      .filter(item => item.status === "approved")
      .reduce((sum, item) => sum + Number(item.days), 0);
    return { grants, requests, granted, used, remaining: granted - used };
  }

  async function addLeaveGrant(profileId, grantDate, days, note) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    if (!hasAdminAccess()) {
      throw new Error("管理者権限が必要です。");
    }
    const { error } = await client.from("paid_leave_grants").insert({
      profile_id: profileId,
      grant_date: grantDate,
      days,
      note: note || null,
      created_by: state.session.user.id
    });
    if (error) throw error;
  }

  async function updateLeaveGrant(grantId, profileId, grantDate, days, note) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    if (!hasAdminAccess()) {
      throw new Error("管理者権限が必要です。");
    }
    const { error } = await client
      .from("paid_leave_grants")
      .update({
        profile_id: profileId,
        grant_date: grantDate,
        days,
        note: note || null
      })
      .eq("id", grantId);
    if (error) throw error;
  }

  async function deleteLeaveGrant(grantId, profileId, grantDate, days) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    if (!hasAdminAccess()) {
      throw new Error("管理者権限が必要です。");
    }
    if (grantId) {
      const { data, error } = await client
        .from("paid_leave_grants")
        .delete()
        .eq("id", grantId)
        .select("id");
      if (error) throw error;
      if (data?.length) return;

      const { data: cancelledByIdRows, error: cancelByIdError } = await client
        .from("paid_leave_grants")
        .update({
          days: 0,
          note: "削除済み（管理者による取り消し）"
        })
        .eq("id", grantId)
        .select("id");
      if (cancelByIdError) throw cancelByIdError;
      if (cancelledByIdRows?.length) return;
    }

    const { data: cancelledRows, error: cancelError } = await client
      .from("paid_leave_grants")
      .update({
        days: 0,
        note: "削除済み（管理者による取り消し）"
      })
      .eq("profile_id", profileId)
      .eq("grant_date", grantDate)
      .eq("days", days)
      .select("id");
    if (cancelError) throw cancelError;
    if (cancelledRows?.length) return;

    const { error: insertCancelError } = await client
      .from("paid_leave_grants")
      .insert({
        profile_id: profileId,
        grant_date: grantDate,
        days: -Math.abs(Number(days) || 0),
        note: `削除済み:${grantId}（管理者による取り消し）`,
        created_by: state.session.user.id
      });
    if (insertCancelError) {
      throw new Error(`削除できませんでした。Supabaseの有給付与テーブルで更新・削除・取消追加の権限を確認してください。詳細: ${insertCancelError.message}`);
    }
  }

  async function saveEmployeeProfile(profile) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    if (!hasAdminAccess()) {
      throw new Error("管理者権限が必要です。");
    }
    const payload = {
      id: profile.id,
      full_name: profile.full_name,
      employee_code: profile.employee_code || null,
      role: profile.id === state.profile?.id && profile.employee_code === SOLE_ADMIN_EMPLOYEE_CODE
        ? "admin"
        : "employee",
      job_title: profile.job_title || "一般従事者",
      home_store_id: profile.home_store_id || null
    };
    const { id, ...profileFields } = payload;
    const { data: updatedRows, error: updateError } = await client
      .from("profiles")
      .update(profileFields)
      .eq("id", id)
      .select("id");
    if (updateError) throw updateError;

    if (!updatedRows?.length) {
      const { error: insertError } = await client
        .from("profiles")
        .insert(payload);
      if (insertError) throw insertError;
    }
    await loadUserContext();
    emit();
  }

  async function updateStoreSettings(storeId, latitude, longitude, radiusM) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    if (!hasAdminAccess()) {
      throw new Error("管理者権限が必要です。");
    }
    const { error } = await client
      .from("stores")
      .update({ latitude, longitude, radius_m: radiusM })
      .eq("id", storeId);
    if (error) throw error;
    await loadUserContext();
    emit();
  }

  async function getMonthSchedule(monthKey) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    const [year, month] = monthKey.split("-").map(Number);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(Date.UTC(year, month, 1));
    const end = endDate.toISOString().slice(0, 10);
    const { data, error } = await client
      .from("shift_entries")
      .select("employee_code,shift_date,shift_value")
      .gte("shift_date", start)
      .lt("shift_date", end);
    if (error) throw error;
    return data || [];
  }

  async function saveMonthSchedule(monthKey, matrix) {
    if (!client || !state.session) throw new Error("ログインが必要です。");
    if (!hasAdminAccess()) {
      throw new Error("管理者権限が必要です。");
    }
    const [year, month] = monthKey.split("-").map(Number);
    const rows = [];
    Object.entries(matrix).forEach(([employeeCode, shifts]) => {
      shifts.forEach((shiftValue, index) => {
        rows.push({
          employee_code: employeeCode,
          shift_date: `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
          shift_value: shiftValue || "",
          updated_by: state.session.user.id
        });
      });
    });
    const { error } = await client.from("shift_entries")
      .upsert(rows, { onConflict: "employee_code,shift_date" });
    if (error) throw error;
  }

  window.CloudAPI = {
    state,
    init,
    signIn,
    signOut,
    refresh,
    getMonthlyAttendance,
    clock,
    createLeaveRequest,
    getLeaveLedger,
    addLeaveGrant,
    updateLeaveGrant,
    deleteLeaveGrant,
    saveEmployeeProfile,
    updateStoreSettings,
    getMonthSchedule,
    saveMonthSchedule,
    hasAdminAccess,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
})();
