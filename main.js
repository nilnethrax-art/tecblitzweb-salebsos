(function(){
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
  console.log("CONFIG:", window.APP_CONFIG);
  const client = window.APP_API.createClient();

  if(SUPABASE_URL && SUPABASE_ANON_KEY){
    window.SB_URL = SUPABASE_URL;
    window.BASE_HDR = {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + SUPABASE_ANON_KEY
    };
  }

  function showStartupConfigError(msg){
    console.error(msg);
    const target = document.getElementById('login-error');
    if(target){
      target.style.color = 'var(--red)';
      target.textContent = msg;
    }
  }

  function waitForSupabaseSdk(onReady, onTimeout){
    var attempts = 0;
    var maxAttempts = 200;
    function tick(){
      if(window.supabase && typeof window.supabase.createClient === 'function'){
        onReady();
        return;
      }
      if(++attempts >= maxAttempts){
        if(typeof onTimeout === 'function') onTimeout();
        return;
      }
      setTimeout(tick, 25);
    }
    tick();
  }

  function initAfterSupabaseLoaded(){
    var authClient = window.APP_SUPABASE_CLIENT;
    if(!authClient && SUPABASE_URL && SUPABASE_ANON_KEY){
      try{
        authClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.APP_SUPABASE_CLIENT = authClient;
      } catch(e){
        console.error("Supabase createClient error:", e);
        authClient = null;
      }
    }

    if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
      showStartupConfigError("Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY in config.js.");
    } else if(authClient){
      console.log("Supabase initialized");
      // TEMPORARY: one-time DB cleanup for Fasith/Shehan — remove after confirming gone from sales_users
      if(typeof window.deleteGhostUsers === "function" && !sessionStorage.getItem("tecb_ghost_users_cleaned_v1")){
        window.deleteGhostUsers().then(function(){
          sessionStorage.setItem("tecb_ghost_users_cleaned_v1", "1");
          if(typeof window.refreshTeamMembers === "function"){
            return window.refreshTeamMembers();
          }
        }).catch(function(e){ console.error("deleteGhostUsers failed:", e); });
      }
    } else {
      showStartupConfigError("Supabase auth client could not be created.");
    }

    window.handleLoginResponse = function(loginResult){
      if(!loginResult || loginResult.error){
        const msg = loginResult && loginResult.error && loginResult.error.message
          ? loginResult.error.message
          : "Login failed";
        const target = document.getElementById('login-error');
        if(target){
          target.style.color = 'var(--red)';
          target.textContent = msg;
        }
        return false;
      }
      return true;
    };

    window.SB_URL = SUPABASE_URL || "";
    window.SB_KEY = SUPABASE_ANON_KEY || "";
    window.BASE_HDR = window.APP_API.baseHeaders();
    window.sbAuth = authClient;
    window.supabase = {
      createClient: function(){ return client; },
      from: function(table){ return client.from(table); },
      auth: authClient ? authClient.auth : null
    };
  }

  waitForSupabaseSdk(initAfterSupabaseLoaded, function(){
    showStartupConfigError("Supabase SDK unavailable. Check script loading order (Supabase CDN before main.js).");
    window.handleLoginResponse = function(loginResult){
      if(!loginResult || loginResult.error){
        const msg = loginResult && loginResult.error && loginResult.error.message
          ? loginResult.error.message
          : "Login failed";
        const target = document.getElementById('login-error');
        if(target){
          target.style.color = 'var(--red)';
          target.textContent = msg;
        }
        return false;
      }
      return true;
    };
    window.SB_URL = SUPABASE_URL || "";
    window.SB_KEY = SUPABASE_ANON_KEY || "";
    window.BASE_HDR = window.APP_API.baseHeaders();
    window.sbAuth = null;
    window.supabase = {
      createClient: function(){ return client; },
      from: function(table){ return client.from(table); },
      auth: null
    };
  });
})();

/* ── Role-based prospect / call / lead visibility ── */
(function(){
  function canon(rep){
    if(typeof window.canonicalRepKey === 'function') return window.canonicalRepKey(rep);
    return rep == null ? '' : String(rep).trim();
  }

  function normalizeOwnedReps(raw){
    if(window.APP_API && typeof window.APP_API.normalizeOwnedRepsBigint === 'function'){
      return window.APP_API.normalizeOwnedRepsBigint(raw);
    }
    if(raw == null) return [];
    if(!Array.isArray(raw)) return [];
    return raw.map(function(x){ return parseInt(x, 10); }).filter(function(n){ return isFinite(n) && n > 0; });
  }

  function getRepIdForKey(key, USERS){
    if(window.APP_API && typeof window.APP_API.getSalesUserIdForKey === 'function'){
      return window.APP_API.getSalesUserIdForKey(key, USERS);
    }
    return null;
  }

  function getUser(uid, USERS){
    return (USERS || window.USERS || {})[uid];
  }

  function isDirectorCEO(uid, USERS){
    var u = getUser(uid, USERS);
    return !!(u && u.role === 'CEO');
  }

  function isCoCEO(uid, USERS){
    return getUser(uid, USERS)?.role === 'Co-CEO';
  }

  function isCOOTier(uid, USERS){
    return getUser(uid, USERS)?.tier === 'coo';
  }

  function isScopedManager(uid, USERS){
    return isCoCEO(uid, USERS) || isCOOTier(uid, USERS);
  }

  function isSalesRepKey(k, USERS){
    var u = USERS[k];
    if(!u) return false;
    return u.tier === 'rep' || u.role === 'Sales' || u.role === 'Rep' || u.role === 'Sales Rep';
  }

  function getSalesRepUids(USERS){
    var out = [];
    Object.keys(USERS || {}).forEach(function(k){
      if(isSalesRepKey(k, USERS)) out.push(canon(k));
    });
    return out;
  }

  function getOwnedRepIds(uid, USERS){
    var u = getUser(uid, USERS);
    if(!u) return [];
    var owned = normalizeOwnedReps(u.owned_reps);
    if(!owned.length && typeof window.ls === 'function'){
      var tm = window.ls('tm_rep_' + uid) || {};
      owned = normalizeOwnedReps(tm.owned_reps);
    }
    if(!owned.length && (isCOOTier(uid, USERS) || isCoCEO(uid, USERS)) && typeof window.getCOORepUIDs === 'function'){
      var legacy = window.getCOORepUIDs(uid) || [];
      owned = legacy.map(function(k){ return getRepIdForKey(k, USERS); }).filter(function(n){ return n != null; });
    }
    var seen = {};
    return owned.filter(function(n){
      if(n == null || seen[n]) return false;
      seen[n] = true;
      return true;
    });
  }

  function getOwnedRepUIDs(uid, USERS){
    return getOwnedRepIds(uid, USERS);
  }

  function getVisibleRepUIDs(currentUid, USERS){
    if(isDirectorCEO(currentUid, USERS)) return getSalesRepUids(USERS);
    if(isScopedManager(currentUid, USERS)) return getOwnedRepUIDs(currentUid, USERS);
    return [canon(currentUid)];
  }

  function assignKeysEqual(a, b){
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function getAssignedKey(record, assignField){
    if(assignField === 'assignedTo'){
      return canon(
        record.assignedTo || record.assignedto || record.assigned_to
        || record.assigned_rep_id || record.assignee || ''
      );
    }
    return canon(record.rep || record.assignedTo || record.assignedto || '');
  }

  function repTokensForUser(currentUid, USERS){
    var u = getUser(currentUid, USERS);
    var k = canon(currentUid);
    var tokens = [];
    if(k) tokens.push(k);
    if(u && u.name && String(u.name).trim()) tokens.push(String(u.name).trim());
    var seen = {};
    return tokens.filter(function(t){
      var low = String(t).toLowerCase();
      if(!low || seen[low]) return false;
      seen[low] = true;
      return true;
    });
  }

  function canSeeAssignedRecord(record, currentUid, USERS, assignField){
    if(!currentUid || !record) return false;
    if(isDirectorCEO(currentUid, USERS)) return true;
    var key = getAssignedKey(record, assignField);
    var assignId = getRepIdForKey(key, USERS) || ( /^\d+$/.test(key) ? parseInt(key, 10) : null );
    if(!key && assignField === 'assignedTo') return false;
    if(isScopedManager(currentUid, USERS)){
      if(assignId != null) return getOwnedRepIds(currentUid, USERS).indexOf(assignId) !== -1;
      return false;
    }
    var selfId = getRepIdForKey(currentUid, USERS);
    if(assignId != null && selfId != null) return assignId === selfId;
    var mine = repTokensForUser(currentUid, USERS);
    for(var i = 0; i < mine.length; i++){
      if(assignKeysEqual(key, mine[i])) return true;
    }
    return false;
  }

  function filterRecords(records, currentUid, USERS, assignField){
    return (records || []).filter(function(r){
      return canSeeAssignedRecord(r, currentUid, USERS, assignField);
    });
  }

  function buildRoleFilterQuery(table, currentUid, USERS){
    if(window.APP_API && typeof window.APP_API.buildRoleFilterQuery === "function"){
      return window.APP_API.buildRoleFilterQuery(table, currentUid, USERS);
    }
    return "";
  }

  async function loadProspects(currentUid, USERS){
    if(window.APP_API && typeof window.APP_API.fetchRoleFilteredTable === "function"){
      return window.APP_API.fetchRoleFilteredTable("prospects", currentUid, USERS);
    }
    return { data: [], error: { message: "APP_API not ready" } };
  }

  async function loadCalls(currentUid, USERS){
    if(window.APP_API && typeof window.APP_API.fetchRoleFilteredTable === "function"){
      return window.APP_API.fetchRoleFilteredTable("calls", currentUid, USERS);
    }
    return { data: [], error: { message: "APP_API not ready" } };
  }

  async function loadLeads(currentUid, USERS){
    if(window.APP_API && typeof window.APP_API.fetchRoleFilteredTable === "function"){
      return window.APP_API.fetchRoleFilteredTable("interested_leads", currentUid, USERS);
    }
    return { data: [], error: { message: "APP_API not ready" } };
  }

  window.SALES_OS = {
    normalizeOwnedReps: normalizeOwnedReps,
    getOwnedRepIds: getOwnedRepIds,
    getRepIdForKey: getRepIdForKey,
    isDirectorCEO: isDirectorCEO,
    isCoCEO: isCoCEO,
    isCOOTier: isCOOTier,
    isScopedManager: isScopedManager,
    getOwnedRepUIDs: getOwnedRepUIDs,
    getVisibleRepUIDs: getVisibleRepUIDs,
    getSalesRepUids: getSalesRepUids,
    canSeeAssignedRecord: canSeeAssignedRecord,
    filterRecords: filterRecords,
    getAssignedKey: getAssignedKey,
    buildRoleFilterQuery: buildRoleFilterQuery,
    loadProspects: loadProspects,
    loadCalls: loadCalls,
    loadLeads: loadLeads
  };
})();

/* ── Dynamic USERS registry from Supabase sales_users (no hardcoded list) ── */
(function(){
  var TABLE = "sales_users";

  function canonKey(rep){
    if(typeof window.canonicalRepKey === "function") return window.canonicalRepKey(rep);
    if(rep == null || rep === "") return "";
    return String(rep).trim();
  }

  function applyUserTier(u, key){
    if(!u) return u;
    key = key || u._key || "";
    u.name = (u.name && String(u.name).trim()) ? String(u.name).trim() : key;
    u.handle = u.handle || ("@" + String(key).toLowerCase());
    if(u.role === "CEO" || u.role === "Co-CEO") u.tier = "ceo";
    else if(u.role === "COO" || u.role === "Chief Operating Officer") u.tier = "coo";
    else if(u.role === "Sales Manager") u.tier = "management";
    else u.tier = "rep";
    return u;
  }

  function registerFromRow(row, users){
    users = users || window.USERS || {};
    if(!row) return "";
    var key = canonKey(row.username || row.name || "");
    if(!key) return "";
    var displayName = (row.name && String(row.name).trim()) ? String(row.name).trim() : key;
    var rowId = window.APP_API && window.APP_API.toBigintId
      ? window.APP_API.toBigintId(row.id)
      : (row.id != null ? parseInt(row.id, 10) : null);
    var owned = window.SALES_OS && window.SALES_OS.normalizeOwnedReps
      ? window.SALES_OS.normalizeOwnedReps(row.owned_reps)
      : [];
    users[key] = applyUserTier({
      name: displayName,
      role: row.role || "Sales",
      email: row.email || "",
      owned_reps: owned,
      supabaseId: rowId != null && isFinite(rowId) ? rowId : null,
      source: "cloud"
    }, key);
    users[key]._key = key;
    if(rowId != null){
      window._salesUserIdByKey = window._salesUserIdByKey || {};
      window._salesUserKeyById = window._salesUserKeyById || {};
      window._salesUserIdByKey[key] = rowId;
      window._salesUserKeyById[rowId] = key;
    }
    window.USERS = users;
    return key;
  }

  async function fetchRowsByFilter(column, value){
    var client = window.APP_SUPABASE_CLIENT;
    if(client && typeof client.from === "function"){
      try{
        var result = await client.from(TABLE).select("*").eq(column, value).limit(1);
        var rows = result.data;
        if(Array.isArray(rows) && rows.length) return rows[0];
        if(rows && !Array.isArray(rows)) return rows;
      }catch(_e){}
    }
    if(!window.SB_URL || !window.BASE_HDR || value == null) return null;
    try{
      var url = window.SB_URL + "/rest/v1/" + TABLE + "?select=*&" + column + "=eq." + encodeURIComponent(value) + "&limit=1";
      var res = await fetch(url, { headers: window.BASE_HDR });
      var data = await res.json();
      if(Array.isArray(data) && data.length) return data[0];
    }catch(_e2){}
    return null;
  }

  async function fetchOne(identifier){
    var key = canonKey(identifier);
    if(!key) return null;
    var row = await fetchRowsByFilter("username", key);
    if(!row) row = await fetchRowsByFilter("name", key);
    if(!row && String(identifier).indexOf("@") !== -1) row = await fetchRowsByFilter("email", identifier);
    if(row) registerFromRow(row);
    return row;
  }

  async function bootstrapAll(){
    window.USERS = window.USERS || {};
    var data = [];
    if(typeof window.fetchTeamMembersFresh === "function"){
      var res = await window.fetchTeamMembersFresh();
      if(!res.error) data = res.data || [];
    } else {
      var client = window.APP_SUPABASE_CLIENT;
      if(client && typeof client.from === "function"){
        var result = await client.from(TABLE).select("*").order("id", { ascending: true });
        data = result.data || [];
      }
    }
    (data || []).forEach(function(row){ registerFromRow(row); });
    return data;
  }

  async function ensureCurrentUser(key){
    key = canonKey(key || window.currentUser);
    if(!key) return null;
    if(window.USERS && window.USERS[key]) return window.USERS[key];
    if(typeof window.restoreSessionUserFromStorage === "function"){
      var cached = window.restoreSessionUserFromStorage();
      if(cached && window.USERS[key]) return window.USERS[key];
    }
    await fetchOne(key);
    return window.USERS && window.USERS[key] ? window.USERS[key] : null;
  }

  function resolveLoginKey(row, email){
    if(!row) return "";
    var key = canonKey(row.username || row.name || "");
    if(key) return key;
    var em = (email || row.email || "").trim();
    return em.indexOf("@") !== -1 ? canonKey(em.split("@")[0]) : canonKey(em);
  }

  function persistSessionUser(key, row){
    key = canonKey(key);
    if(!key) return null;
    window.currentUser = key;
    if(row){
      registerFromRow(row);
      try{
        var snap = {
          key: key,
          id: row.id,
          name: row.name,
          username: row.username || key,
          email: row.email,
          role: row.role || "Sales",
          owned_reps: row.owned_reps
        };
        sessionStorage.setItem("sos_user", key);
        sessionStorage.setItem("sos_user_data", JSON.stringify(snap));
      }catch(_e){}
    }
    return window.USERS && window.USERS[key] ? window.USERS[key] : null;
  }

  function restoreSessionUserFromStorage(){
    try{
      var raw = sessionStorage.getItem("sos_user_data");
      if(!raw) return null;
      var snap = JSON.parse(raw);
      if(!snap || !snap.key) return null;
      registerFromRow({
        id: snap.id,
        username: snap.username || snap.key,
        name: snap.name || snap.key,
        email: snap.email || "",
        role: snap.role || "Sales",
        owned_reps: snap.owned_reps
      });
      window.currentUser = canonKey(snap.key);
      return window.USERS && window.USERS[window.currentUser] ? window.USERS[window.currentUser] : null;
    }catch(_e2){
      return null;
    }
  }

  async function performSalesLogin(email, password){
    if(!window.APP_API || typeof window.APP_API.loginWithSalesUser !== "function"){
      return { ok: false, error: "Login service not initialized" };
    }
    var result = await window.APP_API.loginWithSalesUser(email, password);
    if(result.error || !result.data){
      var msg = result.error && result.error.message ? result.error.message : "Invalid email or password";
      return { ok: false, error: msg };
    }
    var row = result.data;
    var key = resolveLoginKey(row, email);
    if(!key){
      return { ok: false, error: "User account is missing a username" };
    }
    if(!row.username){
      row = Object.assign({}, row, { username: key });
    }
    var user = persistSessionUser(key, row);
    if(!user){
      registerFromRow(row);
      user = window.USERS && window.USERS[key] ? window.USERS[key] : null;
    }
    if(!user){
      return { ok: false, error: "Could not load user profile" };
    }
    return { ok: true, key: key, user: user, row: row };
  }

  window.USER_REGISTRY = {
    applyUserTier: applyUserTier,
    registerFromRow: registerFromRow,
    fetchOne: fetchOne,
    bootstrapAll: bootstrapAll,
    ensureCurrentUser: ensureCurrentUser,
    resolveLoginKey: resolveLoginKey,
    persistSessionUser: persistSessionUser,
    restoreSessionUserFromStorage: restoreSessionUserFromStorage,
    performSalesLogin: performSalesLogin
  };
  window.performSalesLogin = performSalesLogin;
  window.restoreSessionUserFromStorage = restoreSessionUserFromStorage;
})();

/* ── Team Members: add / delete sales_users (bigint id) ── */
(function(){
  var TEAM_TABLE = "sales_users";
  var isLoadingTeamMembers = false;

  function teamMemberCurrentRole(){
    var uid = window.currentUser;
    var u = (window.USERS || {})[uid];
    return u && u.role ? u.role : "";
  }

  function canManageTeamMembers(){
    return ["CEO", "Co-CEO", "COO"].includes(teamMemberCurrentRole());
  }

  function toNumericRepId(userId, localUid){
    var numericId = Number(userId);
    if(isFinite(numericId) && numericId > 0) return Math.floor(numericId);
    if(typeof window.getRepSalesUserId === "function" && localUid){
      numericId = Number(window.getRepSalesUserId(localUid));
      if(isFinite(numericId) && numericId > 0) return Math.floor(numericId);
    }
    if(window.APP_API && typeof window.APP_API.toBigintId === "function"){
      return window.APP_API.toBigintId(userId);
    }
    return null;
  }

  function clearTeamMemberCaches(){
    try{
      localStorage.removeItem("teamMembers");
      localStorage.removeItem("salesUsers");
      localStorage.removeItem("members");
      localStorage.removeItem("tm_extra_reps");
    }catch(_e){}
    try{
      sessionStorage.removeItem("teamMembers");
      sessionStorage.removeItem("salesUsers");
      sessionStorage.removeItem("members");
    }catch(_e2){}
    window._teamMembersLive = null;
    window._salesUserIdByKey = {};
    window._salesUserKeyById = {};
  }

  async function fetchTeamMembersFresh(){
    var client = window.APP_SUPABASE_CLIENT;
    if(client && typeof client.from === "function"){
      try{
        var result = await client
          .from(TEAM_TABLE)
          .select("*")
          .order("id", { ascending: true });
        return { data: result.data || [], error: result.error || null };
      }catch(err){
        return { data: null, error: { message: err && err.message ? err.message : "Fetch failed" } };
      }
    }
    if(window.APP_API && typeof window.APP_API.fetchTeamMembers === "function"){
      return window.APP_API.fetchTeamMembers();
    }
    return { data: [], error: { message: "Supabase client not ready" } };
  }

  /** One-time cleanup: remove ghost rows from sales_users (by name / username). */
  async function deleteGhostUsers(){
    var namesToDelete = ["Fasith", "Shehan"];
    var client = window.APP_SUPABASE_CLIENT;
    if(!client || typeof client.from !== "function"){
      console.warn("deleteGhostUsers: Supabase client not ready");
      return;
    }
    for(var i = 0; i < namesToDelete.length; i++){
      var name = namesToDelete[i];
      var result = await client.from(TEAM_TABLE).delete().eq("name", name);
      if(result && result.error){
        var byUser = await client.from(TEAM_TABLE).delete().eq("username", name);
        if(byUser && byUser.error) console.error("Failed to delete", name, byUser.error);
        else console.log("Deleted (username):", name);
      } else {
        console.log("Deleted:", name);
      }
      if(window.USERS && window.USERS[name]){
        delete window.USERS[name];
      }
      if(typeof window.ls === "function"){
        try{
          var extra = window.ls("tm_extra_reps") || {};
          delete extra[name];
          window.ls("tm_extra_reps", extra);
        }catch(_e){}
      }
      try{ localStorage.removeItem("tm_rep_" + name); }catch(_e2){}
      try{
        if(typeof window.getData === "function" && typeof window.ls === "function"){
          var pins = window.getData("pins", {});
          delete pins[name];
          window.ls("pins", pins);
        }
      }catch(_e3){}
    }
  }

  /** Fetch only — never renders; never calls index loadTeamMembers. */
  async function loadTeamMembersFromCloud(){
    if(isLoadingTeamMembers || window._isLoadingTeamMembers){
      return { data: window._teamMembersLive || [], error: null };
    }
    isLoadingTeamMembers = true;
    window._isLoadingTeamMembers = true;
    try{
      clearTeamMemberCaches();
      var res = await fetchTeamMembersFresh();
      if(!res.error){
        window._teamMembersLive = Array.isArray(res.data) ? res.data : [];
      }
      return res;
    } finally{
      isLoadingTeamMembers = false;
      window._isLoadingTeamMembers = false;
    }
  }

  /** Render only — uses provided rows or window._teamMembersLive; never fetches. */
  function renderTeamMembers(rows){
    var data = Array.isArray(rows) ? rows : (window._teamMembersLive || []);
    window._teamMembersLive = data;
    if(typeof window.mergeTeamMembersIntoUsers === "function"){
      window.mergeTeamMembersIntoUsers(data);
    }
    if(typeof window.tmRenderStats === "function") window.tmRenderStats();
    if(typeof window.tmRenderTable === "function") window.tmRenderTable();
    if(typeof window.cooRenderTable === "function") window.cooRenderTable();
  }

  /** Full refresh: fetch from Supabase, then render. */
  async function refreshTeamMembers(){
    var res = await loadTeamMembersFromCloud();
    if(res.error){
      console.warn("sales_users load:", res.error.message || res.error);
      return res;
    }
    renderTeamMembers(res.data || []);
    return { data: res.data || [], error: null };
  }

  async function removeRep(userId, localUid, displayName, skipConfirm){
    console.log("Current user role:", teamMemberCurrentRole());
    console.log("Rep id type:", typeof userId, userId);

    var name = displayName || localUid || "this rep";
    if(!skipConfirm){
      if(!window.confirm("Remove " + name + " from the team?")){
        return { error: { message: "Cancelled" } };
      }
    }

    var numericId = toNumericRepId(userId, localUid);

    var client = window.APP_SUPABASE_CLIENT;
    if(numericId != null && client && typeof client.from === "function"){
      try{
        var result = await client.from(TEAM_TABLE).delete().eq("id", Number(numericId));
        if(result && result.error){
          console.error("Delete error:", result.error);
          if(typeof window.showToast === "function"){
            window.showToast("Error: " + (result.error.message || "Delete failed"), "error");
          }
          return { error: result.error };
        }
        if(localUid && typeof window.tmRemoveRepLocal === "function"){
          window.tmRemoveRepLocal(localUid);
        }
        if(typeof window.showToast === "function"){
          window.showToast(name + " removed successfully ✓", "success");
        }
        if(typeof window.tmCloseModal === "function") window.tmCloseModal("tm-edit-modal");
        if(typeof window.tmRenderStats === "function") window.tmRenderStats();
        if(typeof window.tmRenderTable === "function") window.tmRenderTable();
        if(typeof window.cooRenderTable === "function") window.cooRenderTable();
        await refreshTeamMembers();
        return { error: null };
      }catch(e){
        console.error("Remove error:", e);
        if(typeof window.showToast === "function"){
          window.showToast("Error: " + (e.message || "Delete failed"), "error");
        }
        return { error: e };
      }
    }

    if(numericId != null && window.APP_API && typeof window.APP_API.removeRep === "function"){
      var apiRes = await window.APP_API.removeRep(numericId, true);
      if(apiRes && apiRes.error){
        console.error("Delete error:", apiRes.error);
        if(typeof window.showToast === "function"){
          window.showToast("Error: " + (apiRes.error.message || "Delete failed"), "error");
        }
        return apiRes;
      }
      if(localUid && typeof window.tmRemoveRepLocal === "function"){
        window.tmRemoveRepLocal(localUid);
      }
      if(typeof window.showToast === "function"){
        window.showToast("Rep removed successfully ✓", "success");
      }
      await refreshTeamMembers();
      return { error: null };
    }

    if(localUid && window.APP_API && typeof window.APP_API.deleteSalesUserByUsername === "function"){
      var byUser = await window.APP_API.deleteSalesUserByUsername(localUid);
      if(!byUser.error){
        if(typeof window.tmRemoveRepLocal === "function") window.tmRemoveRepLocal(localUid);
        if(typeof window.showToast === "function"){
          window.showToast(name + " removed successfully ✓", "success");
        }
        await refreshTeamMembers();
        if(typeof window.tmRenderTable === "function") window.tmRenderTable();
        return { error: null };
      }
    }

    console.error("Remove error: invalid bigint id", userId, localUid);
    if(typeof window.showToast === "function"){
      window.showToast("Error: missing numeric rep id — reload team list and try again", "error");
    }
    return { error: { message: "Invalid rep id" } };
  }

  async function addNewRep(formData){
    console.log("Current user role:", teamMemberCurrentRole());

    if(!canManageTeamMembers()){
      if(typeof window.showToast === "function"){
        window.showToast("Management access required", "error");
      }
      return { data: null, error: { message: "Not allowed" } };
    }

    var name = (formData.name || "").trim();
    var username = (formData.username || "").trim();
    var email = (formData.email || "").trim();
    var password = formData.password || "";
    var role = formData.role || "Sales";
    if(!username && name){
      username = name.toLowerCase().replace(/\s/g, "");
    }
    if(!name || !email || !username){
      return { data: null, error: { message: "Name, username, and email are required" } };
    }

    var row = {
      name: name,
      username: username,
      email: email,
      password: password,
      role: role,
      created_at: new Date().toISOString()
    };

    var client = window.APP_SUPABASE_CLIENT;
    if(client && typeof client.from === "function"){
      try{
        var ins = await client.from(TEAM_TABLE).insert([row]).select();
        if(ins && ins.error){
          console.error("Insert error:", ins.error);
          if(typeof window.showToast === "function"){
            window.showToast("Error adding rep: " + (ins.error.message || "Insert failed"), "error");
          }
          return { data: null, error: ins.error };
        }
        var inserted = ins && ins.data ? (Array.isArray(ins.data) ? ins.data[0] : ins.data) : null;
        if(typeof window.showToast === "function"){
          window.showToast("New rep added ✓", "success");
        }
        await refreshTeamMembers();
        return { data: inserted, error: null };
      }catch(e){
        console.error("Insert error:", e);
        if(typeof window.showToast === "function"){
          window.showToast("Error adding rep: " + (e.message || "Insert failed"), "error");
        }
        return { data: null, error: e };
      }
    }

    if(window.APP_API && typeof window.APP_API.insertSalesUser === "function"){
      var apiIns = await window.APP_API.insertSalesUser(formData);
      if(apiIns.error){
        console.error("Insert error:", apiIns.error);
        if(typeof window.showToast === "function"){
          window.showToast("Error adding rep: " + (apiIns.error.message || "Insert failed"), "error");
        }
        return apiIns;
      }
      if(typeof window.showToast === "function"){
        window.showToast("New rep added ✓", "success");
      }
      await refreshTeamMembers();
      return apiIns;
    }

    return { data: null, error: { message: "Supabase not ready" } };
  }

  function prepareMember(uid, r){
    var id = null;
    if(typeof window.getRepNumericId === "function"){
      id = window.getRepNumericId(uid);
    } else if(typeof window.getRepSalesUserId === "function"){
      id = window.getRepSalesUserId(uid);
    }
    return {
      uid: uid,
      id: id,
      name: r && r.name ? r.name : uid,
      role: r && r.role ? r.role : "",
      email: r && r.email ? r.email : "",
      phone: r && r.phone ? r.phone : "",
      tier: r && r.tier ? r.tier : "",
      raw: r
    };
  }

  function prepareMembersFromEntries(entries){
    return (entries || []).map(function(pair){
      return prepareMember(pair[0], pair[1]);
    });
  }

  function debugLogTeamMembers(members){
    (members || []).forEach(function(rep){
      console.log("Rep:", rep.name, "| id:", rep.id, "| type:", typeof rep.id, "| role:", rep.role);
    });
  }

  /** Remove visibility: role check ONLY — never use rep.id for show/hide. */
  function showRemoveForRep(rep){
    var actorRole = teamMemberCurrentRole();
    if(actorRole === "CEO") return true;
    if(["Co-CEO", "COO"].includes(actorRole) && ["Sales", "Rep"].includes(rep.role)) return true;
    return false;
  }

  function buildRemoveBtnHtml(rep){
    if(!showRemoveForRep(rep)) return '<span class="tm-muted">—</span>';
    var idArg = rep.id != null && isFinite(Number(rep.id)) && Number(rep.id) > 0
      ? Number(rep.id)
      : 0;
    var uid = String(rep.uid || "").replace(/'/g, "\\'");
    var name = String(rep.name || "").replace(/'/g, "\\'");
    return '<button class="tm-delete-btn" onclick="tmDeleteRep(' + idArg + ", '" + uid + "', '" + name + "')\">" +
      '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M1 3h12M4 3v8a2 2 0 002 2h2a2 2 0 002-2V3M6 7v4M8 7v4"/></svg> Remove</button>';
  }

  window.TEAM_MEMBERS = {
    prepareMember: prepareMember,
    prepareMembersFromEntries: prepareMembersFromEntries,
    debugLogTeamMembers: debugLogTeamMembers,
    showRemoveForRep: showRemoveForRep,
    buildRemoveBtnHtml: buildRemoveBtnHtml,
    clearCaches: clearTeamMemberCaches,
    fetchFresh: fetchTeamMembersFresh
  };

  window.canManageTeamMembers = canManageTeamMembers;
  window.removeRep = removeRep;
  window.addNewRep = addNewRep;
  window.loadTeamMembersFromCloud = loadTeamMembersFromCloud;
  window.renderTeamMembers = renderTeamMembers;
  window.refreshTeamMembers = refreshTeamMembers;
  window.deleteGhostUsers = deleteGhostUsers;
  window.fetchTeamMembersFresh = fetchTeamMembersFresh;
})();

/* ── Mobile UI: sidebar drawer, overlay, bottom nav helpers ── */
(function(){
  var MOBILE_BREAK = 768;

  function isMobile(){
    return window.innerWidth <= MOBILE_BREAK;
  }

  function getSidebarEls(){
    return {
      sidebar: document.querySelector(".sidebar"),
      overlay: document.getElementById("sidebar-overlay"),
      hamburger: document.getElementById("hamburger-btn")
    };
  }

  function setSidebarOpen(open){
    var els = getSidebarEls();
    if(!els.sidebar) return;
    els.sidebar.classList.toggle("open", open);
    if(els.overlay) els.overlay.classList.toggle("open", open);
    if(els.hamburger) els.hamburger.classList.toggle("open", open);
    els.sidebar.style.willChange = open ? "transform" : "auto";
    document.body.classList.toggle("mobile-sidebar-open", open && isMobile());
    if(els.overlay){
      els.overlay.setAttribute("aria-hidden", open ? "false" : "true");
    }
  }

  function openSidebar(){
    if(!isMobile()) return;
    setSidebarOpen(true);
  }

  function closeSidebar(){
    setSidebarOpen(false);
  }

  function toggleSidebar(){
    if(!isMobile()) return;
    var els = getSidebarEls();
    if(!els.sidebar) return;
    setSidebarOpen(!els.sidebar.classList.contains("open"));
  }

  function bindSidebarNavClose(){
    var sidebar = document.querySelector(".sidebar");
    if(!sidebar) return;
    sidebar.querySelectorAll(".sidebar-nav .nav-item[onclick], .sidebar-bottom .nav-item[onclick]").forEach(function(el){
      el.addEventListener("click", function(){
        if(isMobile()) closeSidebar();
      });
    });
  }

  function bindOverlay(){
    var overlay = document.getElementById("sidebar-overlay");
    if(!overlay) return;
    overlay.addEventListener("click", function(e){
      if(e.target === overlay) closeSidebar();
    });
  }

  function syncBottomNavActive(pageId){
    document.querySelectorAll(".bn-item").forEach(function(n){ n.classList.remove("active"); });
    var primary = ["dashboard", "prospects", "mycalls", "followups"];
    if(primary.indexOf(pageId) >= 0){
      var b = document.querySelector('.bn-item[data-page="' + pageId + '"]');
      if(b) b.classList.add("active");
    } else {
      var m = document.querySelector(".bn-item.bn-more");
      if(m) m.classList.add("active");
    }
  }

  function init(){
    bindOverlay();
    bindSidebarNavClose();
    document.addEventListener("keydown", function(e){
      if(e.key === "Escape" && isMobile()) closeSidebar();
    });
    window.addEventListener("resize", function(){
      if(!isMobile()) closeSidebar();
    });
  }

  window.MOBILE_UI = {
    init: init,
    isMobile: isMobile,
    openSidebar: openSidebar,
    closeSidebar: closeSidebar,
    toggleSidebar: toggleSidebar,
    syncBottomNavActive: syncBottomNavActive
  };
  window.toggleSidebar = toggleSidebar;
  window.closeSidebar = closeSidebar;
  window.openSidebar = openSidebar;

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
