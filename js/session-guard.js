/**
 * Runs before Supabase loads. Removes expired/broken sessions and blocks
 * refresh_token requests that cause 500 loops after email changes.
 */
(function () {
    const url = window.VIVED_CONFIG?.supabase?.url;
    if (!url) return;

    let ref;
    try {
        ref = new URL(url).hostname.split(".")[0];
    } catch {
        return;
    }

    function purgeAuthKeys() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("sb-" + ref + "-") && key.includes("auth")) {
                keys.push(key);
            }
        }
        keys.forEach(key => localStorage.removeItem(key));
    }

    function purgeExpiredAuthKeys() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith("sb-" + ref + "-") || !key.includes("auth")) continue;
            keys.push(key);
        }

        keys.forEach(key => {
            const raw = localStorage.getItem(key);
            if (!raw) return;

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
        });
    }

    purgeExpiredAuthKeys();

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (resource, options) {
        const urlStr = typeof resource === "string"
            ? resource
            : (resource && typeof resource.url === "string" ? resource.url : "");

        const body = typeof options?.body === "string" ? options.body : "";
        const isRefreshToken = urlStr.includes("/auth/v1/token")
            && (urlStr.includes("grant_type=refresh_token") || body.includes("refresh_token"));

        if (isRefreshToken) {
            purgeAuthKeys();
            return Promise.resolve(new Response(JSON.stringify({
                error: "invalid_grant",
                error_description: "Session expired. Sign in again."
            }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            }));
        }

        return nativeFetch(resource, options);
    };
})();
