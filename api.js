(function(){
  /** Team/user rows — same table used at login (see index.html sales_users fetch). */
  var TEAM_TABLE = "sales_users";

  var TABLE_ASSIGNED_COL = {
    prospects: "assignedto",
    calls: "rep",
    interested_leads: "rep"
  };

  function getConfig(){
    const cfg = window.APP_CONFIG || {};
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = cfg;
    if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
      console.warn("Missing APP_CONFIG Supabase values in config.js");
    }
    return {
      SUPABASE_URL: SUPABASE_URL || "",
      SUPABASE_ANON_KEY: SUPABASE_ANON_KEY || "",
      TEAM_TABLE: TEAM_TABLE
    };
  }

  function getBaseHeaders(){
    var cfg = getConfig();
    return {
      "Content-Type": "application/json",
      "apikey": cfg.SUPABASE_ANON_KEY || "",
      "Authorization": "Bearer " + (cfg.SUPABASE_ANON_KEY || "")
    };
  }

  function teamUrl(query){
    var cfg = getConfig();
    return (cfg.SUPABASE_URL || "") + "/rest/v1/" + TEAM_TABLE + (query || "");
  }

  function tableUrl(table, query){
    var cfg = getConfig();
    return (cfg.SUPABASE_URL || "") + "/rest/v1/" + table + (query || "");
  }

  async function safeFetch(url, options){
    try{
      var res = await fetch(url, options || {});
      var text = await res.text();
      var payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch(e){ payload = text; }
      if(!res.ok){
        return { data: null, error: payload || { message: "Request failed", status: res.status } };
      }
      return { data: payload, error: null };
    } catch(err){
      return { data: null, error: { message: err && err.message ? err.message : "Network error" } };
    }
  }

  function canonRep(rep){
    if(typeof window.canonicalRepKey === "function") return window.canonicalRepKey(rep);
    return rep == null ? "" : String(rep).trim();
  }

  /** Coerce to bigint serial id (sales_users.id). */
  function toBigintId(val){
    if(val == null || val === "") return null;
    if(typeof val === "number" && isFinite(val) && val > 0) return Math.floor(val);
    var s = String(val).trim();
    if(/^\d+$/.test(s)){
      var n = parseInt(s, 10);
      return isFinite(n) && n > 0 ? n : null;
    }
    return null;
  }

  /** owned_reps column: bigint[] of sales_users.id values. */
  function normalizeOwnedRepsBigint(raw){
    if(raw == null) return [];
    var list = raw;
    if(typeof raw === "string"){
      try{
        var j = JSON.parse(raw);
        list = Array.isArray(j) ? j : raw.split(",");
      }catch(_e){
        list = raw.split(",");
      }
    }
    if(!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    list.forEach(function(x){
      var id = toBigintId(x);
      if(id != null && !seen[id]){
        seen[id] = true;
        out.push(id);
      }
    });
    return out;
  }

  function lookupIdMapCaseInsensitive(map, key){
    if(!map || key == null || key === "") return null;
    if(map[key] != null) return map[key];
    var low = String(key).toLowerCase();
    var found = null;
    Object.keys(map).forEach(function(k){
      if(found != null) return;
      if(String(k).toLowerCase() === low) found = map[k];
    });
    return found;
  }

  function getSalesUserIdForKey(key, USERS){
    var id = toBigintId(key);
    if(id != null) return id;
    var k = canonRep(key);
    if(!k) return null;
    var mapped = lookupIdMapCaseInsensitive(window._salesUserIdByKey, k);
    if(mapped != null){
      return toBigintId(mapped);
    }
    if(typeof window.getRepSalesUserId === "function"){
      return toBigintId(window.getRepSalesUserId(k));
    }
    if(typeof window.ls === "function"){
      var tm = window.ls("tm_rep_" + k) || {};
      return toBigintId(tm.supabaseId);
    }
    return null;
  }

  function getUser(uid, USERS){
    return (USERS || window.USERS || {})[uid];
  }

  function isDirectorCEO(uid, USERS){
    var u = getUser(uid, USERS);
    return !!(u && u.role === "CEO");
  }

  function isCoCEO(uid, USERS){
    return getUser(uid, USERS)?.role === "Co-CEO";
  }

  function isCOORole(uid, USERS){
    var u = getUser(uid, USERS);
    return !!(u && (u.role === "COO" || u.role === "Chief Operating Officer" || u.tier === "coo"));
  }

  function isScopedManager(uid, USERS){
    return isCoCEO(uid, USERS) || isCOORole(uid, USERS);
  }

  function getOwnedRepIds(uid, USERS){
    if(window.SALES_OS && typeof window.SALES_OS.getOwnedRepIds === "function"){
      return window.SALES_OS.getOwnedRepIds(uid, USERS);
    }
    var u = getUser(uid, USERS);
    if(!u) return [];
    var owned = normalizeOwnedRepsBigint(u.owned_reps);
    if(!owned.length && typeof window.ls === "function"){
      var tm = window.ls("tm_rep_" + uid) || {};
      owned = normalizeOwnedRepsBigint(tm.owned_reps);
    }
    return owned;
  }

  /** Sales/Rep: match assignedto/rep by username (ilike) and optional numeric id. */
  function buildSalesRepAssigneeFilter(col, currentUid, USERS){
    var u = getUser(currentUid, USERS);
    var k = canonRep(currentUid);
    var tokens = [];
    if(k) tokens.push(String(k));
    if(u && u.name && String(u.name).trim()) tokens.push(String(u.name).trim());
    var seen = {};
    tokens = tokens.filter(function(t){
      var low = String(t).toLowerCase();
      if(!low || seen[low]) return false;
      seen[low] = true;
      return true;
    });
    if(!tokens.length) return "&" + col + "=eq.-1";

    var parts = tokens.map(function(t){
      return col + ".ilike." + encodeURIComponent(String(t));
    });
    var selfId = getSalesUserIdForKey(currentUid, USERS);
    if(selfId != null) parts.push(col + ".eq." + selfId);
    return parts.length === 1 ? "&" + parts[0] : "&or=(" + parts.join(",") + ")";
  }

  function buildRoleFilterQuery(table, currentUid, USERS){
    var col = TABLE_ASSIGNED_COL[table];
    if(!col || !currentUid) return "";
    var u = getUser(currentUid, USERS);
    if(!u) return "";
    if(isDirectorCEO(currentUid, USERS) || u.role === "CEO") return "";
    if(isCoCEO(currentUid, USERS) || isCOORole(currentUid, USERS)){
      // assignedto/rep columns store NAMES, but owned_reps are bigint IDs — a server-side
      // IN(ids) filter can never match. Fetch all rows and let canSeeAssignedRecord()
      // scope client-side (it resolves each record's name -> id against owned_reps).
      return "";
    }
    return buildSalesRepAssigneeFilter(col, currentUid, USERS);
  }

  async function fetchRoleFilteredTable(table, currentUid, USERS){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: [], error: { message: "Missing SUPABASE_URL" } };
    var filter = buildRoleFilterQuery(table, currentUid, USERS);
    return safeFetch(tableUrl(table, "?select=*" + filter), { headers: getBaseHeaders() });
  }

  async function loginWithEmailPassword(email, password){
    try{
      const authClient = window.APP_SUPABASE_CLIENT;
      if(!authClient || !authClient.auth || typeof authClient.auth.signInWithPassword !== "function"){
        return { data: null, error: { message: "Supabase auth not initialized" } };
      }
      const result = await authClient.auth.signInWithPassword({ email, password });
      if(result && result.error){
        return { data: null, error: result.error };
      }
      return { data: result ? result.data : null, error: null };
    } catch(err){
      return { data: null, error: { message: err && err.message ? err.message : "Auth login failed" } };
    }
  }

  /** Authenticate against sales_users.email + sales_users.password (not Supabase Auth). */
  async function loginWithSalesUser(email, password){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: null, error: { message: "Missing SUPABASE_URL" } };
    var em = (email || "").trim();
    var pw = password != null ? String(password) : "";
    if(!em || !pw) return { data: null, error: { message: "Please enter email and password" } };

    function pickRow(payload){
      var rows = Array.isArray(payload) ? payload : (payload ? [payload] : []);
      return rows.length ? rows[0] : null;
    }

    var select = "id,name,username,email,password,role,owned_reps";
    var res = await safeFetch(
      teamUrl("?select=" + select + "&email=eq." + encodeURIComponent(em) + "&limit=1"),
      { headers: getBaseHeaders() }
    );
    if(res.error) return { data: null, error: res.error };
    var row = pickRow(res.data);
    if(!row){
      var ilike = await safeFetch(
        teamUrl("?select=" + select + "&email=ilike." + encodeURIComponent(em) + "&limit=1"),
        { headers: getBaseHeaders() }
      );
      if(ilike.error) return { data: null, error: ilike.error };
      row = pickRow(ilike.data);
    }
    if(!row) return { data: null, error: { message: "Invalid email or password" } };

    var stored = row.password != null ? String(row.password) : "";
    if(stored !== pw){
      return { data: null, error: { message: "Invalid email or password" } };
    }

    var safe = Object.assign({}, row);
    delete safe.password;
    return { data: safe, error: null };
  }

  async function insertLoginLogSafe(_row){
    try{ return; }catch(_e){}
  }

  function createClient(){
    var cfg = getConfig();
    var baseHeaders = getBaseHeaders();
    var upsertHeaders = Object.assign({}, baseHeaders, { "Prefer": "resolution=merge-duplicates,return=minimal" });
    var deleteHeaders = Object.assign({}, baseHeaders, { "Prefer": "return=minimal" });

    return {
      from: function(table){
        var base = (cfg.SUPABASE_URL || "") + "/rest/v1/" + table;
        return {
          select: function(cols, opts){
            var q = "?select=" + encodeURIComponent(cols || "*");
            if(opts && opts.filter) q += opts.filter;
            return safeFetch(base + q, { headers: baseHeaders });
          },
          upsert: function(rows){
            var body = Array.isArray(rows) ? rows : [rows];
            return safeFetch(base, { method: "POST", headers: upsertHeaders, body: JSON.stringify(body) });
          },
          insert: function(rows){
            return this.upsert(rows);
          },
          delete: function(id){
            var numId = toBigintId(id);
            if(numId == null) return Promise.resolve({ data: null, error: { message: "Invalid id" } });
            return safeFetch(base + "?id=eq." + numId, { method: "DELETE", headers: deleteHeaders });
          }
        };
      }
    };
  }

  function generatePassword8(){
    var chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    var out = "";
    for(var i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }

  /** Insert sales_users row — id is auto-generated bigint; do not send id. */
  async function insertSalesUser(repData){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: null, error: { message: "Missing SUPABASE_URL" } };

    var username = (repData.username || "").trim();
    var name = (repData.name || repData.displayName || repData.fullName || username).trim();
    var email = (repData.email || "").trim();
    var role = repData.role || "Sales";
    var password = repData.password || "";
    if(!username) return { data: null, error: { message: "Username is required" } };
    if(!name) return { data: null, error: { message: "Name is required" } };
    if(!email) return { data: null, error: { message: "Email is required" } };

    var row = {
      name: name,
      username: username,
      email: email,
      role: role,
      password: password,
      created_at: repData.created_at || new Date().toISOString()
    };

    var res = await safeFetch(teamUrl(), {
      method: "POST",
      headers: Object.assign({}, getBaseHeaders(), { "Prefer": "return=representation" }),
      body: JSON.stringify(row)
    });
    if(res.error){
      var msg = res.error.message || res.error.msg || res.error.hint || "Insert failed";
      return { data: null, error: { message: msg, details: res.error } };
    }
    var inserted = Array.isArray(res.data) ? res.data[0] : res.data;
    var newId = inserted && inserted.id != null ? toBigintId(inserted.id) : null;
    return { data: { id: newId, row: inserted }, error: null };
  }

  async function addNewRep(formData){
    console.log("addNewRep (api) role:", formData && formData.role);
    return insertSalesUser(formData);
  }

  async function fetchTeamMembers(){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: [], error: { message: "Missing SUPABASE_URL" } };
    return safeFetch(teamUrl("?select=*&order=id.asc"), { headers: getBaseHeaders() });
  }

  async function removeRep(userId, skipConfirm){
    console.log("removeRep (api) id type:", typeof userId, userId);
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: null, error: { message: "Missing SUPABASE_URL" } };
    var id = toBigintId(userId);
    if(id == null){
      var numericId = Number(userId);
      if(isFinite(numericId) && numericId > 0) id = Math.floor(numericId);
    }
    if(id == null) return { data: null, error: { message: "Missing or invalid user id (bigint)" } };
    if(!skipConfirm && typeof window.confirm === "function"){
      if(!window.confirm("Are you sure you want to remove this rep?")){
        return { data: null, error: { message: "Cancelled" } };
      }
    }
    return safeFetch(teamUrl("?id=eq." + id), {
      method: "DELETE",
      headers: Object.assign({}, getBaseHeaders(), { "Prefer": "return=minimal" })
    });
  }

  async function deleteSalesUser(memberId){
    return removeRep(memberId, true);
  }

  async function deleteSalesUserByUsername(loginName){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL || !loginName) return { data: null, error: { message: "Missing username" } };
    return safeFetch(teamUrl("?username=eq." + encodeURIComponent(loginName)), {
      method: "DELETE",
      headers: Object.assign({}, getBaseHeaders(), { "Prefer": "return=minimal" })
    });
  }

  async function deleteSalesUserByName(loginName){
    var byUser = await deleteSalesUserByUsername(loginName);
    if(!byUser.error) return byUser;
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL || !loginName) return { data: null, error: { message: "Missing name" } };
    return safeFetch(teamUrl("?name=eq." + encodeURIComponent(loginName)), {
      method: "DELETE",
      headers: Object.assign({}, getBaseHeaders(), { "Prefer": "return=minimal" })
    });
  }

  async function upsertTeamMemberOwnedReps(memberId, ownedReps){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: null, error: { message: "Missing SUPABASE_URL" } };
    var id = toBigintId(memberId);
    if(id == null) return { data: null, error: { message: "Invalid member id (bigint)" } };
    var reps = normalizeOwnedRepsBigint(ownedReps);
    var body = JSON.stringify({ owned_reps: reps });
    var headers = Object.assign({}, getBaseHeaders(), { "Prefer": "return=minimal" });
    return safeFetch(teamUrl("?id=eq." + id), { method: "PATCH", headers: headers, body: body });
  }

  async function upsertTeamMemberRow(row){
    return insertSalesUser(row);
  }

  window.APP_API = {
    TEAM_TABLE: TEAM_TABLE,
    TABLE_ASSIGNED_COL: TABLE_ASSIGNED_COL,
    createClient: createClient,
    safeFetch: safeFetch,
    baseHeaders: getBaseHeaders,
    loginWithEmailPassword: loginWithEmailPassword,
    loginWithSalesUser: loginWithSalesUser,
    insertLoginLogSafe: insertLoginLogSafe,
    insertSalesUser: insertSalesUser,
    addNewRep: addNewRep,
    fetchTeamMembers: fetchTeamMembers,
    fetchRoleFilteredTable: fetchRoleFilteredTable,
    buildRoleFilterQuery: buildRoleFilterQuery,
    deleteSalesUser: deleteSalesUser,
    removeRep: removeRep,
    deleteSalesUserByUsername: deleteSalesUserByUsername,
    deleteSalesUserByName: deleteSalesUserByName,
    upsertTeamMemberOwnedReps: upsertTeamMemberOwnedReps,
    upsertTeamMemberRow: upsertTeamMemberRow,
    generatePassword8: generatePassword8,
    toBigintId: toBigintId,
    normalizeOwnedRepsBigint: normalizeOwnedRepsBigint,
    getSalesUserIdForKey: getSalesUserIdForKey,
    getOwnedRepIds: getOwnedRepIds
  };
})();

