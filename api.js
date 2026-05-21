(function(){
  function getConfig(){
    const cfg = window.APP_CONFIG || {};
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = cfg;
    if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
      console.warn("Missing APP_CONFIG Supabase values in config.js");
    }
    return {
      SUPABASE_URL: SUPABASE_URL || "",
      SUPABASE_ANON_KEY: SUPABASE_ANON_KEY || "",
      SUPABASE_SERVICE_ROLE_KEY: cfg.SUPABASE_SERVICE_ROLE_KEY || ""
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

  function getServiceHeaders(){
    var cfg = getConfig();
    var key = cfg.SUPABASE_SERVICE_ROLE_KEY || "";
    return {
      "Content-Type": "application/json",
      "apikey": key,
      "Authorization": "Bearer " + key
    };
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

  /**
   * CEO-only: create Supabase Auth user + team_members row.
   * Requires SUPABASE_SERVICE_ROLE_KEY in config.js (never commit the real key).
   */
  async function createRepInSupabase(repData){
    var cfg = getConfig();
    if(!cfg.SUPABASE_SERVICE_ROLE_KEY){
      return { data: null, error: { message: "SUPABASE_SERVICE_ROLE_KEY not set in config.js — cannot create auth users from the browser." } };
    }
    if(!cfg.SUPABASE_URL){
      return { data: null, error: { message: "Missing SUPABASE_URL" } };
    }
    var email = (repData.email || '').trim();
    var password = repData.password || '';
    var name = (repData.name || '').trim();
    var username = (repData.username || repData.uid || '').trim();
    var role = repData.role || 'Sales Rep';
    if(!email || !password){
      return { data: null, error: { message: "Email and password are required" } };
    }
    if(!username){
      return { data: null, error: { message: "Username is required" } };
    }

    var authRes = await safeFetch(cfg.SUPABASE_URL + "/auth/v1/admin/users", {
      method: "POST",
      headers: getServiceHeaders(),
      body: JSON.stringify({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: { full_name: name, username: username, role: role }
      })
    });
    if(authRes.error){
      var msg = authRes.error.msg || authRes.error.message || authRes.error.error_description || "Auth user creation failed";
      return { data: null, error: { message: msg, details: authRes.error } };
    }
    var authUser = authRes.data;
    var authId = authUser && (authUser.id || authUser.user?.id);
    if(!authId){
      return { data: null, error: { message: "Auth user created but no user id returned" } };
    }

    var row = {
      id: authId,
      name: name || username,
      username: username,
      email: email,
      role: role,
      owned_reps: repData.owned_reps || [],
      created_by: repData.created_by || null
    };

    var tmRes = await safeFetch(cfg.SUPABASE_URL + "/rest/v1/team_members", {
      method: "POST",
      headers: Object.assign({}, getServiceHeaders(), { "Prefer": "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(row)
    });
    if(tmRes.error){
      return { data: { authId: authId, authUser: authUser }, error: { message: "Auth user created but team_members insert failed: " + (tmRes.error.message || tmRes.error.msg || "unknown"), details: tmRes.error } };
    }

    return { data: { authId: authId, authUser: authUser, teamMember: Array.isArray(tmRes.data) ? tmRes.data[0] : tmRes.data }, error: null };
  }

  async function fetchTeamMembers(){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: [], error: { message: "Missing SUPABASE_URL" } };
    return safeFetch(cfg.SUPABASE_URL + "/rest/v1/team_members?select=*", { headers: getBaseHeaders() });
  }

  async function upsertTeamMemberOwnedReps(memberKey, ownedReps){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: null, error: { message: "Missing SUPABASE_URL" } };
    var reps = Array.isArray(ownedReps) ? ownedReps : [];
    var key = encodeURIComponent(memberKey || "");
    var byUsername = cfg.SUPABASE_URL + "/rest/v1/team_members?username=eq." + key;
    var res = await safeFetch(byUsername, {
      method: "PATCH",
      headers: Object.assign({}, getBaseHeaders(), { "Prefer": "return=minimal" }),
      body: JSON.stringify({ owned_reps: reps })
    });
    if(!res.error) return res;
    return safeFetch(cfg.SUPABASE_URL + "/rest/v1/team_members?id=eq." + key, {
      method: "PATCH",
      headers: Object.assign({}, getBaseHeaders(), { "Prefer": "return=minimal" }),
      body: JSON.stringify({ owned_reps: reps })
    });
  }

  async function upsertTeamMemberRow(row){
    var cfg = getConfig();
    if(!cfg.SUPABASE_URL) return { data: null, error: { message: "Missing SUPABASE_URL" } };
    return safeFetch(cfg.SUPABASE_URL + "/rest/v1/team_members", {
      method: "POST",
      headers: Object.assign({}, getBaseHeaders(), { "Prefer": "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(row)
    });
  }

  window.APP_API = {
    createClient: createClient,
    safeFetch: safeFetch,
    baseHeaders: getBaseHeaders,
    getServiceHeaders: getServiceHeaders,
    loginWithEmailPassword: loginWithEmailPassword,
    insertLoginLogSafe: insertLoginLogSafe,
    createRepInSupabase: createRepInSupabase,
    fetchTeamMembers: fetchTeamMembers,
    upsertTeamMemberOwnedReps: upsertTeamMemberOwnedReps,
    upsertTeamMemberRow: upsertTeamMemberRow
  };
})();
