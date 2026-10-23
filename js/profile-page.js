function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function normalizeProfileLookup(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return "";
    return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function renderAvatar(profile) {
    let inner;
    if (profile.avatar_url) {
        inner = `<span class="public-profile-avatar"><img src="${escapeHtml(profile.avatar_url)}" alt=""></span>`;
    } else {
        const letter = escapeHtml((profile.display_name || profile.username || "?").charAt(0).toUpperCase());
        inner = `<span class="public-profile-avatar">${letter}</span>`;
    }
    return window.VivedRanks?.wrapAvatar(inner, profile.rank, "profile") || inner;
}

function vaultMessageUrl(username) {
    return `vault/vault.html?to=${encodeURIComponent(username || "")}`;
}

function renderProfilePage(profile, currentUserId) {
    const username = profile.username || "#Player";
    const displayName = profile.display_name || username;
    const isYou = currentUserId && profile.id === currentUserId;
    const youLabel = isYou ? ' <span class="profile-card-you">(You)</span>' : "";

    const rankBtn = isYou
        ? `<a class="profile-rank-btn" href="tags.html">Rank</a>`
        : "";

    return `
        <div class="public-profile-card">
            ${renderAvatar(profile)}
            <h1 class="public-profile-name">${escapeHtml(displayName)}${youLabel}</h1>
            <p class="public-profile-username">${escapeHtml(username)}</p>
            <div class="profile-actions">
                ${rankBtn}
                <a class="profile-message-btn" href="${escapeHtml(vaultMessageUrl(username))}">Message</a>
            </div>
        </div>`;
}

async function loadPublicProfile() {
    const root = document.getElementById("publicProfileRoot");
    if (!root) return;

    const lookup = normalizeProfileLookup(new URLSearchParams(window.location.search).get("user"));
    if (!lookup) {
        root.innerHTML = `<p class="public-profile-error">No profile specified. <a href="profiles.html">Browse profiles</a></p>`;
        return;
    }

    const auth = window.VivedAuth;
    if (!auth?.getSupabase) {
        root.innerHTML = `<p class="public-profile-error">Could not load profile. Refresh the page.</p>`;
        return;
    }

    try {
        const sb = auth.getSupabase();
        const { data, error } = await sb.rpc("get_public_profile", { lookup });
        if (error) throw error;
        if (!data?.username) {
            root.innerHTML = `<p class="public-profile-error">Profile not found. <a href="profiles.html">Browse profiles</a></p>`;
            document.title = "Vived Games | Profile Not Found";
            return;
        }

        let currentUserId = null;
        const session = await auth.getActiveSession(sb);
        if (session?.user) currentUserId = session.user.id;

        root.innerHTML = renderProfilePage(data, currentUserId);
        document.title = `Vived Games | ${data.display_name || data.username}`;
    } catch {
        root.innerHTML = `<p class="public-profile-error">Could not load profile. <a href="profiles.html">Browse profiles</a></p>`;
    }
}

if (document.getElementById("publicProfileRoot")) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", loadPublicProfile);
    } else {
        loadPublicProfile();
    }
}
