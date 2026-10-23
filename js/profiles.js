function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderProfileAvatar(profile) {
    let inner;
    if (profile.avatar_url) {
        inner = `<span class="profile-card-avatar"><img src="${escapeHtml(profile.avatar_url)}" alt=""></span>`;
    } else {
        const letter = escapeHtml((profile.display_name || profile.username || "?").charAt(0).toUpperCase());
        inner = `<span class="profile-card-avatar">${letter}</span>`;
    }
    return window.VivedRanks?.wrapAvatar(inner, profile.rank, "card") || inner;
}

function profilePageUrl(username) {
    return `profile.html?user=${encodeURIComponent(username || "")}`;
}

function vaultMessageUrl(username) {
    const encoded = encodeURIComponent(username || "");
    return `vault/vault.html?to=${encoded}`;
}

function renderProfileCard(profile, currentUserId) {
    const username = profile.username || "#Player";
    const displayName = profile.display_name || username;
    const isYou = currentUserId && profile.id === currentUserId;
    const youLabel = isYou ? ' <span class="profile-card-you">(You)</span>' : "";

    return `
        <article class="profile-card">
            <a class="profile-card-link" href="${escapeHtml(profilePageUrl(username))}">
                ${renderProfileAvatar(profile)}
                <h3 class="profile-card-name">${escapeHtml(displayName)}${youLabel}</h3>
                <p class="profile-card-username">${escapeHtml(username)}</p>
            </a>
            <a class="profile-message-btn" href="${escapeHtml(vaultMessageUrl(username))}">Message</a>
        </article>`;
}

async function loadProfiles(searchQuery) {
    const grid = document.getElementById("profilesGrid");
    const empty = document.getElementById("profilesEmpty");
    if (!grid) return;

    grid.innerHTML = `<p class="profiles-loading">Loading profiles…</p>`;
    if (empty) empty.hidden = true;

    const auth = window.VivedAuth;
    if (!auth?.getSupabase) {
        grid.innerHTML = "";
        if (empty) {
            empty.textContent = "Profiles could not load. Refresh the page.";
            empty.hidden = false;
        }
        return;
    }

    try {
        const sb = auth.getSupabase();
        const { data, error } = await sb.rpc("list_active_profiles", {
            search_query: searchQuery || "",
            result_limit: 24
        });

        if (error) throw error;

        const profiles = Array.isArray(data) ? data : [];
        let currentUserId = null;
        const session = await auth.getActiveSession(sb);
        if (session?.user) currentUserId = session.user.id;

        if (!profiles.length) {
            grid.innerHTML = "";
            if (empty) {
                empty.textContent = searchQuery
                    ? "No profiles match your search."
                    : "No active profiles yet. Sign in and explore the site to appear here.";
                empty.hidden = false;
            }
            return;
        }

        grid.innerHTML = profiles.map(profile => renderProfileCard(profile, currentUserId)).join("");
    } catch {
        grid.innerHTML = "";
        if (empty) {
            empty.textContent = "Could not load profiles. Run the activity section in supabase/setup.sql.";
            empty.hidden = false;
        }
    }
}

function initProfilesPage() {
    const form = document.getElementById("profilesSearchForm");
    const input = document.getElementById("profilesSearchInput");
    if (!form || !input) return;

    let searchTimer = null;

    form.addEventListener("submit", e => {
        e.preventDefault();
        loadProfiles(input.value.trim());
    });

    input.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadProfiles(input.value.trim()), 300);
    });

    loadProfiles("");
}

if (document.getElementById("profilesGrid")) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initProfilesPage);
    } else {
        initProfilesPage();
    }
}
