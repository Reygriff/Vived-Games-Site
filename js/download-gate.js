function isAuthGateTarget(el) {
    if (!el) return false;
    if (el.classList.contains("disabled") || el.disabled) return false;
    if (el.matches(".profile-message-btn")) return true;
    if (el.matches("[data-require-auth]")) return true;
    if (el.matches("[data-download-gate]")) return true;
    if (el.matches("a.download-btn, button.download-btn")) return true;
    if (el.matches(".btn-download")) return true;
    return false;
}

function getAuthGateTargetUrl(el) {
    if (el.tagName === "A" && el.href) {
        return el.href;
    }
    return window.location.href;
}

async function userIsSignedIn() {
    const auth = window.VivedAuth;
    if (!auth?.getSupabase || !auth?.getActiveSession) return false;

    try {
        const sb = auth.getSupabase();
        const session = await auth.getActiveSession(sb);
        return Boolean(session?.user);
    } catch {
        return false;
    }
}

async function handleAuthGateClick(event) {
    const target = event.target.closest("a, button");
    if (!isAuthGateTarget(target)) return;

    if (await userIsSignedIn()) return;

    event.preventDefault();
    event.stopPropagation();

    const returnTo = getAuthGateTargetUrl(target);
    window.VivedAuth.redirectToSignIn(returnTo);
}

function initDownloadGate() {
    if (document.documentElement.dataset.downloadGateBound === "true") return;
    document.documentElement.dataset.downloadGateBound = "true";
    document.addEventListener("click", handleAuthGateClick, true);
}

window.initDownloadGate = initDownloadGate;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        if (window.VivedAuth) initDownloadGate();
    });
} else if (window.VivedAuth) {
    initDownloadGate();
}
