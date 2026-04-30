(function(){
  const SUPABASE_URL = "https://your-project.supabase.co";
  const SUPABASE_ANON_KEY = "your-anon-key-here";

  window.APP_CONFIG = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  };

  // Create and export Supabase auth client when config is available.
  window.APP_SUPABASE_CLIENT =
    (window.supabase && typeof window.supabase.createClient === 'function' && SUPABASE_URL && SUPABASE_ANON_KEY)
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;
})();
