/**
 * Fetch a player's public profile (including avatar_url) from Supabase.
 * Use this in games or any page — no login required.
 *
 * Example:
 *   const player = await VivedProfile.getByUsername("#Reygriff");
 *   if (player?.avatar_url) showImage(player.avatar_url);
 */
(function () {
    function normalizeUsername(raw) {
        const name = String(raw || "").trim().replace(/^#+/, "");
        return name ? "#" + name : "";
    }

    function getClient() {
        const cfg = window.VIVED_CONFIG;
        const lib = window.supabase;
        if (!cfg?.supabase?.url || !cfg?.supabase?.anonKey || !lib?.createClient) {
            throw new Error("Load config.js and Supabase before profile.js");
        }
        return lib.createClient(cfg.supabase.url, cfg.supabase.anonKey);
    }

    async function fetchPublicProfile(lookup) {
        const key = String(lookup || "").trim();
        if (!key) return null;

        const sb = getClient();
        const { data, error } = await sb.rpc("get_public_profile", { lookup: key });
        if (error) throw error;
        return data || null;
    }

    window.VivedProfile = {
        normalizeUsername,

        /** @param {string} username e.g. "#Reygriff" or "Reygriff" */
        getByUsername(username) {
            const normalized = normalizeUsername(username);
            if (!normalized) return Promise.resolve(null);
            return fetchPublicProfile(normalized);
        },

        /** @param {string} userId UUID */
        getById(userId) {
            const id = String(userId || "").trim();
            if (!id) return Promise.resolve(null);
            return fetchPublicProfile(id);
        },

        /** First letter fallback when avatar_url is null */
        avatarLetter(profile) {
            const name = profile?.display_name || profile?.username || "?";
            return String(name).charAt(0).toUpperCase();
        }
    };
})();
