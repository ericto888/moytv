const BASES = ["https://tv.shunvwang7.cc", "https://ap.shunvwang8.cc", "https://web.shunvwang9.cc"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    ["244", "163资源"],
    ["386", "黄瓜资源"],
    ["358", "熟女资源"],
    ["329", "裤子资源"],
    ["119", "不卡资源"],
    ["286", "兔儿资源"],
    ["370", "森林资源"],
];

function str(v) { return v == null ? "" : String(v).trim(); }
function intValue(v, f) { const n = parseInt(v, 10); return isFinite(n) ? n : f; }

function unescapeHtml(s) {
    if (!s) return "";
    return String(s)
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)));
}
function unescapeUrl(s) { return unescapeHtml(s || "").replace(/\\\//g, "/"); }
function cleanText(t) {
    if (!t) return "";
    return unescapeHtml(String(t).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function fixUrl(raw) {
    const u = str(raw);
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASES[0] + u;
    return u;
}
function headers(ref) {
    return {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9", "Referer": ref || (BASES[0] + "/")};
}

const pageCache = {};
async function fetchOnce(url) {
    const resp = await host.http.get(url, {headers: headers(), timeout: TIMEOUT});
    if (resp.status !== 200 || !resp.body) throw new Error("HTTP " + resp.status);
    return resp.body;
}
async function httpGet(path) {
    if (pageCache[path]) return pageCache[path];
    let lastErr = null;
    for (const base of BASES) {
        for (let i = 0; i < 2; i++) {
            try {
                const body = await fetchOnce(base + path);
                if (body) { pageCache[path] = body; return body; }
            } catch (e) { lastErr = e; }
        }
    }
    return "";
}
async function httpGetSoft(path) { try { return await httpGet(path); } catch (e) { return ""; } }

function parseCards(html) {
    const out = [];
    const seen = {};
    const pat = /<a class="vod-item" href="\/a\/index\.php\/vod\/detail\/id\/(\d+)\.html"[\s\S]*?<div class="vod-name">([\s\S]*?)<\/div>/g;
    let m;
    while ((m = pat.exec(html || "")) !== null) {
        const vid = m[1];
        if (seen[vid]) continue;
        seen[vid] = true;
        const title = unescapeHtml(str(m[2]));
        if (!title) continue;
        const seg = m[0];
        const cm = /data-original="([^"]+)"/.exec(seg);
        const cover = cm ? fixUrl(cm[1]) : "";
        const rm = /<span class="vod-remarks">([^<]*)<\/span>/.exec(seg);
        out.push({id: vid, title: title, cover: cover, remarks: rm ? rm[1].trim() : ""});
    }
    return out;
}
function liveCats(html) {
    const m = /<div class="nav-subs" style="width: 100%[^>]*>([\s\S]*?)<\/div>/.exec(html || "");
    if (!m) return [];
    const out = [];
    const seen = {};
    const pat = /<a href="\/a\/index\.php\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)<\/a>/g;
    let cm;
    while ((cm = pat.exec(m[1])) !== null) {
        const cid = cm[1], name = str(cm[2]);
        if (!name || seen[cid]) continue;
        seen[cid] = true;
        out.push([cid, name]);
    }
    return out;
}
function pageTotal(html) {
    let mx = null;
    const pat = /id="num-page-(\d+)"/g;
    let m;
    while ((m = pat.exec(html || "")) !== null) {
        const n = parseInt(m[1], 10);
        if (isFinite(n) && (mx === null || n > mx)) mx = n;
    }
    return mx;
}

let catsCache = null;
async function fetchCats() {
    if (catsCache) return catsCache;
    const html = await httpGetSoft("/a/");
    const live = html ? liveCats(html) : [];
    catsCache = live.length ? live : CATS.slice();
    return catsCache;
}

async function home() {
    const cats = await fetchCats();
    let items = [];
    try {
        const r = await category({id: cats[0][0], page: 1});
        items = r.items || [];
    } catch (e) { items = []; }
    return {categories: cats.map(c => ({id: c[0], name: c[1]})), items: items, hasMore: false};
}

async function category(arg) {
    const tid = str(arg && arg.id) || CATS[0][0];
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const path = pg <= 1 ? "/a/index.php/vod/type/id/" + tid + ".html" : "/a/index.php/vod/type/id/" + tid + "/page/" + pg + ".html";
    const html = await httpGetSoft(path);
    const items = parseCards(html);
    const total = pageTotal(html);
    const hasMore = !!(items.length && total && pg < total);
    return {items: items, hasMore: hasMore};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const html = await httpGetSoft("/a/index.php/vod/search/wd/" + encodeURIComponent(keyword) + ".html");
    return {items: parseCards(html), hasMore: false};
}

async function detail(arg) {
    let vid = str(arg && arg.id);
    if (Array.isArray(arg && arg.id)) vid = str(arg.id[0]);
    vid = vid.replace(/^\//, "");
    if (!vid) return {id: vid, title: "", cover: "", desc: "", tags: [], lines: []};
    const html = await httpGetSoft("/a/index.php/vod/detail/id/" + vid + ".html");
    if (!html) return {id: vid, title: "", cover: "", desc: "", tags: [], lines: []};
    let title = "";
    const hm = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    if (hm) title = unescapeHtml(str(hm[1]));
    let cover = "";
    const cm = /detail-cover-wrapper"[\s\S]*?<img[^>]+src="([^"]+)"/.exec(html);
    if (cm) cover = fixUrl(cm[1]);
    let synopsis = "";
    const dm = /<meta name="description"[^>]*content="([^"]+)"/.exec(html);
    if (dm) synopsis = unescapeHtml(str(dm[1]));
    const eps = [];
    const seen = {};
    const epat = /<a[^>]*href="(\/a\/index\.php\/vod\/play\/id\/\d+\/sid\/\d+\/nid\/\d+\.html)"[^>]*>([^<]*)<\/a>/g;
    let em;
    while ((em = epat.exec(html)) !== null) {
        const href = em[1];
        const name = str(em[2]);
        if (!name || name.indexOf("立即") >= 0) continue;
        if (seen[href]) continue;
        seen[href] = true;
        eps.push({id: fixUrl(href), name: name});
    }
    if (!title || !eps.length) return {id: vid, title: title, cover: cover, desc: synopsis, tags: [], lines: []};
    return {id: vid, title: title, cover: cover, desc: synopsis, tags: [], lines: [{name: "在线播放", episodes: eps}]};
}

async function resolveMaster(url, hdrs) {
    try {
        const resp = await host.http.get(url, {headers: hdrs, timeout: TIMEOUT});
        if (!resp || resp.status < 200 || resp.status >= 300 || !resp.body) return url;
        const text = resp.body;
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
        if (!lines.length) return url;
        return host.url.resolve(url, lines[0]);
    } catch (e) { return url; }
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("$") >= 0) raw = raw.split("$").slice(1).join("$");
    let url = raw.startsWith("http") ? raw : fixUrl(raw);
    if (url.indexOf("/vod/play/") < 0) {
        if (url.startsWith("http") && /\.m3u8($|\?)/i.test(url)) {
            const hdrs = {"User-Agent": UA, "Referer": BASES[0] + "/"};
            const finalUrl = await resolveMaster(url, hdrs);
            return {streams: [{url: finalUrl, format: "hls", headers: hdrs, name: "shunvwang"}], expiresAt: Date.now() + 3600 * 1000};
        }
        throw new Error("no playable url");
    }
    const pos = url.indexOf("/a/index.php");
    const path = pos >= 0 ? url.slice(pos) : url;
    const html = await httpGetSoft(path);
    let m3u8 = "";
    if (html) {
        const m = /player_aaaa=[\s\S]*?"url":"([^"]+)"/.exec(html);
        if (m) m3u8 = unescapeUrl(m[1]);
    }
    if (!m3u8) throw new Error("play url not found");
    const hdrs = {"User-Agent": UA, "Referer": url};
    const finalUrl = await resolveMaster(m3u8, hdrs);
    return {streams: [{url: finalUrl, format: "hls", headers: hdrs, name: "shunvwang"}], expiresAt: Date.now() + 3600 * 1000};
}

export default {home: home, category: category, search: search, detail: detail, play: play};
