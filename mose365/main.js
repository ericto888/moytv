// mose365 - idj1 plugin (rewritten from the built-in py spider mose365)
// Site: https://exwxfmd4.work ; data via its JSON API (/api/public).
// detail source_url uses custom schemes (missav-stream://code etc.) which
// resolve to API proxy URLs: API + "/" + scheme + "/" + rest.

const BASE = "https://exwxfmd4.work";
const API = "https://exwxfmd4.work/api/public";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const FALLBACK_CATS = [
    ["missav", "MissAV"],
    ["xvideos", "XVideos"],
    ["xnxx", "XNXX"],
    ["eporner", "Eporner"],
];

function str(value) {
    if (value == null) return "";
    if (typeof value === "boolean") return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function headers() {
    return {"User-Agent": UA, "Accept": "application/json, */*", "Referer": BASE + "/"};
}

function playHeaders() {
    return {"User-Agent": UA, "Referer": BASE + "/"};
}

async function getText(url, extraHeaders) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: extraHeaders || headers(), timeout: TIMEOUT});
            if (resp.status >= 200 && resp.status < 300 && resp.body) {
                return resp;
            }
            lastError = new Error("HTTP " + resp.status);
            if (resp.status === 404) break;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("request failed");
}

async function getJsonSoft(url) {
    try {
        const resp = await getText(url);
        return JSON.parse(resp.body);
    } catch (error) {
        return null;
    }
}

function fixCover(raw) {
    const u = str(raw);
    if (!u) return "";
    if (u.startsWith("http")) return u;
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASE + u;
    return BASE + "/" + u;
}

function resolveStream(sourceUrl) {
    const u = str(sourceUrl);
    if (!u) return "";
    if (u.startsWith("http")) return u;
    const p = u.indexOf("://");
    if (p > 0) {
        const scheme = u.slice(0, p);
        const rest = u.slice(p + 3);
        if (scheme && rest) return API + "/" + scheme + "/" + rest;
    }
    return "";
}

let catsCache = null;

async function fetchCategories() {
    if (catsCache) return catsCache;
    const root = await getJsonSoft(API + "/home");
    const out = [];
    const data = root && typeof root.data === "object" ? root.data : null;
    if (data && Array.isArray(data.sections)) {
        for (const s of data.sections) {
            if (!s || typeof s !== "object") continue;
            const slug = str(s.slug);
            const name = str(s.name);
            if (slug && name) out.push([slug, name]);
        }
    }
    catsCache = out.length ? out : FALLBACK_CATS.slice();
    return catsCache;
}

function parseCards(data) {
    const out = [];
    if (!data || typeof data !== "object" || !Array.isArray(data.videos)) return out;
    for (const v of data.videos) {
        if (!v || typeof v !== "object") continue;
        const vid = str(v.id);
        const title = str(v.title);
        if (!vid || !title) continue;
        out.push({
            id: vid,
            title: title,
            cover: fixCover(v.cover),
            remarks: str(v.source_name),
            tags: [],
        });
    }
    return out;
}

async function catalog(tid, pg) {
    const url = API + "/category/" + encodeURIComponent(tid) + "?page=" + pg + "&pageSize=24";
    const root = await getJsonSoft(url);
    const data = root && typeof root.data === "object" ? root.data : null;
    if (!data) return {items: [], total: 0};
    return {items: parseCards(data), total: intValue(data.total, 0)};
}

async function home() {
    const cats = await fetchCategories();
    const categories = cats.map((c) => ({id: c[0], name: c[1]}));
    let items = [];
    if (cats.length) {
        const r = await catalog(cats[0][0], 1);
        items = r.items;
    }
    return {categories: categories, items: items, hasMore: items.length >= 24};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    if (!tid) return {items: [], hasMore: false};
    const r = await catalog(tid, page);
    return {items: r.items, hasMore: r.items.length >= 24};
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = API + "/search?q=" + encodeURIComponent(keyword) + "&page=1";
    const root = await getJsonSoft(url);
    const data = root && typeof root.data === "object" ? root.data : null;
    const items = data ? parseCards(data) : [];
    return {items: items, hasMore: false, page: page};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    if (!raw) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const vid = raw.replace(/^\//, "").replace(/^video\//, "").replace(/\/$/, "");
    const root = await getJsonSoft(API + "/video/" + encodeURIComponent(vid));
    const data = root && typeof root.data === "object" ? root.data : null;
    const video = data && typeof data.video === "object" ? data.video : null;
    if (!video) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const title = str(video.title);
    const cover = fixCover(video.cover);
    const stream = resolveStream(video.source_url);
    if (!title || !stream) return {id: raw, title: title || raw, cover: cover, desc: "", tags: [], lines: []};
    const parts = [];
    const synopsis = str(video.description) || title;
    if (synopsis) parts.push(synopsis);
    const dur = intValue(video.duration, 0);
    if (dur) parts.push("Duration: " + dur + "s");
    const views = intValue(video.view_count, 0);
    if (views) parts.push("Views: " + views);
    const src = str(video.source_name);
    if (src) parts.push("Source: " + src);
    const tagText = str(video.tags);
    return {
        id: raw,
        title: title,
        cover: cover,
        desc: parts.join("\n"),
        duration: dur ? String(dur) : "",
        tags: tagText ? tagText.split(",").map((t) => t.trim()).filter(Boolean) : [],
        lines: [{
            name: "在线播放",
            episodes: [{id: stream, name: "播放"}],
        }],
    };
}

function pickVariant(text, baseUrl) {
    const lines = text.split(/\r?\n/);
    let best = null;
    let bestBw = -1;
    let pendingBw = -1;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith("#EXT-X-STREAM-INF")) {
            const m = /BANDWIDTH=(\d+)/.exec(line);
            pendingBw = m ? parseInt(m[1], 10) : 0;
            continue;
        }
        if (line.startsWith("#")) continue;
        const url = host.url.resolve(baseUrl, line);
        if (best === null || pendingBw > bestBw) {
            best = url;
            bestBw = pendingBw;
        }
        pendingBw = -1;
    }
    return best;
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (!raw || !raw.startsWith("http")) throw new Error("invalid play id");
    let playUrl = raw;
    let format = /\.m3u8($|\?)/i.test(raw) ? "hls" : "mp4";
    try {
        const resp = await host.http.get(raw, {
            headers: Object.assign(playHeaders(), {"Range": "bytes=0-2047"}),
            timeout: TIMEOUT,
        });
        const finalUrl = resp && resp.url ? resp.url : raw;
        const body = resp && resp.body ? resp.body : "";
        const ctype = resp && resp.headers ? str(resp.headers["content-type"]).toLowerCase() : "";
        if (body.indexOf("#EXTM3U") >= 0) {
            format = "hls";
            playUrl = finalUrl;
            if (body.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const child = pickVariant(body, finalUrl);
                if (child) playUrl = child;
            }
        } else if (/\.m3u8($|\?)/i.test(finalUrl)) {
            format = "hls";
            playUrl = finalUrl;
        } else if (ctype.indexOf("mpegurl") >= 0) {
            format = "hls";
            playUrl = finalUrl;
        } else if (finalUrl !== raw) {
            playUrl = finalUrl;
            format = /\.m3u8($|\?)/i.test(finalUrl) ? "hls" : "mp4";
        }
    } catch (error) {
        // Keep the unresolved URL; the player can still follow it.
    }
    return {
        streams: [{
            url: playUrl,
            format: format,
            headers: playHeaders(),
            name: "mose365",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
