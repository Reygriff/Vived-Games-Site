window.VivedRanks = (function () {
    const LABELS = {
        verified: "Verified",
        player: "Player",
        studio_dev: "Verified Studio Game Developer",
        admin: "Admin"
    };

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function normalizeRank(rank) {
        const key = String(rank || "").trim().toLowerCase();
        if (key === "verified_studio" || key === "verified_studio_game_developer" || key === "studio") {
            return "studio_dev";
        }
        if (LABELS[key]) return key;
        return "";
    }

    function rankImageUrl(file) {
        const path = String(window.location.pathname || "").replace(/\\/g, "/").toLowerCase();
        const prefix = path.includes("/vault/") ? "../" : "";
        return `${prefix}assets/images/${file}`;
    }

    function star(cx, cy, r, fill) {
        const points = [];
        for (let i = 0; i < 5; i++) {
            const outer = (Math.PI / 2) + i * (Math.PI * 2 / 5);
            const inner = outer + Math.PI / 5;
            points.push(`${cx + Math.cos(outer) * r},${cy - Math.sin(outer) * r}`);
            points.push(`${cx + Math.cos(inner) * (r * 0.42)},${cy - Math.sin(inner) * (r * 0.42)}`);
        }
        return `<polygon points="${points.join(" ")}" fill="${fill}"/>`;
    }

    function iconSvg(rank) {
        if (rank === "verified") {
            return `<svg class="rank-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5" fill="#2563eb"/>${star(12, 12, 8, "#111")}</svg>`;
        }
        if (rank === "player") {
            return `<svg class="rank-icon rank-icon--player" viewBox="0 0 56 24" aria-hidden="true"><rect width="56" height="24" rx="5" fill="#facc15"/><text x="28" y="15.5" text-anchor="middle" font-size="7" font-weight="800" font-family="Arial, sans-serif" fill="#111">PlayerWithFlames</text></svg>`;
        }
        if (rank === "studio_dev") {
            return `<svg class="rank-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5" fill="#dc2626"/>${star(8, 12, 6.2, "#3b82f6")}${star(16.4, 12, 6.2, "#3b82f6")}</svg>`;
        }
        if (rank === "admin") {
            return `<img class="rank-icon rank-icon--admin" src="${escapeHtml(rankImageUrl("rank-admin.jpg"))}" alt="">`;
        }
        return "";
    }

    function badgeHtml(rank, size) {
        const key = normalizeRank(rank);
        if (!key) return "";
        const sizeClass = size ? ` rank-badge--${size}` : "";
        return `<span class="rank-badge${sizeClass} rank-badge--${key}" title="${escapeHtml(LABELS[key])}">${iconSvg(key)}</span>`;
    }

    function wrapAvatar(innerHtml, rank, size) {
        const badge = badgeHtml(rank, size);
        if (!badge) return innerHtml;
        return `<span class="pfp-with-rank">${badge}${innerHtml}</span>`;
    }

    function mountBadge(wrapEl, rank, size) {
        if (!wrapEl) return;
        wrapEl.querySelectorAll(":scope > .rank-badge").forEach(node => node.remove());
        const html = badgeHtml(rank, size);
        if (html) wrapEl.insertAdjacentHTML("afterbegin", html);
    }

    function mountPageIcons() {
        document.querySelectorAll("[data-rank-icon]").forEach(el => {
            if (el.querySelector(".rank-badge")) return;
            const html = badgeHtml(el.getAttribute("data-rank-icon"), el.getAttribute("data-rank-size") || "tag");
            if (html) el.insertAdjacentHTML("afterbegin", html);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mountPageIcons);
    } else {
        mountPageIcons();
    }

    return {
        normalizeRank,
        label: rank => LABELS[normalizeRank(rank)] || "",
        badgeHtml,
        wrapAvatar,
        mountBadge
    };
})();
