(function(){
  /** Team/user rows — same table used at login (see index.html sales_users fetch). */
  var TEAM_TABLE = "sales_users";

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

  async function loginWithEmailPassword(email, password){
    try{
      const authClient = window.APP_SUPABASE_CLIENT;
      if(!authClient || !authClient.auth || typeof authClient.auth.signInWithPassword !== 'function'){
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

  async function insertLoginLogSafe(_row){
    try{
      return;
    }catch(_e){}
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
          select: function(cols){
            return safeFetch(base + "?select=" + encodeURIComponent(cols || "*"), { headers: baseHeaders });
          },
          upsert: function(rows){
            var body = Array.isArray(rows) ? rows : [rows];
            return safeFetch(base, { method: "POST", headers: upsertHeaders, body: JSON.stringify(body) });
          },
          insert: function(rows){
            return this.upsert(rows);
          },
          delete: function(id){
            return safeFetch(base + "?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: deleteHeaders });
          }
        };
      }
    };
  }

  function newRowId(){
    if(typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "su_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
  }

  function generatePassword8(){
    var chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    var out = "";
    for(var i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }

  /** Insert a new sales user (no Auth admin — client-safe). */
  async function insertSalesUser(repData){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: null, error: { message: "Missing SUPABASE_URL" } };

    var username = (repData.username || repData.name || "").trim();
    var email = (repData.email || "").trim();
    var role = repData.role || "Sales";
    if(!username) return { data: null, error: { message: "Username is required" } };
    if(!email) return { data: null, error: { message: "Email is required" } };

    var row = {
      id: repData.id || newRowId(),
      name: username,
      email: email,
      role: role
    };
    if(repData.owned_reps) row.owned_reps = repData.owned_reps;

    var res = await safeFetch(teamUrl(), {
      method: "POST",
      headers: Object.assign({}, getBaseHeaders(), { "Prefer": "return=representation" }),
      body: JSON.stringify(row)
    });
    if(res.error){
      var msg = res.error.message || res.error.msg || res.error.hint || "Insert failed";
      return { data: null, error: { message: msg, details: res.error } };
    }
    return {
      data: {
        id: row.id,
        row: Array.isArray(res.data) ? res.data[0] : res.data
      },
      error: null
    };
  }

  async function fetchTeamMembers(){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: [], error: { message: "Missing SUPABASE_URL" } };
    return safeFetch(teamUrl("?select=*"), { headers: getBaseHeaders() });
  }

  async function deleteSalesUser(memberId){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: null, error: { message: "Missing SUPABASE_URL" } };
    if(!memberId) return { data: null, error: { message: "Missing user id" } };
    return safeFetch(teamUrl("?id=eq." + encodeURIComponent(memberId)), {
      method: "DELETE",
      headers: Object.assign({}, getBaseHeaders(), { "Prefer": "return=minimal" })
    });
  }

  /** Fallback when only login name is known (no uuid stored). */
  async function deleteSalesUserByName(loginName){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL || !loginName) return { data: null, error: { message: "Missing name" } };
    return safeFetch(teamUrl("?name=eq." + encodeURIComponent(loginName)), {
      method: "DELETE",
      headers: Object.assign({}, getBaseHeaders(), { "Prefer": "return=minimal" })
    });
  }

  async function upsertTeamMemberOwnedReps(memberKey, ownedReps){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: null, error: { message: "Missing SUPABASE_URL" } };
    var reps = Array.isArray(ownedReps) ? ownedReps : [];
    var key = encodeURIComponent(memberKey || "");
    var body = JSON.stringify({ owned_reps: reps });
    var headers = Object.assign({}, getBaseHeaders(), { "Prefer": "return=minimal" });
    var byName = await safeFetch(teamUrl("?name=eq." + key), { method: "PATCH", headers: headers, body: body });
    if(!byName.error) return byName;
    return safeFetch(teamUrl("?id=eq." + key), { method: "PATCH", headers: headers, body: body });
  }

  async function upsertTeamMemberRow(row){
    return insertSalesUser(row);
  }

  window.APP_API = {
    TEAM_TABLE: TEAM_TABLE,
    createClient: createClient,
    safeFetch: safeFetch,
    baseHeaders: getBaseHeaders,
    loginWithEmailPassword: loginWithEmailPassword,
    insertLoginLogSafe: insertLoginLogSafe,
    insertSalesUser: insertSalesUser,
    fetchTeamMembers: fetchTeamMembers,
    deleteSalesUser: deleteSalesUser,
    deleteSalesUserByName: deleteSalesUserByName,
    upsertTeamMemberOwnedReps: upsertTeamMemberOwnedReps,
    upsertTeamMemberRow: upsertTeamMemberRow,
    generatePassword8: generatePassword8,
    newRowId: newRowId
  };
})();
