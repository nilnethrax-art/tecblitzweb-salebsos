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
