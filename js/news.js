function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const SECTION_LINE = /^\s*SEC\s*\(\s*([^)]+?)\s*\)\s*--\s*(.+?)\s*$/i;
const ARTICLE_END = /^\s*End\s*$/i;

function parseSectionValue(raw) {
    let value = raw.trim();
    if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }
    return value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
}

function normalizeSectionType(type) {
    return type.replace(/\s+/g, "").toLowerCase();
}

function renderSectionElement(type, content) {
    const normalized = normalizeSectionType(type);

    if (normalized === "header") {
        return `<h2 class="news-article-title">${escapeHtml(content)}</h2>`;
    }
    if (normalized.startsWith("subheader")) {
        return `<h3 class="news-subheader">${escapeHtml(content)}</h3>`;
    }
    if (normalized.startsWith("mainbody")) {
        return `<div class="news-body">${escapeHtml(content).replace(/\n/g, "<br>")}</div>`;
    }
    if (normalized.startsWith("footer")) {
        return `<p class="news-footer">${escapeHtml(content)}</p>`;
    }

    return `<div class="news-section news-section--${escapeHtml(normalized)}">${escapeHtml(content)}</div>`;
}

function parseNewsArticles(text) {
    const articles = [];
    let current = [];

    for (const line of text.split(/\r?\n/)) {
        if (ARTICLE_END.test(line)) {
            if (current.length) {
                articles.push(current);
                current = [];
            }
            continue;
        }

        const match = line.match(SECTION_LINE);
        if (match) {
            current.push({
                type: match[1].trim(),
                content: parseSectionValue(match[2])
            });
        }
    }

    if (current.length) {
        articles.push(current);
    }

    return articles;
}

function renderNewsArticle(sections) {
    const html = sections.map(section => renderSectionElement(section.type, section.content)).join("");
    return `<article class="news-article">${html}</article>`;
}

function getNewsConfig() {
    return window.VIVED_CONFIG?.news || {};
}

async function fetchText(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Fetch failed");
    return response.text();
}

function parseFileList(text) {
    return text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#"));
}

async function loadNewsFile(filename, baseUrl) {
    const url = baseUrl + encodeURIComponent(filename);
    const text = await fetchText(url);
    const trimmed = text.trim();

    if (!trimmed || trimmed.toLowerCase() === "hush") {
        return [];
    }

    return parseNewsArticles(text);
}

async function loadNewsFeed() {
    const root = document.getElementById("newsFeed");
    if (!root) return;

    const config = getNewsConfig();
    const listUrl = config.listUrl;
    const fallbackUrl = config.fallbackUrl;
    const baseUrl = config.baseUrl;

    root.innerHTML = `<p class="news-loading">Loading news…</p>`;

    try {
        let allArticles = [];
        let usedFileList = false;

        if (listUrl) {
            try {
                const listText = await fetchText(listUrl);
                const files = parseFileList(listText);

                if (files.length) {
                    usedFileList = true;
                    const results = await Promise.allSettled(
                        files.map(filename => loadNewsFile(filename, baseUrl))
                    );

                    for (const result of results) {
                        if (result.status === "fulfilled" && result.value.length) {
                            allArticles = allArticles.concat(result.value);
                        }
                    }
                }
            } catch {
                // fall through to fallback
            }
        }

        if (!usedFileList && fallbackUrl) {
            const text = await fetchText(fallbackUrl);
            const trimmed = text.trim();

            if (!trimmed || trimmed.toLowerCase() === "hush") {
                root.innerHTML = `<p class="news-empty">No news posts yet. Check back soon.</p>`;
                return;
            }

            allArticles = parseNewsArticles(text);
        }

        if (!allArticles.length) {
            root.innerHTML = `<p class="news-empty">No news posts yet. Check back soon.</p>`;
            return;
        }

        root.innerHTML = allArticles.map(renderNewsArticle).join("");
    } catch {
        root.innerHTML = `<p class="news-error">Could not load news. Make sure your news files are public on GitHub.</p>`;
    }
}

if (document.getElementById("newsFeed")) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", loadNewsFeed);
    } else {
        loadNewsFeed();
    }
}
