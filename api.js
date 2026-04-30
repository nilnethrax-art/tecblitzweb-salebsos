(function(){
  function getConfig(){
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
    if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
      console.warn("Missing APP_CONFIG Supabase values in config.js");
    }
    return { SUPABASE_URL: SUPABASE_URL || "", SUPABASE_ANON_KEY: SUPABASE_ANON_KEY || "" };
  }

  function getBaseHeaders(){
    var cfg = getConfig();
    return {
      "Content-Type": "application/json",
      "apikey": cfg.SUPABASE_ANON_KEY || "",
      "Authorization": "Bearer " + (cfg.SUPABASE_ANON_KEY || "")
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

  async function insertLoginLogSafe(row){
    try{
      if(window._loginLogsTableMissing) return;
      var cfg = getConfig();
      if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
      var url = cfg.SUPABASE_URL + "/rest/v1/login_logs";
      var hdr = getBaseHeaders();
      var body = JSON.stringify(Array.isArray(row) ? row : [row]);
      var res = await fetch(url, { method: "POST", headers: hdr, body: body });
      if(res.status === 404 || res.status === 406){
        window._loginLogsTableMissing = true;
        return;
      }
      if(!res.ok){
        var txt = "";
        try{ txt = await res.text(); }catch(_t){}
        if(res.status === 400 || /relation|does not exist|not find/i.test(txt || "")){
          window._loginLogsTableMissing = true;
        }
      }
    }catch(_e){
      /* silent — login_logs is optional */
    }
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

  // Supabase RLS must be enabled for full security.
  window.APP_API = {
    createClient: createClient,
    safeFetch: safeFetch,
    baseHeaders: getBaseHeaders,
    loginWithEmailPassword: loginWithEmailPassword,
    insertLoginLogSafe: insertLoginLogSafe
  };
})();
