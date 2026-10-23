let supabaseClient = null;
let pendingVerification = null;

const VERIFY_STORAGE_KEY = "vived_pending_verify";
const EMAIL_CHANGE_STORAGE_KEY = "vived_pending_email_change";
const PASSWORD_CHANGE_STORAGE_KEY = "vived_pending_password_change";
const FLASH_STORAGE_KEY = "vived_flash";
const OAUTH_INTENT_KEY = "vived_oauth_intent";
const EXISTING_OAUTH_ACCOUNT_MS = 30000;
const CODE_EXPIRY_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const ACCOUNT_VERIFY_DEADLINE_MS = 24 * 60 * 60 * 1000;

let pendingEmailChange = null;
let pendingPasswordChange = null;

const VERIFICATION_PURPOSES = {
    signup: {
        purpose_title: "Verify your account",
        purpose_message: "Use this code to verify your Vived Games account. It expires in 10 minutes.",
        footer_message: "If you did not create an account, you can ignore this email.",
        buildDetails({ userEmail, username }) {
            return [`Email: ${userEmail}`, `Username: ${username}`];
        }
    },
    email_change: {
        purpose_title: "Confirm your new email",
        purpose_message: "You requested to change your Vived Games email to this address. Enter the code on your Account page. It expires in 10 minutes.",
        footer_message: "If you did not request this change, ignore this email and your account email will stay the same.",
        buildDetails({ userEmail, newEmail, username }) {
            return [`New email: ${newEmail}`, `Current email: ${userEmail}`, `Username: ${username}`];
        }
    },
    password_change: {
        purpose_title: "Change your password",
        purpose_message: "You requested to change your Vived Games password. Enter the code on your Account page. It expires in 10 minutes.",
        footer_message: "If you did not request a password change, ignore this email and your password will stay the same.",
        buildDetails({ userEmail, username }) {
            return [`Email: ${userEmail}`, `Username: ${username}`];
        }
    }
};

function getConfig() {
    return window.VIVED_CONFIG || null;
}

function getSupabaseProjectRef() {
    const url = getConfig()?.supabase?.url;
    if (!url) return null;
    try {
        return new URL(url).hostname.split(".")[0];
    } catch {
        return null;
    }
}

function purgeSupabaseAuthStorage() {
    const ref = getSupabaseProjectRef();
    if (!ref) return;

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`sb-${ref}-`) && key.includes("auth")) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
}

function isSessionExpired(session) {
    if (!session?.expires_at) return false;
    return session.expires_at * 1000 <= Date.now();
}

async function clearLocalSession() {
    purgeSupabaseAuthStorage();

    const sb = supabaseClient;
    if (sb) {
        try {
            await sb.auth.signOut({ scope: "local" });
        } catch {
            /* ignore */
        }
    }
}

async function getActiveSession(sb) {
    if (!sb) return null;

    try {
        const { data: { session }, error } = await sb.auth.getSession();
        if (error || !session?.user) return null;

        if (isSessionExpired(session)) {
            await clearLocalSession();
            return null;
        }

        return session;
    } catch {
        await clearLocalSession();
        return null;
    }
}

function sanitizeAuthStorageBeforeInit() {
    purgeExpiredAuthKeysOnly();
}

function purgeExpiredAuthKeysOnly() {
    const ref = getSupabaseProjectRef();
    if (!ref) return;

    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(`sb-${ref}-`) || !key.includes("auth")) continue;

        const raw = localStorage.getItem(key);
        if (!raw) continue;

        try {
            const parsed = JSON.parse(raw);
            const session = parsed?.currentSession || parsed?.session || parsed;
            const expiresAt = session?.expires_at ?? session?.expiresAt;
            if (typeof expiresAt === "number" && expiresAt * 1000 <= Date.now()) {
                localStorage.removeItem(key);
            }
        } catch {
            localStorage.removeItem(key);
        }
    }
}

function getSupabase() {
    if (supabaseClient) return supabaseClient;

    const config = getConfig();
    if (!config) {
        throw new Error("Site config failed to load. Refresh the page.");
    }

    sanitizeAuthStorageBeforeInit();

    const lib = window.supabase;
    if (!lib?.createClient) {
        throw new Error("Supabase failed to load. Refresh the page.");
    }

    supabaseClient = lib.createClient(config.supabase.url, config.supabase.anonKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: true,
            detectSessionInUrl: false
        }
    });
    bindAuthRecovery(supabaseClient);
    return supabaseClient;
}

let authRecoveryBound = false;

function bindAuthRecovery(sb) {
    if (authRecoveryBound) return;
    authRecoveryBound = true;

    sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
            updateNavAuthState(null);
        }
    });
}

async function recoverAuthOnStartup() {
    if (!getConfig()) return;
    sanitizeAuthStorageBeforeInit();
}

function setFlashMessage(text, type) {
    sessionStorage.setItem(FLASH_STORAGE_KEY, JSON.stringify({ text, type: type || "success" }));
}

function consumeFlashMessage() {
    const raw = sessionStorage.getItem(FLASH_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(FLASH_STORAGE_KEY);
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function loadAccountEmailFromServer() {
    const sb = getSupabase();
    if (!sb) return null;

    try {
        const { data, error } = await sb.rpc("get_my_account_email");
        if (!error && data) {
            setAccountEmailDisplay(data);
            return data;
        }
    } catch {
        /* fall through */
    }

    return accountPageState?.currentEmail || null;
}

function requireSupabase() {
    return getSupabase();
}

function normalizeUsername(raw) {
    const name = raw.trim().replace(/^#+/, "");
    return name ? "#" + name : "";
}

function isValidUsername(username) {
    return /^#[A-Za-z0-9_ ]{2,30}$/.test(username);
}

function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function savePendingVerification(data) {
    pendingVerification = { ...data, expiresAt: Date.now() + CODE_EXPIRY_MS };
    sessionStorage.setItem(VERIFY_STORAGE_KEY, JSON.stringify(pendingVerification));
}

function loadPendingVerification() {
    if (pendingVerification) return pendingVerification;
    const raw = sessionStorage.getItem(VERIFY_STORAGE_KEY);
    if (!raw) return null;
    try {
        pendingVerification = JSON.parse(raw);
        return pendingVerification;
    } catch {
        sessionStorage.removeItem(VERIFY_STORAGE_KEY);
        return null;
    }
}

function clearPendingVerification() {
    pendingVerification = null;
    sessionStorage.removeItem(VERIFY_STORAGE_KEY);
}

function savePendingEmailChange(data) {
    pendingEmailChange = { ...data, expiresAt: Date.now() + CODE_EXPIRY_MS };
    sessionStorage.setItem(EMAIL_CHANGE_STORAGE_KEY, JSON.stringify(pendingEmailChange));
}

function loadPendingEmailChange() {
    if (pendingEmailChange) return pendingEmailChange;
    const raw = sessionStorage.getItem(EMAIL_CHANGE_STORAGE_KEY);
    if (!raw) return null;
    try {
        pendingEmailChange = JSON.parse(raw);
        return pendingEmailChange;
    } catch {
        sessionStorage.removeItem(EMAIL_CHANGE_STORAGE_KEY);
        return null;
    }
}

function clearPendingEmailChange() {
    pendingEmailChange = null;
    sessionStorage.removeItem(EMAIL_CHANGE_STORAGE_KEY);
}

function savePendingPasswordChange(data) {
    pendingPasswordChange = { ...data, expiresAt: Date.now() + CODE_EXPIRY_MS };
    sessionStorage.setItem(PASSWORD_CHANGE_STORAGE_KEY, JSON.stringify(pendingPasswordChange));
}

function loadPendingPasswordChange() {
    if (pendingPasswordChange) return pendingPasswordChange;
    const raw = sessionStorage.getItem(PASSWORD_CHANGE_STORAGE_KEY);
    if (!raw) return null;
    try {
        pendingPasswordChange = JSON.parse(raw);
        return pendingPasswordChange;
    } catch {
        sessionStorage.removeItem(PASSWORD_CHANGE_STORAGE_KEY);
        return null;
    }
}

function clearPendingPasswordChange() {
    pendingPasswordChange = null;
    sessionStorage.removeItem(PASSWORD_CHANGE_STORAGE_KEY);
}

function isVerificationExpired(data) {
    return !data || Date.now() > data.expiresAt;
}

function showMessage(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = "auth-message show " + type;
}

function hideMessage(el) {
    if (!el) return;
    el.className = "auth-message";
    el.textContent = "";
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const AUTH_RETURN_KEY = "vived_auth_return";

function isSafeReturnUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
        const resolved = new URL(url, window.location.origin);
        if (resolved.origin !== window.location.origin) return false;
        const path = resolved.pathname.toLowerCase();
        return !path.endsWith("/signin.html") && !path.endsWith("/account.html");
    } catch {
        return false;
    }
}

function setAuthReturnUrl(url) {
    if (isSafeReturnUrl(url)) {
        sessionStorage.setItem(AUTH_RETURN_KEY, url);
    }
}

function consumeAuthReturnUrl() {
    const stored = sessionStorage.getItem(AUTH_RETURN_KEY);
    sessionStorage.removeItem(AUTH_RETURN_KEY);

    if (isSafeReturnUrl(stored)) return stored;

    const fromQuery = new URLSearchParams(window.location.search).get("next");
    if (isSafeReturnUrl(fromQuery)) return fromQuery;

    return null;
}

function redirectAfterAuth(fallback = "account.html") {
    const next = consumeAuthReturnUrl();
    window.location.href = next || fallback;
}

function redirectToAccount() {
    redirectAfterAuth("account.html");
}

function redirectToSignIn(returnTo) {
    if (returnTo) setAuthReturnUrl(returnTo);
    const next = returnTo && isSafeReturnUrl(returnTo)
        ? `?next=${encodeURIComponent(returnTo)}`
        : "";
    window.location.href = `signin.html${next}`;
}

function profileFromUser(user, profile) {
    return {
        displayName: profile?.display_name || user.user_metadata?.display_name || "Account",
        username: profile?.username || user.user_metadata?.username || "#Player",
        avatarUrl: profile?.avatar_url || null,
        rank: profile?.rank || null
    };
}

function renderNavAvatarHtml(profile) {
    let inner;
    if (profile?.avatarUrl) {
        const url = escapeHtml(profile.avatarUrl);
        inner = `<span class="nav-profile-avatar"><img src="${url}" alt=""></span>`;
    } else {
        const letter = escapeHtml((profile?.displayName || "A").charAt(0).toUpperCase());
        inner = `<span class="nav-profile-avatar">${letter}</span>`;
    }
    return window.VivedRanks?.wrapAvatar(inner, profile?.rank, "nav") || inner;
}

function setAccountRankBadge(rank) {
    const wrap = document.getElementById("accountPfpWrap");
    if (!wrap || !window.VivedRanks) return;
    window.VivedRanks.mountBadge(wrap, rank, "account");
}

function setPfpPreview(el, profile) {
    if (!el) return;
    if (profile?.avatarUrl) {
        el.innerHTML = `<img src="${escapeHtml(profile.avatarUrl)}" alt="">`;
        el.classList.add("has-image");
    } else {
        el.textContent = (profile?.displayName || "A").charAt(0).toUpperCase();
        el.classList.remove("has-image");
    }
}

function isRateLimitError(err) {
    const msg = (err?.message || String(err)).toLowerCase();
    return msg.includes("rate limit") || err?.code === "over_email_send_rate_limit";
}

function formatAuthError(err) {
    const msg = (err?.message || String(err)).toLowerCase();

    if (msg.includes("email signups are disabled") || msg.includes("signup is disabled")) {
        return "Email sign-ups are turned off in Supabase. Go to Authentication → Providers → Email and turn ON both 'Enable Email provider' and 'Enable sign ups'.";
    }
    if (isRateLimitError(err)) {
        return "Supabase email limit hit. Turn OFF 'Confirm email', delete test users in Authentication → Users, wait 1 hour, then use Sign In — or try a different email.";
    }
    if (msg.includes("already registered")) {
        return "This email is already registered. Use Sign In instead.";
    }
    if (msg.includes("email not confirmed") || msg.includes("supabase_confirm_on")) {
        return "Supabase 'Confirm email' is still ON. Delete your user in Authentication → Users, turn OFF Confirm email, then sign up again. Ignore Supabase link emails.";
    }
    if (msg.includes("emailjs") || msg.includes("422") || msg.includes("recipient")) {
        return "EmailJS failed to send. In EmailJS template settings, set 'To email' to {{email}}. See verify screen for your code.";
    }
    if (msg.includes("invalid login")) {
        return "Wrong email or password.";
    }
    if (msg.includes("provider is not enabled") || msg.includes("unsupported provider")) {
        return "That sign-in provider is not enabled yet. Turn it on in Supabase under Authentication → Providers.";
    }
    if (msg.includes("password should be at least") || msg.includes("weak password")) {
        return "Password must be at least 8 characters.";
    }
    if (msg.includes("same as the old password")) {
        return "Choose a different password than your current one.";
    }
    if (err?.status === 500 || msg.includes("500") || msg.includes("internal server error")) {
        return "Sign-in server error (account may be broken after an email change). In Supabase SQL Editor run: select public.repair_auth_email_identities(); then sign in again. If it still fails, delete the user in Authentication → Users and sign up again.";
    }
    if (msg.includes("bucket") || msg.includes("storage") || msg.includes("row-level security")) {
        return "Profile picture storage is not set up yet. Run the storage section in supabase/setup.sql in your Supabase SQL Editor.";
    }

    if (msg.includes("email change") || msg.includes("already been registered") || msg.includes("already in use") || msg.includes("already used")) {
        return "That email is already used by another account.";
    }
    if (msg.includes("same as")) {
        return "New email must be different from your current email.";
    }
    if (msg.includes("get_my_account_email") || msg.includes("refresh_token")) {
        return "Session expired. Please sign in again.";
    }
    if (msg.includes("update_user_email") || msg.includes("could not find the function")) {
        return "Email update is not set up in Supabase yet. Run update_user_email from supabase/setup.sql.";
    }
    if (msg.includes("account_expired")) {
        return "This account was deleted because it wasn't verified within 24 hours. Please sign up again.";
    }

    return err?.message || "Something went wrong.";
}

function initPasswordToggles() {
    document.querySelectorAll(".password-toggle").forEach(btn => {
        btn.addEventListener("click", () => {
            const input = btn.previousElementSibling;
            if (!input) return;
            const hidden = input.type === "password";
            input.type = hidden ? "text" : "password";
            btn.textContent = hidden ? "Hide" : "Show";
        });
    });
}

function initUsernameInput() {
    const input = document.getElementById("signup-username");
    if (!input) return;
    input.addEventListener("input", () => {
        input.value = input.value.replace(/^#+/, "");
    });
}

async function sendVerificationCodeEmail(purpose, params) {
    const meta = VERIFICATION_PURPOSES[purpose];
    if (!meta) throw new Error("Unknown verification purpose: " + purpose);

    const cfg = getConfig().emailjs;
    emailjs.init({ publicKey: cfg.publicKey });

    const accountDetails = meta.buildDetails(params).join("\n");

    try {
        await emailjs.send(cfg.serviceId, cfg.templateId, {
            email: params.toEmail,
            to_email: params.toEmail,
            user_email: params.userEmail || params.toEmail,
            new_email: params.newEmail || "",
            username: params.username || "—",
            display_name: params.displayName || "—",
            verification_code: params.code,
            purpose_title: meta.purpose_title,
            purpose_message: meta.purpose_message,
            footer_message: meta.footer_message,
            account_details: accountDetails,
            verification_type: purpose,
            site_name: "Vived Games",
            message: `${meta.purpose_title}: ${params.code}`
        });
    } catch (err) {
        const detail = err?.text || err?.message || String(err);
        throw new Error("EmailJS: " + detail);
    }
}

async function sendVerificationEmail({ email, username, displayName, code }) {
    await sendVerificationCodeEmail("signup", {
        toEmail: email,
        userEmail: email,
        username,
        displayName,
        code
    });
}

async function sendEmailChangeEmail({ newEmail, currentEmail, username, displayName, code }) {
    await sendVerificationCodeEmail("email_change", {
        toEmail: newEmail,
        userEmail: currentEmail,
        newEmail,
        username,
        displayName,
        code
    });
}

async function sendPasswordChangeEmail({ email, username, displayName, code }) {
    await sendVerificationCodeEmail("password_change", {
        toEmail: email,
        userEmail: email,
        username,
        displayName,
        code
    });
}

async function getProfile(userId) {
    const sb = requireSupabase();
    try {
        const { data, error } = await sb
            .from("profiles")
            .select("username, display_name, avatar_url, rank, verified, created_at")
            .eq("id", userId)
            .maybeSingle();
        if (error) throw error;
        return data;
    } catch {
        try {
            const { data, error } = await sb
                .from("profiles")
                .select("username, display_name, avatar_url, verified, created_at")
                .eq("id", userId)
                .maybeSingle();
            if (error) throw error;
            return data;
        } catch {
            return null;
        }
    }
}

function isAccountVerificationExpired(profile) {
    if (!profile || profile.verified !== false || !profile.created_at) return false;
    const createdAt = new Date(profile.created_at).getTime();
    return Date.now() - createdAt > ACCOUNT_VERIFY_DEADLINE_MS;
}

async function deleteExpiredUnverifiedAccount() {
    const sb = getSupabase();
    if (!sb) return false;

    try {
        await sb.rpc("delete_unverified_account_if_expired");
    } catch {
        /* ignore */
    }

    await clearLocalSession();
    clearPendingVerification();
    return true;
}

async function resolveUnverifiedUser(user, profile, email) {
    if (!profile || profile.verified !== false) return false;

    if (isAccountVerificationExpired(profile)) {
        await deleteExpiredUnverifiedAccount();
        throw new Error("ACCOUNT_EXPIRED");
    }

    await startVerification({
        userId: user.id,
        email,
        username: profile.username || user.user_metadata?.username,
        displayName: profile.display_name || user.user_metadata?.display_name
    });
    return true;
}

async function markProfileVerified(userId) {
    const { error } = await requireSupabase().rpc("mark_profile_verified", { user_id: userId });
    if (error) throw error;
}

function showAuthForms() {
    document.getElementById("authForms").hidden = false;
    document.getElementById("verifyView").hidden = true;
    document.getElementById("accountView").hidden = true;
    const forgotView = document.getElementById("forgotPasswordView");
    const resetView = document.getElementById("resetPasswordView");
    if (forgotView) forgotView.hidden = true;
    if (resetView) resetView.hidden = true;
}

function showForgotPasswordView() {
    document.getElementById("authForms").hidden = true;
    document.getElementById("verifyView").hidden = true;
    document.getElementById("accountView").hidden = true;
    document.getElementById("forgotPasswordView").hidden = false;
    document.getElementById("resetPasswordView").hidden = true;
    hideMessage(document.getElementById("forgotMessage"));
    document.getElementById("forgot-email")?.focus();
}

function showResetPasswordView() {
    document.getElementById("authForms").hidden = true;
    document.getElementById("verifyView").hidden = true;
    document.getElementById("accountView").hidden = true;
    document.getElementById("forgotPasswordView").hidden = true;
    document.getElementById("resetPasswordView").hidden = false;
    hideMessage(document.getElementById("resetMessage"));
    document.getElementById("reset-password")?.focus();
}

function getOAuthRedirectUrl() {
    const redirectTo = new URL("signin.html", window.location.href);
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && isSafeReturnUrl(next)) {
        redirectTo.searchParams.set("next", next);
    }
    return redirectTo.href;
}

function getPasswordResetRedirectUrl() {
    return new URL("signin.html", window.location.href).href;
}

async function generateUniqueUsername(displayName) {
    const cleaned = String(displayName || "Player")
        .replace(/[^A-Za-z0-9_ ]/g, " ")
        .trim()
        .slice(0, 28) || "Player";
    let candidate = normalizeUsername("#" + cleaned);
    if (!isValidUsername(candidate)) {
        candidate = "#Player";
    }

    const sb = requireSupabase();
    for (let n = 0; n < 20; n += 1) {
        const { data } = await sb.from("profiles").select("id").eq("username", candidate).maybeSingle();
        if (!data) return candidate;
        const suffix = String(n + 1);
        const base = cleaned.slice(0, Math.max(1, 28 - suffix.length));
        candidate = normalizeUsername("#" + base + suffix);
        if (!isValidUsername(candidate)) {
            candidate = `#User${suffix}`;
        }
    }

    return `#User${Math.floor(1000 + Math.random() * 9000)}`;
}

const OAUTH_PROVIDER_NAMES = {
    discord: "Discord",
    github: "GitHub",
    google: "Google"
};

function getActiveAuthMode() {
    return document.getElementById("signUpPanel")?.classList.contains("active") ? "signup" : "signin";
}

function updateOAuthButtonLabels(mode = getActiveAuthMode()) {
    const verb = mode === "signup" ? "Sign up with" : "Sign in with";

    document.querySelectorAll(".auth-oauth-btn").forEach(btn => {
        const provider = btn.dataset.oauthProvider;
        const name = OAUTH_PROVIDER_NAMES[provider];
        if (!name) return;

        const icon = btn.querySelector(".auth-oauth-icon");
        const iconHtml = icon ? icon.outerHTML : "";
        btn.innerHTML = `${iconHtml}<span class="auth-oauth-label">${verb} ${name}</span>`;
        btn.dataset.defaultHtml = btn.innerHTML;
    });
}

function isExistingOAuthAccount(user, profile) {
    if (!user?.created_at) return false;

    const userAge = Date.now() - new Date(user.created_at).getTime();
    if (userAge > EXISTING_OAUTH_ACCOUNT_MS) return true;

    if (profile?.created_at && profile.verified) {
        const profileAge = Date.now() - new Date(profile.created_at).getTime();
        if (profileAge > EXISTING_OAUTH_ACCOUNT_MS) return true;
    }

    return false;
}

function applyFlashMessage(elementId) {
    const flash = consumeFlashMessage();
    if (!flash?.text) return;

    const el = document.getElementById(elementId);
    if (el) showMessage(el, flash.text, flash.type || "success");
}

async function finalizeOAuthSignIn(user) {
    const sb = requireSupabase();
    const meta = user.user_metadata || {};
    const oauthIntent = sessionStorage.getItem(OAUTH_INTENT_KEY);
    sessionStorage.removeItem(OAUTH_INTENT_KEY);

    let profile = await getProfile(user.id);

    if (oauthIntent === "signup" && isExistingOAuthAccount(user, profile)) {
        setFlashMessage("An account with this provider is already created. You have been signed in.", "success");
        redirectAfterAuth("account.html");
        return;
    }

    const displayName = String(
        meta.full_name || meta.name || meta.user_name || meta.preferred_username || "Player"
    ).trim().slice(0, 30) || "Player";
    const avatarUrl = meta.avatar_url || meta.picture || null;

    const usernameBase = meta.user_name || meta.preferred_username || displayName;
    const username = profile?.username && profile.username !== "#User"
        ? profile.username
        : await generateUniqueUsername(usernameBase);

    const { error } = await sb.from("profiles").upsert({
        id: user.id,
        username,
        display_name: profile?.display_name || displayName,
        avatar_url: profile?.avatar_url || avatarUrl,
        verified: true
    }, { onConflict: "id" });

    if (error) throw error;

    if (oauthIntent === "signup") {
        setFlashMessage("Account created! Welcome to Vived Games.", "success");
    }

    redirectAfterAuth("account.html");
}

async function handleOAuthSignIn(provider, messageEl, btn, options = {}) {
    hideMessage(messageEl);
    sessionStorage.setItem(OAUTH_INTENT_KEY, getActiveAuthMode());

    if (!btn.dataset.defaultHtml) {
        btn.dataset.defaultHtml = btn.innerHTML;
    }

    btn.disabled = true;
    btn.innerHTML = "Redirecting…";

    document.querySelectorAll(".auth-oauth-btn").forEach(el => {
        el.disabled = true;
    });

    try {
        const sb = requireSupabase();
        const { error } = await sb.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: getOAuthRedirectUrl(),
                ...options
            }
        });
        if (error) throw error;
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
        document.querySelectorAll(".auth-oauth-btn").forEach(el => {
            el.disabled = false;
            if (el.dataset.defaultHtml) {
                el.innerHTML = el.dataset.defaultHtml;
            }
        });
    }
}

async function handleDiscordSignIn(messageEl, btn) {
    return handleOAuthSignIn("discord", messageEl, btn, { scopes: "identify email" });
}

async function handleGitHubSignIn(messageEl, btn) {
    return handleOAuthSignIn("github", messageEl, btn, { scopes: "read:user user:email" });
}

async function handleGoogleSignIn(messageEl, btn) {
    return handleOAuthSignIn("google", messageEl, btn);
}

async function tryInitAuthCallbackFromUrl() {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return false;

    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return false;

    const type = params.get("type");
    const sb = getSupabase();
    if (!sb) return false;

    const { data, error } = await sb.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
    });

    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (error) {
        showAuthForms();
        showMessage(document.getElementById("authMessage"), "Sign-in link expired or invalid. Try again.", "error");
        return true;
    }

    if (type === "recovery") {
        showResetPasswordView();
        return true;
    }

    if (data?.user) {
        try {
            await finalizeOAuthSignIn(data.user);
        } catch (err) {
            showAuthForms();
            showMessage(document.getElementById("authMessage"), formatAuthError(err), "error");
        }
        return true;
    }

    return false;
}

async function handleForgotPassword(form, messageEl, submitBtn) {
    hideMessage(messageEl);

    const email = form.email.value.trim();
    if (!email) {
        showMessage(messageEl, "Enter your email address.", "error");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    try {
        const sb = requireSupabase();
        const { error } = await sb.auth.resetPasswordForEmail(email, {
            redirectTo: getPasswordResetRedirectUrl()
        });
        if (error) throw error;

        showMessage(messageEl, "Check your email for a password reset link.", "success");
        form.reset();
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Reset Link";
    }
}

async function handleResetPassword(form, messageEl, submitBtn) {
    hideMessage(messageEl);

    const password = form.password.value;
    const confirm = form.confirm_password.value;

    if (password.length < 8) {
        showMessage(messageEl, "Password must be at least 8 characters.", "error");
        return;
    }
    if (password !== confirm) {
        showMessage(messageEl, "Passwords do not match.", "error");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";

    try {
        const sb = requireSupabase();
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;

        showMessage(messageEl, "Password updated! Redirecting…", "success");
        setTimeout(() => redirectAfterAuth("account.html"), 800);
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Update Password";
    }
}

function showVerifyView(email, codeFallback) {
    document.getElementById("authForms").hidden = true;
    document.getElementById("verifyView").hidden = false;
    document.getElementById("accountView").hidden = true;
    const forgotView = document.getElementById("forgotPasswordView");
    const resetView = document.getElementById("resetPasswordView");
    if (forgotView) forgotView.hidden = true;
    if (resetView) resetView.hidden = true;
    document.getElementById("verifyEmailLabel").textContent = email;
    document.getElementById("verify-code").value = "";
    document.getElementById("verify-code").focus();

    const fallbackEl = document.getElementById("codeFallback");
    if (fallbackEl) {
        if (codeFallback) {
            fallbackEl.hidden = false;
            fallbackEl.textContent = "Email failed to send. Your code: " + codeFallback;
        } else {
            fallbackEl.hidden = true;
            fallbackEl.textContent = "";
        }
    }
}

async function uploadAvatarFile(userId, file) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const allowed = ["jpg", "jpeg", "png", "webp", "gif"];
    if (!allowed.includes(ext)) {
        throw new Error("Use JPG, PNG, WEBP, or GIF.");
    }
    if (file.size > 2 * 1024 * 1024) {
        throw new Error("Image must be under 2 MB.");
    }

    const path = `${userId}/avatar.${ext === "jpeg" ? "jpg" : ext}`;
    const sb = requireSupabase();
    const { error } = await sb.storage.from("avatars").upload(path, file, {
        upsert: true,
        contentType: file.type
    });
    if (error) throw error;

    const { data } = sb.storage.from("avatars").getPublicUrl(path);
    return data.publicUrl;
}

async function updateProfileFields(userId, fields) {
    const { error } = await requireSupabase()
        .from("profiles")
        .update(fields)
        .eq("id", userId);
    if (error) throw error;
}

async function removeAvatarFile(userId) {
    const sb = requireSupabase();
    const { data: files } = await sb.storage.from("avatars").list(userId);
    if (files?.length) {
        const paths = files.map(f => `${userId}/${f.name}`);
        await sb.storage.from("avatars").remove(paths);
    }
}

let accountPageState = null;

function setAccountEmailDisplay(email) {
    if (accountPageState) {
        accountPageState.currentEmail = email;
    }
    const el = document.getElementById("accountEmail");
    if (el) el.textContent = email;
}

async function applyVerifiedEmailChange(newEmail) {
    const sb = requireSupabase();
    const { error: rpcError } = await sb.rpc("update_user_email", { new_email: newEmail });
    if (rpcError) throw rpcError;
    return newEmail;
}

async function completeEmailChangeAndSignOut(newEmail) {
    await applyVerifiedEmailChange(newEmail);
    clearPendingEmailChange();
    setFlashMessage("Email updated! Sign in with your new email address.", "success");
    await clearLocalSession();
    window.location.href = "signin.html";
}

function openAccountCollapse(panelId) {
    const panel = document.getElementById(panelId);
    const toggle = document.querySelector(`.account-collapse-toggle[aria-controls="${panelId}"]`);
    if (!panel || !toggle) return;

    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.closest(".account-collapse")?.classList.add("open");
}

function closeAccountCollapse(panelId) {
    const panel = document.getElementById(panelId);
    const toggle = document.querySelector(`.account-collapse-toggle[aria-controls="${panelId}"]`);
    if (!panel || !toggle) return;

    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.closest(".account-collapse")?.classList.remove("open");
}

function initAccountCollapses() {
    document.querySelectorAll(".account-collapse-toggle").forEach(toggle => {
        toggle.addEventListener("click", () => {
            const panelId = toggle.getAttribute("aria-controls");
            const isOpen = toggle.getAttribute("aria-expanded") === "true";

            if (isOpen) {
                closeAccountCollapse(panelId);
            } else {
                openAccountCollapse(panelId);
            }
        });
    });
}

function populateAccountPage(user, profile) {
    const info = profileFromUser(user, profile);
    accountPageState = {
        userId: user.id,
        displayName: info.displayName,
        username: info.username,
        currentEmail: user.email || "",
        avatarUrl: info.avatarUrl,
        rank: info.rank,
        pendingAvatarFile: null,
        removeAvatar: false
    };

    document.getElementById("accountDisplayInput").value = info.displayName;
    document.getElementById("accountUsername").textContent = info.username;
    document.getElementById("accountEmail").textContent = user.email || "";
    setPfpPreview(document.getElementById("accountPfpPreview"), info);
    setAccountRankBadge(info.rank);

    const removeBtn = document.getElementById("removePfpBtn");
    if (removeBtn) {
        removeBtn.hidden = !info.avatarUrl;
    }

    const pendingEmail = loadPendingEmailChange();
    if (pendingEmail?.userId === user.id && !isVerificationExpired(pendingEmail)) {
        const newEmailInput = document.getElementById("accountNewEmailInput");
        if (newEmailInput) newEmailInput.value = pendingEmail.newEmail;
        openAccountCollapse("emailChangePanel");
        showEmailChangeVerifyUI(pendingEmail.newEmail);
    } else if (pendingEmail) {
        clearPendingEmailChange();
        hideEmailChangeVerifyUI();
    }

    const pendingPassword = loadPendingPasswordChange();
    if (pendingPassword?.userId === user.id && !isVerificationExpired(pendingPassword)) {
        openAccountCollapse("passwordChangePanel");
        showPasswordChangeVerifyUI(pendingPassword.userEmail, pendingPassword);
    } else if (pendingPassword) {
        clearPendingPasswordChange();
        hidePasswordChangeVerifyUI();
    }

    updateNavAuthState(info);
}

function showEmailChangeVerifyUI(newEmail, codeFallback) {
    const panel = document.getElementById("emailChangeVerify");
    const target = document.getElementById("emailChangeTarget");
    const fallbackEl = document.getElementById("emailChangeFallback");
    const sendBtn = document.getElementById("sendEmailChangeBtn");

    if (target) target.textContent = newEmail;
    if (panel) panel.hidden = false;
    if (sendBtn) sendBtn.disabled = true;

    if (fallbackEl) {
        if (codeFallback) {
            fallbackEl.hidden = false;
            fallbackEl.textContent = "Email failed to send. Your code: " + codeFallback;
        } else {
            fallbackEl.hidden = true;
            fallbackEl.textContent = "";
        }
    }
}

function hideEmailChangeVerifyUI() {
    const panel = document.getElementById("emailChangeVerify");
    const fallbackEl = document.getElementById("emailChangeFallback");
    const codeInput = document.getElementById("emailChangeCode");
    const sendBtn = document.getElementById("sendEmailChangeBtn");

    if (panel) panel.hidden = true;
    if (fallbackEl) {
        fallbackEl.hidden = true;
        fallbackEl.textContent = "";
    }
    if (codeInput) codeInput.value = "";
    if (sendBtn) sendBtn.disabled = false;
}

async function handleSendEmailChange(messageEl, sendBtn) {
    if (!accountPageState) return;
    hideMessage(messageEl);

    const newEmail = document.getElementById("accountNewEmailInput").value.trim().toLowerCase();
    const currentEmail = (accountPageState.currentEmail || "").toLowerCase();

    if (!newEmail || !newEmail.includes("@")) {
        showMessage(messageEl, "Enter a valid new email address.", "error");
        return;
    }
    if (newEmail === currentEmail) {
        showMessage(messageEl, "That is already your current email.", "error");
        return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";

    const code = generateVerificationCode();

    try {
        await sendEmailChangeEmail({
            newEmail,
            currentEmail: accountPageState.currentEmail,
            username: accountPageState.username,
            displayName: accountPageState.displayName,
            code
        });

        savePendingEmailChange({
            code,
            newEmail,
            userId: accountPageState.userId,
            currentEmail: accountPageState.currentEmail,
            username: accountPageState.username,
            displayName: accountPageState.displayName,
            lastSentAt: Date.now()
        });

        showEmailChangeVerifyUI(newEmail);
        openAccountCollapse("emailChangePanel");
        showMessage(messageEl, "Code sent to your new email. Check inbox and spam.", "success");
    } catch (err) {
        savePendingEmailChange({
            code,
            newEmail,
            userId: accountPageState.userId,
            currentEmail: accountPageState.currentEmail,
            username: accountPageState.username,
            displayName: accountPageState.displayName,
            lastSentAt: Date.now()
        });
        showEmailChangeVerifyUI(newEmail, code);
        openAccountCollapse("emailChangePanel");
        showMessage(messageEl, formatAuthError(err), "error");
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send verification code";
    }
}

async function resendEmailChangeCode(messageEl) {
    const pending = loadPendingEmailChange();
    if (!pending || isVerificationExpired(pending)) {
        clearPendingEmailChange();
        hideEmailChangeVerifyUI();
        showMessage(messageEl, "Code expired. Request a new one.", "error");
        return;
    }

    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - (pending.lastSentAt || 0));
    if (waitMs > 0) {
        showMessage(messageEl, `Wait ${Math.ceil(waitMs / 1000)}s before resending.`, "error");
        return;
    }

    const code = generateVerificationCode();
    savePendingEmailChange({ ...pending, code, lastSentAt: Date.now() });

    try {
        await sendEmailChangeEmail({
            newEmail: pending.newEmail,
            currentEmail: pending.currentEmail,
            username: pending.username,
            displayName: pending.displayName,
            code
        });
        showMessage(messageEl, "New code sent!", "success");
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
    }
}

async function handleConfirmEmailChange(messageEl, confirmBtn) {
    hideMessage(messageEl);

    const entered = document.getElementById("emailChangeCode").value.trim();
    const pending = loadPendingEmailChange();

    if (!pending || isVerificationExpired(pending)) {
        clearPendingEmailChange();
        hideEmailChangeVerifyUI();
        showMessage(messageEl, "Code expired. Send a new code.", "error");
        return;
    }

    if (entered !== pending.code) {
        showMessage(messageEl, "Wrong code. Try again.", "error");
        return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = "Updating…";

    try {
        await completeEmailChangeAndSignOut(pending.newEmail);
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm new email";
    }
}

function cancelEmailChange(messageEl) {
    clearPendingEmailChange();
    hideEmailChangeVerifyUI();
    hideMessage(messageEl);
    const newEmailInput = document.getElementById("accountNewEmailInput");
    if (newEmailInput) newEmailInput.value = "";
    closeAccountCollapse("emailChangePanel");
}

function showPasswordChangeVerifyUI(email, codeFallback) {
    const panel = document.getElementById("passwordChangeVerify");
    const target = document.getElementById("passwordChangeTarget");
    const fallbackEl = document.getElementById("passwordChangeFallback");
    const sendBtn = document.getElementById("sendPasswordChangeBtn");

    if (target) target.textContent = email;
    if (panel) panel.hidden = false;
    if (sendBtn) sendBtn.disabled = true;

    if (fallbackEl) {
        if (codeFallback && typeof codeFallback === "string") {
            fallbackEl.hidden = false;
            fallbackEl.textContent = "Email failed to send. Your code: " + codeFallback;
        } else {
            fallbackEl.hidden = true;
            fallbackEl.textContent = "";
        }
    }
}

function hidePasswordChangeVerifyUI() {
    const panel = document.getElementById("passwordChangeVerify");
    const fallbackEl = document.getElementById("passwordChangeFallback");
    const codeInput = document.getElementById("passwordChangeCode");
    const sendBtn = document.getElementById("sendPasswordChangeBtn");

    if (panel) panel.hidden = true;
    if (fallbackEl) {
        fallbackEl.hidden = true;
        fallbackEl.textContent = "";
    }
    if (codeInput) codeInput.value = "";
    if (sendBtn) sendBtn.disabled = false;
}

async function handleSendPasswordChange(messageEl, sendBtn) {
    if (!accountPageState) return;
    hideMessage(messageEl);

    const newPassword = document.getElementById("accountNewPassword").value;
    const confirmPassword = document.getElementById("accountConfirmPassword").value;

    if (newPassword.length < 8) {
        showMessage(messageEl, "Password must be at least 8 characters.", "error");
        return;
    }
    if (newPassword !== confirmPassword) {
        showMessage(messageEl, "Passwords do not match.", "error");
        return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";

    const code = generateVerificationCode();

    try {
        await sendPasswordChangeEmail({
            email: accountPageState.currentEmail,
            username: accountPageState.username,
            displayName: accountPageState.displayName,
            code
        });

        savePendingPasswordChange({
            code,
            newPassword,
            userEmail: accountPageState.currentEmail,
            userId: accountPageState.userId,
            username: accountPageState.username,
            displayName: accountPageState.displayName,
            lastSentAt: Date.now()
        });

        showPasswordChangeVerifyUI(accountPageState.currentEmail);
        openAccountCollapse("passwordChangePanel");
        showMessage(messageEl, "Code sent to your email. Check inbox and spam.", "success");
    } catch (err) {
        savePendingPasswordChange({
            code,
            newPassword,
            userEmail: accountPageState.currentEmail,
            userId: accountPageState.userId,
            username: accountPageState.username,
            displayName: accountPageState.displayName,
            lastSentAt: Date.now()
        });
        showPasswordChangeVerifyUI(accountPageState.currentEmail, code);
        openAccountCollapse("passwordChangePanel");
        showMessage(messageEl, formatAuthError(err), "error");
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send verification code";
    }
}

async function resendPasswordChangeCode(messageEl) {
    const pending = loadPendingPasswordChange();
    if (!pending || isVerificationExpired(pending)) {
        clearPendingPasswordChange();
        hidePasswordChangeVerifyUI();
        showMessage(messageEl, "Code expired. Request a new one.", "error");
        return;
    }

    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - (pending.lastSentAt || 0));
    if (waitMs > 0) {
        showMessage(messageEl, `Wait ${Math.ceil(waitMs / 1000)}s before resending.`, "error");
        return;
    }

    const code = generateVerificationCode();
    savePendingPasswordChange({ ...pending, code, lastSentAt: Date.now() });

    try {
        await sendPasswordChangeEmail({
            email: pending.userEmail,
            username: pending.username,
            displayName: pending.displayName,
            code
        });
        showMessage(messageEl, "New code sent!", "success");
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
    }
}

async function handleConfirmPasswordChange(messageEl, confirmBtn) {
    hideMessage(messageEl);

    const entered = document.getElementById("passwordChangeCode").value.trim();
    const pending = loadPendingPasswordChange();

    if (!pending || isVerificationExpired(pending)) {
        clearPendingPasswordChange();
        hidePasswordChangeVerifyUI();
        showMessage(messageEl, "Code expired. Send a new code.", "error");
        return;
    }

    if (entered !== pending.code) {
        showMessage(messageEl, "Wrong code. Try again.", "error");
        return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = "Updating…";

    try {
        const sb = requireSupabase();
        const { error } = await sb.auth.updateUser({ password: pending.newPassword });
        if (error) throw error;

        document.getElementById("accountNewPassword").value = "";
        document.getElementById("accountConfirmPassword").value = "";

        clearPendingPasswordChange();
        hidePasswordChangeVerifyUI();
        closeAccountCollapse("passwordChangePanel");

        showMessage(messageEl, "Password updated successfully!", "success");
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm new password";
    }
}

function cancelPasswordChange(messageEl) {
    clearPendingPasswordChange();
    hidePasswordChangeVerifyUI();
    hideMessage(messageEl);
    document.getElementById("accountNewPassword").value = "";
    document.getElementById("accountConfirmPassword").value = "";
    closeAccountCollapse("passwordChangePanel");
}

function bindAccountPageEvents() {
    const pfpInput = document.getElementById("accountPfpInput");
    const removeBtn = document.getElementById("removePfpBtn");
    const saveBtn = document.getElementById("saveAccountBtn");
    const signOutBtn = document.getElementById("signOutBtn");
    const messageEl = document.getElementById("accountMessage");

    pfpInput?.addEventListener("change", () => {
        const file = pfpInput.files?.[0];
        if (!file || !accountPageState) return;

        accountPageState.pendingAvatarFile = file;
        accountPageState.removeAvatar = false;

        const previewUrl = URL.createObjectURL(file);
        const previewEl = document.getElementById("accountPfpPreview");
        previewEl.innerHTML = `<img src="${previewUrl}" alt="">`;
        previewEl.classList.add("has-image");
        if (removeBtn) removeBtn.hidden = false;
        hideMessage(messageEl);
    });

    removeBtn?.addEventListener("click", () => {
        if (!accountPageState) return;
        accountPageState.pendingAvatarFile = null;
        accountPageState.removeAvatar = true;
        accountPageState.avatarUrl = null;
        pfpInput.value = "";
        setPfpPreview(document.getElementById("accountPfpPreview"), {
            displayName: document.getElementById("accountDisplayInput").value.trim() || accountPageState.displayName
        });
        removeBtn.hidden = true;
        hideMessage(messageEl);
    });

    saveBtn?.addEventListener("click", () => handleSaveAccount(messageEl, saveBtn));
    signOutBtn?.addEventListener("click", handleSignOut);

    const sendEmailBtn = document.getElementById("sendEmailChangeBtn");
    const confirmEmailBtn = document.getElementById("confirmEmailChangeBtn");
    const resendEmailBtn = document.getElementById("resendEmailChangeBtn");
    const cancelEmailBtn = document.getElementById("cancelEmailChangeBtn");

    sendEmailBtn?.addEventListener("click", () => handleSendEmailChange(messageEl, sendEmailBtn));
    confirmEmailBtn?.addEventListener("click", () => handleConfirmEmailChange(messageEl, confirmEmailBtn));
    resendEmailBtn?.addEventListener("click", () => resendEmailChangeCode(messageEl));
    cancelEmailBtn?.addEventListener("click", () => cancelEmailChange(messageEl));

    const sendPasswordBtn = document.getElementById("sendPasswordChangeBtn");
    const confirmPasswordBtn = document.getElementById("confirmPasswordChangeBtn");
    const resendPasswordBtn = document.getElementById("resendPasswordChangeBtn");
    const cancelPasswordBtn = document.getElementById("cancelPasswordChangeBtn");

    sendPasswordBtn?.addEventListener("click", () => handleSendPasswordChange(messageEl, sendPasswordBtn));
    confirmPasswordBtn?.addEventListener("click", () => handleConfirmPasswordChange(messageEl, confirmPasswordBtn));
    resendPasswordBtn?.addEventListener("click", () => resendPasswordChangeCode(messageEl));
    cancelPasswordBtn?.addEventListener("click", () => cancelPasswordChange(messageEl));
}

async function handleSaveAccount(messageEl, saveBtn) {
    if (!accountPageState) return;
    hideMessage(messageEl);

    const displayName = document.getElementById("accountDisplayInput").value.trim();
    if (displayName.length < 2) {
        showMessage(messageEl, "Display name must be at least 2 characters.", "error");
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
        const updates = { display_name: displayName };
        let avatarUrl = accountPageState.avatarUrl;

        if (accountPageState.removeAvatar) {
            await removeAvatarFile(accountPageState.userId);
            updates.avatar_url = null;
            avatarUrl = null;
        } else if (accountPageState.pendingAvatarFile) {
            avatarUrl = await uploadAvatarFile(accountPageState.userId, accountPageState.pendingAvatarFile);
            updates.avatar_url = avatarUrl;
        }

        await updateProfileFields(accountPageState.userId, updates);

        accountPageState.displayName = displayName;
        accountPageState.avatarUrl = avatarUrl;
        accountPageState.pendingAvatarFile = null;
        accountPageState.removeAvatar = false;

        const removeBtn = document.getElementById("removePfpBtn");
        if (removeBtn) removeBtn.hidden = !avatarUrl;

        setPfpPreview(document.getElementById("accountPfpPreview"), {
            displayName,
            avatarUrl
        });
        setAccountRankBadge(accountPageState.rank);

        updateNavAuthState({
            displayName,
            username: document.getElementById("accountUsername").textContent,
            avatarUrl: avatarUrl ? `${avatarUrl}?t=${Date.now()}` : null,
            rank: accountPageState.rank
        });

        showMessage(messageEl, "Account updated!", "success");
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Changes";
    }
}

async function initAccountPage() {
    const sb = getSupabase();
    if (!sb) {
        redirectToSignIn();
        return;
    }

    const session = await getActiveSession(sb);
    if (!session?.user) {
        redirectToSignIn();
        return;
    }

    const profile = await getProfile(session.user.id);
    if (!profile || profile.verified === false) {
        await clearLocalSession();
        redirectToSignIn();
        return;
    }

    populateAccountPage(session.user, profile);
    await loadAccountEmailFromServer();
    initAccountCollapses();
    initPasswordToggles();
    bindAccountPageEvents();
    applyFlashMessage("accountMessage");
}

async function startVerification({ userId, email, username, displayName }) {
    const code = generateVerificationCode();
    const verifyMsg = document.getElementById("verifyMessage");

    savePendingVerification({
        code,
        email,
        userId,
        username,
        displayName,
        lastSentAt: Date.now()
    });

    showVerifyView(email);

    try {
        await sendVerificationEmail({ email, username, displayName, code });
        showMessage(verifyMsg, "Code sent! Check inbox and spam.", "success");
    } catch (err) {
        showVerifyView(email, code);
        showMessage(verifyMsg, formatAuthError(err), "error");
    }
}

async function resendVerificationCode() {
    const messageEl = document.getElementById("verifyMessage");
    const pending = loadPendingVerification();

    if (!pending) {
        showMessage(messageEl, "Session expired. Go back and sign up again.", "error");
        return;
    }

    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - (pending.lastSentAt || 0));
    if (waitMs > 0) {
        showMessage(messageEl, `Wait ${Math.ceil(waitMs / 1000)}s before resending.`, "error");
        return;
    }

    const code = generateVerificationCode();
    savePendingVerification({ ...pending, code, lastSentAt: Date.now() });

    try {
        await sendVerificationEmail({
            email: pending.email,
            username: pending.username,
            displayName: pending.displayName,
            code
        });
        showMessage(messageEl, "New code sent!", "success");
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
    }
}

async function handleVerifyCode(form, messageEl, submitBtn) {
    hideMessage(messageEl);

    const entered = form.code.value.trim();
    const pending = loadPendingVerification();

    if (!pending || isVerificationExpired(pending)) {
        clearPendingVerification();
        showMessage(messageEl, "Code expired. Sign up again or resend.", "error");
        return;
    }

    if (entered !== pending.code) {
        showMessage(messageEl, "Wrong code. Try again.", "error");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying…";

    try {
        const profile = await getProfile(pending.userId);
        if (isAccountVerificationExpired(profile)) {
            await deleteExpiredUnverifiedAccount();
            showAuthForms();
            showMessage(messageEl, formatAuthError(new Error("ACCOUNT_EXPIRED")), "error");
            return;
        }

        await markProfileVerified(pending.userId);
        clearPendingVerification();

        const sb = requireSupabase();
        const session = await getActiveSession(sb);

        if (session?.user) {
            showMessage(messageEl, "Verified! Welcome to Vived Games.", "success");
            setTimeout(redirectToAccount, 500);
        } else {
            showMessage(messageEl, "Verified! Now sign in with your email and password.", "success");
            setTimeout(showAuthForms, 1500);
        }
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Verify & Continue";
    }
}

async function tryExistingAccountSignIn({ email, password, username, displayName }) {
    const sb = requireSupabase();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data.user) return false;

    const profile = await getProfile(data.user.id);
    const meta = data.user.user_metadata || {};

    if (!profile || profile.verified === false) {
        await resolveUnverifiedUser(data.user, profile, email);
        return true;
    }

    redirectToAccount();
    return true;
}

async function handleSignUp(form, messageEl, submitBtn) {
    hideMessage(messageEl);

    const username = normalizeUsername(form.username.value);
    const displayName = form.display_name.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;

    if (!isValidUsername(username)) {
        showMessage(messageEl, "Username must be 2–30 characters (letters, numbers, spaces, _).", "error");
        return;
    }
    if (displayName.length < 2) {
        showMessage(messageEl, "Display name too short.", "error");
        return;
    }
    if (password.length < 8) {
        showMessage(messageEl, "Password must be at least 8 characters.", "error");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating…";

    try {
        const sb = requireSupabase();

        const { data: existing } = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
        if (existing) {
            showMessage(messageEl, "Username taken. Pick another.", "error");
            return;
        }

        const { data, error } = await sb.auth.signUp({
            email,
            password,
            options: { data: { username, display_name: displayName } }
        });

        if (error) throw error;
        if (!data.user) throw new Error("Could not create account.");

        if (!data.session) {
            const { error: signInError } = await sb.auth.signInWithPassword({ email, password });
            if (signInError?.message?.toLowerCase().includes("email not confirmed")) {
                throw new Error("SUPABASE_CONFIRM_ON");
            }
        }

        form.reset();

        await startVerification({
            userId: data.user.id,
            email,
            username,
            displayName
        });
    } catch (err) {
        if (isRateLimitError(err)) {
            const recovered = await tryExistingAccountSignIn({ email, password, username, displayName });
            if (recovered) return;
        }
        showMessage(messageEl, formatAuthError(err), "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
    }
}

async function handleSignIn(form, messageEl, submitBtn) {
    hideMessage(messageEl);

    const email = form.email.value.trim();
    const password = form.password.value;

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";

    try {
        const sb = requireSupabase();
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const profile = await getProfile(data.user.id);

        if (profile?.verified === false) {
            await resolveUnverifiedUser(data.user, profile, email);
            return;
        }

        redirectToAccount();
    } catch (err) {
        showMessage(messageEl, formatAuthError(err), "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In";
    }
}

async function handleNavLogout() {
    await clearLocalSession();
    clearPendingVerification();
    clearPendingEmailChange();
    clearPendingPasswordChange();
    redirectToSignIn();
}

async function handleSignOut() {
    await handleNavLogout();
}

let navProfileEventsBound = false;

function bindNavProfileEvents() {
    if (navProfileEventsBound) return;
    navProfileEventsBound = true;

    document.addEventListener("click", e => {
        const profileBtn = e.target.closest(".nav-profile-btn");
        if (profileBtn) {
            e.stopPropagation();
            const profile = profileBtn.closest(".nav-profile");
            document.querySelectorAll(".nav-profile.open").forEach(el => {
                if (el !== profile) el.classList.remove("open");
            });
            profile.classList.toggle("open");
            return;
        }

        if (e.target.closest("[data-nav-logout]")) {
            e.preventDefault();
            handleNavLogout();
            return;
        }

        if (!e.target.closest(".nav-profile")) {
            document.querySelectorAll(".nav-profile.open").forEach(el => el.classList.remove("open"));
        }
    });
}

function updateNavAuthState(profile) {
    bindNavProfileEvents();

    const authHtml = profile?.displayName
        ? `
                <div class="nav-profile">
                    <button type="button" class="nav-profile-btn" aria-label="Profile menu">
                        ${renderNavAvatarHtml(profile)}
                    </button>
                    <div class="nav-profile-dropdown">
                        <a href="account.html">Account</a>
                        <button type="button" data-nav-logout>Logout</button>
                    </div>
                </div>`
        : `<a href="signin.html" class="nav-signin-link">Sign In</a>`;

    document.querySelectorAll("[data-nav-auth], [data-nav-auth-mobile]").forEach(slot => {
        slot.innerHTML = authHtml;
    });
}

function initAuthTabs() {
    const tabs = document.querySelectorAll(".auth-tab");
    const panels = document.querySelectorAll(".auth-panel");
    const messageEl = document.getElementById("authMessage");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById(tab.dataset.panel).classList.add("active");
            hideMessage(messageEl);
            updateOAuthButtonLabels(tab.dataset.panel === "signUpPanel" ? "signup" : "signin");
        });
    });

    updateOAuthButtonLabels();
}

function initAuthForms() {
    initUsernameInput();
    initPasswordToggles();

    document.getElementById("signUpForm").addEventListener("submit", e => {
        e.preventDefault();
        handleSignUp(e.target, document.getElementById("authMessage"), e.target.querySelector(".auth-submit"));
    });

    document.getElementById("signInForm").addEventListener("submit", e => {
        e.preventDefault();
        handleSignIn(e.target, document.getElementById("authMessage"), e.target.querySelector(".auth-submit"));
    });

    document.getElementById("verifyForm").addEventListener("submit", e => {
        e.preventDefault();
        handleVerifyCode(e.target, document.getElementById("verifyMessage"), e.target.querySelector(".auth-submit"));
    });

    document.getElementById("resendCodeBtn").addEventListener("click", resendVerificationCode);
    document.getElementById("backToSignInBtn").addEventListener("click", showAuthForms);

    const forgotBtn = document.getElementById("forgotPasswordBtn");
    if (forgotBtn) {
        forgotBtn.addEventListener("click", showForgotPasswordView);
    }

    const forgotForm = document.getElementById("forgotPasswordForm");
    if (forgotForm) {
        forgotForm.addEventListener("submit", e => {
            e.preventDefault();
            handleForgotPassword(e.target, document.getElementById("forgotMessage"), e.target.querySelector(".auth-submit"));
        });
    }

    const backFromForgotBtn = document.getElementById("backFromForgotBtn");
    if (backFromForgotBtn) {
        backFromForgotBtn.addEventListener("click", showAuthForms);
    }

    const resetForm = document.getElementById("resetPasswordForm");
    if (resetForm) {
        resetForm.addEventListener("submit", e => {
            e.preventDefault();
            handleResetPassword(e.target, document.getElementById("resetMessage"), e.target.querySelector(".auth-submit"));
        });
    }

    const discordBtn = document.getElementById("discordSignInBtn");
    if (discordBtn) {
        discordBtn.addEventListener("click", () => {
            handleDiscordSignIn(document.getElementById("authMessage"), discordBtn);
        });
    }

    const githubBtn = document.getElementById("githubSignInBtn");
    if (githubBtn) {
        githubBtn.addEventListener("click", () => {
            handleGitHubSignIn(document.getElementById("authMessage"), githubBtn);
        });
    }

    const googleBtn = document.getElementById("googleSignInBtn");
    if (googleBtn) {
        googleBtn.addEventListener("click", () => {
            handleGoogleSignIn(document.getElementById("authMessage"), googleBtn);
        });
    }
}

async function initAuthPage() {
    initAuthTabs();
    initAuthForms();

    const nextParam = new URLSearchParams(window.location.search).get("next");
    if (nextParam) setAuthReturnUrl(nextParam);

    const flash = consumeFlashMessage();
    if (flash?.text) {
        showMessage(document.getElementById("authMessage"), flash.text, flash.type || "success");
    }

    if (await tryInitAuthCallbackFromUrl()) {
        return;
    }

    const pending = loadPendingVerification();
    if (pending && !isVerificationExpired(pending)) {
        showVerifyView(pending.email);
        return;
    }

    const sb = getSupabase();
    if (!sb) return;

    const session = await getActiveSession(sb);
    if (!session?.user) return;

    const profile = await getProfile(session.user.id);
    if (profile?.verified === false) {
        if (isAccountVerificationExpired(profile)) {
            await deleteExpiredUnverifiedAccount();
            showAuthForms();
            showMessage(document.getElementById("authMessage"), formatAuthError(new Error("ACCOUNT_EXPIRED")), "error");
            return;
        }
        showVerifyView(session.user.email);
    } else {
        redirectAfterAuth("account.html");
    }
}

async function recordProfileActivity() {
    const sb = getSupabase();
    if (!sb) return;

    const session = await getActiveSession(sb);
    if (!session?.user) return;

    try {
        await sb.rpc("record_profile_activity");
    } catch {
        /* activity tracking is optional until SQL is applied */
    }
}

async function initNavAuth() {
    const sb = getSupabase();
    if (!sb) {
        updateNavAuthState(null);
        return;
    }

    const session = await getActiveSession(sb);
    if (session?.user) {
        const profile = await getProfile(session.user.id);
        if (profile?.verified !== false) {
            updateNavAuthState({
                displayName: profile?.display_name || session.user.user_metadata?.display_name || "Account",
                username: profile?.username,
                avatarUrl: profile?.avatar_url || null,
                rank: profile?.rank || null
            });
            recordProfileActivity();
            return;
        }
    }

    updateNavAuthState(null);
}

function runWhenReady(fn) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn);
    } else {
        fn();
    }
}

window.VivedAuth = {
    getActiveSession,
    getSupabase,
    redirectToSignIn,
    isSafeReturnUrl
};

runWhenReady(async () => {
    await recoverAuthOnStartup();

    if (document.getElementById("accountDisplayInput")) {
        initAccountPage();
    } else if (document.getElementById("signInForm")) {
        initAuthPage();
    }
    if (getConfig() && (document.querySelector("[data-nav-auth]") || document.querySelector("[data-nav-auth-mobile]"))) {
        initNavAuth();
    }
    if (window.initDownloadGate) {
        window.initDownloadGate();
    }
});
