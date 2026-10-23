-- FORCE DELETE a broken auth user (when Dashboard says "Database error loading user")
-- Run in Supabase → SQL Editor. Replace the email below, then Run.

DO $$
DECLARE
    target_email text := 'YOUR_EMAIL_HERE@gmail.com';  -- ← CHANGE THIS
    uid uuid;
BEGIN
    SELECT id INTO uid
    FROM auth.users
    WHERE lower(email) = lower(trim(target_email));

    IF uid IS NULL THEN
        RAISE EXCEPTION 'No user found with email: %', target_email;
    END IF;

    -- Remove related auth rows (ignore missing tables on older projects)
    BEGIN DELETE FROM auth.refresh_tokens WHERE user_id = uid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM auth.sessions WHERE user_id = uid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM auth.mfa_challenges WHERE factor_id IN (SELECT id FROM auth.mfa_factors WHERE user_id = uid); EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM auth.mfa_factors WHERE user_id = uid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM auth.one_time_tokens WHERE user_id = uid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM auth.flow_state WHERE user_id = uid; EXCEPTION WHEN undefined_table THEN NULL; END;

    DELETE FROM auth.identities WHERE user_id = uid;
    DELETE FROM public.profiles WHERE id = uid;
    DELETE FROM auth.users WHERE id = uid;

    RAISE NOTICE 'Successfully deleted user % (%)', target_email, uid;
END $$;

-- After this: go to signin.html and create a NEW account (Sign Up).
