(function(){
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
  console.log("CONFIG:", window.APP_CONFIG);
  const client = window.APP_API.createClient();

  function showStartupConfigError(msg){
    console.error(msg);
    const target = document.getElementById('login-error');
    if(target){
      target.style.color = 'var(--red)';
      target.textContent = msg;
    }
  }

  let authClient = window.APP_SUPABASE_CLIENT || null;
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
    showStartupConfigError("Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY before loading app.");
  } else if(authClient){
    console.log("Supabase initialized");
  } else {
    showStartupConfigError("Supabase SDK unavailable. Check script loading order.");
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

  // Compatibility exports for existing app code.
  window.SB_URL = SUPABASE_URL || "";
  window.SB_KEY = SUPABASE_ANON_KEY || "";
  window.BASE_HDR = window.APP_API.baseHeaders();
  window.sbAuth = authClient;
  window.supabase = {
    createClient: function(){ return client; },
    from: function(table){ return client.from(table); },
    auth: authClient ? authClient.auth : null
  };
})();
