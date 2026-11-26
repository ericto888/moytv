// 古装AI — idj1 plugin (ported 1:1 from the builtin py spider guzhuang)
// Site: https://5g.guzhuangai8.cc/rukou (MacCMS-style gzai template).
// Categories are parsed from the homepage nav exactly like the py
// (_parse_categories over BASE + "/"), falling back to the py's built-in
// CATS list (9 categories: 斯卡资源/51资源/黄瓜资源/番茄资源/兔兔资源/
// 森林资源/库库资源/制服诱惑/AI短剧). Category/search pages are HTML list
// pages parsed with the py's CARD_RE (widened only to tolerate the
// newline/attribute layout the category template actually serves, which
// the strict py regex misses there). Detail keeps the py's single line
// 在线播放 with episodes 第N集 sorted by nid; an episode id is the py form
// "guzhuang:<absolute play page url>". Play fetches the play page and
// extracts player_aaaa "url" exactly like the py, then pre-resolves a
// master playlist (#EXT-X-STREAM-INF) to its first variant sub-playlist.
// The site is slow (tens of seconds per page) and only serves the player
// block to the full browser UA with a Referer, so every fetch sends the
// py's exact UA/Referer pair. Timeout widened to 60s, 3 attempts per
// fetch, exactly the py's retry count.

const BASE = "https://5g.guzhuangai8.cc/rukou";
const HOST = "https://5g.guzhuangai8.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATS = [
    ["119", "斯卡资源"],
    ["244", "51资源"],
    ["386", "黄瓜资源"],
    ["358", "番茄资源"],
    ["286", "兔兔资源"],
    ["370", "森林资源"],
    ["329", "库库资源"],
    ["127", "制服诱惑"],
    ["390", "AI短剧"],
];

const CARD_RE = /<a[^>]*href="[^"]*\/vod\/detail\/id\/(\d+)\.html"[^>]*class="group-item[^"]*"[^>]*>\s*<img[^>]*data-original="([^"]+)"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
const CAT_RE = /href="[^"]*\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)<\/a>/g;
const TITLE_RE = /<p class="group-title">(.*?)<\/p>/;
const COVER_RE = /data-original="(https?:\/\/[^"]+)"/;
const DESC_RE = /<meta name="description"[^>]*content="([^"]*)"/;
const EP_RE = /href="([^"]*\/vod\/play\/id\/\d+\/sid\/1\/nid\/(\d+)\.html)"/g;
const PLAYER_RE = /player_aaaa=[\s\S]*?"url":"([^"]+)"/;

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function normPg(pg) {
    const n = parseInt(pg, 10);
    return isFinite(n) && n >= 1 ? n : 1;
}

function unescapeHtml(s) {
    return String(s || "")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
}

// py _unescape: html.unescape + "\/" -> "/" + strip.
function pyUnescape(s) {
    if (!s) return "";
    return unescapeHtml(String(s).replace(/<[^>]+>/g, "")).replace(/\\\//g, "/").trim();
}

function headers(referer) {
    const h = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) h["Referer"] = referer;
    return h;
}

// py _http_get: up to 3 attempts, returns "" when every attempt fails.
async function getText(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(referer), timeout: TIMEOUT});
            const body = resp.body || "";
            if (resp.status === 200 && body) return body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) host.log("guzhuang getText failed", url, String(lastError && lastError.message));
    return "";
}

// py _fix_url
function fixUrl(raw) {
    const u = str(raw);
    if (!u) return "";
    if (u.indexOf("http") === 0) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return HOST + u;
    return u;
}

// py _parse_cards (dedupe by vod_id, drop empty titles)
function parseCards(html) {
    const out = [];
    const seen = new Set();
    const text = html || "";
    CARD_RE.lastIndex = 0;
    let m;
    while ((m = CARD_RE.exec(text)) !== null) {
        const vid = str(m[1]);
        if (!vid || seen.has(vid)) continue;
        const title = pyUnescape(m[3]);
        if (!title) continue;
        seen.add(vid);
        out.push({id: vid, title: title, cover: str(m[2]), remarks: "", tags: []});
    }
    return out;
}

// py _parse_categories
function parseCategories(html) {
    const out = [];
    const seen = new Set();
    const text = html || "";
    CAT_RE.lastIndex = 0;
    let m;
    while ((m = CAT_RE.exec(text)) !== null) {
        const cid = m[1];
        const name = str(m[2]);
        if (!name || seen.has(cid)) continue;
        seen.add(cid);
        out.push([cid, name]);
    }
    return out;
}

// py _cats: parse the homepage nav, fall back to the built-in CATS.
async function fetchCats() {
    const cats = parseCategories(await getText(BASE + "/", BASE + "/"));
    return cats.length ? cats : CATS.slice();
}

// py _catalog
async function catalog(tid, pg) {
    const url = pg <= 1
        ? BASE + "/index.php/vod/type/id/" + tid + ".html"
        : BASE + "/index.php/vod/type/id/" + tid + "/page/" + pg + ".html";
    return parseCards(await getText(url, BASE + "/"));
}

// ---------- master playlist pre-resolve ----------

async function resolveMaster(url, streamHeaders) {
    try {
        const resp = await host.http.get(url, {headers: streamHeaders, timeout: TIMEOUT});
        if (resp.status !== 200 && resp.status !== 206) return url;
        const text = resp.body || "";
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/).map(s => s.trim());
        for (const line of lines) {
            if (line && line.charAt(0) !== "#") return host.url.resolve(url, line);
        }
        return url;
    } catch (error) {
        host.log("guzhuang resolveMaster failed", url, String(error && error.message));
        return url;
    }
}

// ---------- idj1 contract ----------

async function home() {
    const cats = await fetchCats();
    let items = [];
    if (cats.length) items = await catalog(cats[0][0], 1);
    return {
        categories: cats.map(pair => ({id: pair[0], name: pair[1]})),
        items: items,
        hasMore: false,
    };
}

async function category(arg) {
    const pg = normPg(arg && arg.page);
    const tid = str(arg && arg.id);
    if (!tid) throw host.error("E_PARSE", "missing category id");
    const items = await catalog(tid, pg);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    const url = BASE + "/index.php/vod/search/wd/" + encodeURIComponent(keyword) + ".html";
    const items = parseCards(await getText(url, BASE + "/"));
    return {items: items, hasMore: false};
}

async function detail(arg) {
    let nid = str(arg && arg.id).replace(/^\/+/, "");
    const marker = "/vod/detail/id/";
    const p = nid.indexOf(marker);
    if (p >= 0) nid = nid.slice(p + marker.length);
    nid = nid.replace(/^\/+/, "");
    if (nid.slice(-5) === ".html") nid = nid.slice(0, -5);
    if (!nid) throw host.error("E_PARSE", "missing id");
    const html = await getText(BASE + "/index.php/vod/detail/id/" + nid + ".html", BASE + "/");
    if (!html) throw host.error("E_NETWORK", "detail page fetch failed");
    const tm = TITLE_RE.exec(html);
    const title = tm ? pyUnescape(tm[1]) : "";
    const cm = COVER_RE.exec(html);
    const cover = cm ? cm[1] : "";
    const dm = DESC_RE.exec(html);
    let synopsis = dm ? pyUnescape(dm[1]) : "";
    if (synopsis.slice(-5) === "-古装AI") synopsis = synopsis.slice(0, synopsis.length - 5);
    const seen = new Set();
    const pairs = [];
    EP_RE.lastIndex = 0;
    let m;
    while ((m = EP_RE.exec(html)) !== null) {
        const n = m[2];
        if (seen.has(n)) continue;
        seen.add(n);
        const num = parseInt(n, 10);
        if (isFinite(num)) pairs.push([num, m[1]]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const episodes = pairs.map(pair => ({
        id: "guzhuang:" + fixUrl(pair[1]),
        name: "第" + pair[0] + "集",
    }));
    if (!title || !episodes.length) throw host.error("E_PARSE", "detail has no title or episodes");
    const out = {
        id: nid,
        title: title,
        desc: synopsis,
        tags: [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
    if (cover) out.cover = cover;
    return out;
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("guzhuang:") === 0) raw = raw.slice("guzhuang:".length);
    let m3u8 = "";
    if (raw.indexOf("/vod/play/") >= 0) {
        const html = await getText(raw, BASE + "/");
        if (html) {
            const m = PLAYER_RE.exec(html);
            if (m) m3u8 = pyUnescape(m[1]);
        }
    } else if (raw.indexOf("http") === 0) {
        m3u8 = raw;
    }
    if (!m3u8) throw host.error("E_PARSE", "no stream url");
    if (m3u8.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https");
    const streamHeaders = {"User-Agent": UA, "Referer": BASE + "/"};
    const isHls = /\.m3u8($|\?)/i.test(m3u8);
    let finalUrl = m3u8;
    if (isHls) finalUrl = await resolveMaster(m3u8, streamHeaders);
    return {
        streams: [{
            url: finalUrl,
            format: isHls ? "hls" : "video",
            headers: streamHeaders,
            name: "古装AI",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
