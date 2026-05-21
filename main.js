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
    if(raw == null) return [];
    if(Array.isArray(raw)) return raw.map(function(x){ return String(x).trim(); }).filter(Boolean);
    if(typeof raw === 'string'){
      try{
        var j = JSON.parse(raw);
        if(Array.isArray(j)) return j.map(function(x){ return String(x).trim(); }).filter(Boolean);
      }catch(_e){}
      return raw.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    }
    return [];
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

  function getOwnedRepUIDs(uid, USERS){
    var u = getUser(uid, USERS);
    if(!u) return [];
    var owned = normalizeOwnedReps(u.owned_reps);
    if(!owned.length && typeof window.ls === 'function'){
      var tm = window.ls('tm_rep_' + uid) || {};
      owned = normalizeOwnedReps(tm.owned_reps);
    }
    if(!owned.length && (isCOOTier(uid, USERS) || isCoCEO(uid, USERS)) && typeof window.getCOORepUIDs === 'function'){
      owned = window.getCOORepUIDs(uid) || [];
    }
    var seen = {};
    return owned.map(canon).filter(function(k){
      if(!k || seen[k]) return false;
      seen[k] = true;
      return true;
    });
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
    if(!key && assignField === 'assignedTo') return false;
    if(isScopedManager(currentUid, USERS)){
      return getOwnedRepUIDs(currentUid, USERS).indexOf(key) !== -1;
    }
    return key === canon(currentUid);
  }

  function filterRecords(records, currentUid, USERS, assignField){
    return (records || []).filter(function(r){
      return canSeeAssignedRecord(r, currentUid, USERS, assignField);
    });
  }

  window.SALES_OS = {
    normalizeOwnedReps: normalizeOwnedReps,
    isDirectorCEO: isDirectorCEO,
    isCoCEO: isCoCEO,
    isCOOTier: isCOOTier,
    isScopedManager: isScopedManager,
    getOwnedRepUIDs: getOwnedRepUIDs,
    getVisibleRepUIDs: getVisibleRepUIDs,
    getSalesRepUids: getSalesRepUids,
    canSeeAssignedRecord: canSeeAssignedRecord,
    filterRecords: filterRecords,
    getAssignedKey: getAssignedKey
  };
})();
