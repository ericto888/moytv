// huangguazy - idj1 plugin (rewritten from the built-in py spider huangguazy)
// Site: https://wap.huangguazy7.cc (mirror https://gua.huangguazy8.cc)
// HTML MacCMS-style pages under /a/; play page carries player_aaaa with an
// m3u8 url; master playlists are pre-resolved to the sub-playlist in play().

const BASES = ["https://wap.huangguazy7.cc", "https://gua.huangguazy8.cc"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    ["386", "黄瓜资源"],
    ["358", "番号资源"],
    ["119", "不卡资源"],
    ["286", "玉兔资源"],
    ["329", "裤子资源"],
    ["370", "森林资源"],
    ["244", "163资源"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function unescapeHtml(s) {
    let t = String(s == null ? "" : s);
    t = t.replace(/&#(\d+);/g, (m, d) => String.fromCharCode(parseInt(d, 10)));
    t = t.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    t = t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");
    t = t.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    t = t.replace(/&nbsp;/g, " ");
    t = t.replace(/&amp;/g, "&");
    return t;
}

function unescapeUrl(s) {
    return unescapeHtml(s || "").replace(/\\\//g, "/");
}

function fixUrl(raw) {
    const u = str(raw);
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASES[0] + u;
    return u;
}

function pageHeaders() {
    return {"User-Agent": UA};
}

function playHeaders() {
    return {"User-Agent": UA, "Referer": BASES[0] + "/"};
}

// Mirrors the py _get: try each base twice, return body even on HTTP errors,
// return "" when every attempt fails at transport level.
async function getPath(path) {
    for (const base of BASES) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const resp = await host.http.get(base + path, {headers: pageHeaders(), timeout: TIMEOUT});
                if (resp && typeof resp.body === "string" && resp.body) return resp.body;
                if (resp && resp.status >= 400) return resp.body || "";
            } catch (error) {
                // fall through to next attempt / base
            }
        }
    }
    return "";
}

async function getUrl(url, headers) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers || playHeaders(), timeout: TIMEOUT});
            if (resp && resp.status >= 200 && resp.status < 300) return resp;
            if (resp && resp.body) return resp;
            throw new Error("HTTP " + (resp ? resp.status : "?"));
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("request failed");
}

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    const cardRe = /<a class="vod-card-item" href="\/a\/index\.php\/vod\/detail\/id\/(\d+)\.html"[\s\S]*?<div class="vod-card-name">([\s\S]*?)<\/div>[\s\S]*?<span class="vod-card-remarks">([^<]*)<\/span>/g;
    let m;
    while ((m = cardRe.exec(html)) !== null) {
        const vid = str(m[1]);
        if (!vid || seen[vid]) continue;
        seen[vid] = true;
        const title = unescapeHtml(str(m[2]));
        if (!title) continue;
        let cover = "";
        const cm = /data-original="([^"]+)"/.exec(m[0]);
        if (cm) cover = fixUrl(cm[1]);
        out.push({id: vid, title: title, cover: cover, remarks: str(m[3]), tags: []});
    }
    return out;
}

function parseCategories(html) {
    const cats = [];
    const seen = {};
    if (html) {
        const re = /<a href="\/a\/index\.php\/vod\/type\/id\/(\d+)\.html" class="cat-icon-item"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const cid = str(m[1]);
            const name = str(m[2]);
            if (!name || seen[cid]) continue;
            seen[cid] = true;
            cats.push([cid, name]);
        }
    }
    return cats.length ? cats : CATS.slice();
}

async function home() {
    const html = await getPath("/a/");
    const cats = parseCategories(html);
    let items = [];
    if (cats.length) {
        const firstHtml = await getPath("/a/index.php/vod/type/id/" + cats[0][0] + ".html");
        items = parseCards(firstHtml);
    }
    return {
        categories: cats.map((c) => ({id: c[0], name: c[1]})),
        items: items,
        hasMore: items.length > 0,
    };
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "386";
    const path = page <= 1
        ? "/a/index.php/vod/type/id/" + tid + ".html"
        : "/a/index.php/vod/type/id/" + tid + "/page/" + page + ".html";
    const html = await getPath(path);
    const items = parseCards(html);
    const hasMore = items.length > 0 &&
        html.indexOf("/a/index.php/vod/type/id/" + tid + "/page/" + (page + 1) + ".html") >= 0;
    return {items: items, hasMore: hasMore};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const html = await getPath("/a/index.php/vod/search/wd/" + encodeURIComponent(keyword) + ".html");
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const nid = raw.replace(/^\//, "");
    const empty = {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    if (!nid) return empty;
    const html = await getPath("/a/index.php/vod/detail/id/" + nid + ".html");
    if (!html) return empty;
    let title = "";
    let m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    if (m) {
        title = unescapeHtml(str(m[1]));
        const p = title.indexOf("<");
        if (p >= 0) title = str(title.slice(0, p));
    }
    let cover = "";
    m = /<img class="main-img" src="([^"]+)"/.exec(html);
    if (m) cover = fixUrl(m[1]);
    if (!cover) {
        m = /data-original="([^"]+)"/.exec(html);
        if (m) cover = fixUrl(m[1]);
    }
    let synopsis = "";
    m = /<meta name="description"[^>]*content="([^"]+)"/.exec(html);
    if (m) synopsis = unescapeHtml(str(m[1]));
    const eps = [];
    const seen = {};
    const epRe = /<a[^>]*href="(\/a\/index\.php\/vod\/play\/id\/\d+\/sid\/\d+\/nid\/\d+\.html)"[^>]*>([^<]+)<\/a>/g;
    while ((m = epRe.exec(html)) !== null) {
        const href = str(m[1]);
        const name = str(m[2]);
        if (name === "▶ 立即播放" || seen[href]) continue;
        seen[href] = true;
        eps.push({id: fixUrl(href), name: name});
    }
    if (!title || !eps.length) return empty;
    return {
        id: raw,
        title: title,
        cover: cover,
        desc: synopsis,
        tags: [],
        lines: [{name: "在线播放", episodes: eps}],
    };
}

function parsePlayerUrl(html) {
    const m = /player_aaaa=[\s\S]*?"url":"([^"]+)"/.exec(html || "");
    if (!m) return "";
    return unescapeUrl(m[1]);
}

// If the m3u8 is a master playlist, resolve it to its first sub-playlist.
async function resolveStreamUrl(m3u8) {
    try {
        const resp = await getUrl(m3u8, playHeaders());
        const text = resp && typeof resp.body === "string" ? resp.body : "";
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return m3u8;
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                for (let j = i + 1; j < lines.length; j++) {
                    if (!lines[j].startsWith("#")) {
                        return host.url.resolve(m3u8, lines[j]);
                    }
                }
            }
        }
    } catch (error) {
        // keep the master url; the player can still follow it
    }
    return m3u8;
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    const headers = playHeaders();
    let url = raw.startsWith("http") ? raw : fixUrl(raw);
    if (url.indexOf("/vod/play/") < 0) {
        if (url.startsWith("http") && /\.m3u8($|\?)/i.test(url)) {
            const resolved = await resolveStreamUrl(url);
            return {streams: [{url: resolved, format: "hls", headers: headers, name: "黄瓜资源"}], expiresAt: Date.now() + 3600 * 1000};
        }
        throw new Error("no playable url");
    }
    const p = url.indexOf("/a/index.php");
    const path = p >= 0 ? url.slice(p) : url;
    const html = await getPath(path);
    const m3u8 = parsePlayerUrl(html);
    if (!m3u8) throw new Error("no m3u8 in play page");
    const resolved = await resolveStreamUrl(m3u8);
    return {
        streams: [{url: resolved, format: "hls", headers: headers, name: "黄瓜资源"}],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
