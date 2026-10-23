-- List all users (find your email / id if unsure)
-- select id, email, created_at from auth.users;

-- Or delete by user id if you know it:
-- DO $$ DECLARE uid uuid := 'PASTE-USER-UUID-HERE'; BEGIN
--   DELETE FROM auth.identities WHERE user_id = uid;
--   DELETE FROM public.profiles WHERE id = uid;
--   DELETE FROM auth.users WHERE id = uid;
-- END $$;
