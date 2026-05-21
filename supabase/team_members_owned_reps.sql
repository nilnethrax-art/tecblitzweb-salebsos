-- Run in Supabase SQL Editor (table name: sales_users — used at login)
ALTER TABLE sales_users ADD COLUMN IF NOT EXISTS owned_reps uuid[] DEFAULT '{}';
