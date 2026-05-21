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

  function getAssignedKey(record, assignField){
    if(assignField === 'assignedTo'){
      return canon(record.assignedTo || record.assigned_rep_id || record.assignee || '');
    }
    return canon(record.rep || record.assignedTo || '');
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
    return key === canon(currentUid);
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
})();
