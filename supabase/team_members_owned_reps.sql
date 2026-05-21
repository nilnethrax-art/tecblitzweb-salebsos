-- Run in Supabase SQL Editor
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS owned_reps uuid[] DEFAULT '{}';

-- Optional: mirror on sales_users if that is your profile table instead
-- ALTER TABLE sales_users ADD COLUMN IF NOT EXISTS owned_reps uuid[] DEFAULT '{}';
