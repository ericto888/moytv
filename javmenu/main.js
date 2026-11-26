// JAV目錄大全 (javmenu.com) — idj1 plugin, 1:1 port of the builtin py spider.
// Pages are server-rendered HTML. List cards come from anchors whose href
// looks like /XXX-YYY (detail pages); the detail page embeds a direct
// m3u8/mp4 link which play() extracts live (same chain as the py spider).
// The py category URL template has no page placeholder, so every page of a
// category returns the same first page; hasMore is therefore always false.

const BASE = "https://javmenu.com";
const KEY = "javmenu";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const TIMEOUT = 60000;

// 38 categories, exactly the py CATS list (duplicates included, as in py).
const CATS = [
    ["censored/online", "有碼"],
    ["uncensored", "無碼"],
    ["western", "歐美"],
    ["fc2", "FC2"],
    ["uncensored/filter", "無碼"],
    ["western/filter", "歐美"],
    ["fc2/filter", "FC2"],
    ["rank/censored/day", "日榜"],
    ["rank/censored/week", "週榜"],
    ["rank/censored/month", "月榜"],
    ["rank/censored/actress", "女優榜"],
    ["uncensored/actor", "無碼"],
    ["western/actor", "歐美"],
    ["series/censored", "有碼"],
    ["series/uncensored", "無碼"],
    ["series/western", "歐美"],
    ["games", "遊戲"],
    ["zh_TW", "繁體中文"],
    ["zh", "简体中文"],
    ["en", "English"],
    ["ja", "日本語"],
    ["ko", "한국어"],
    ["es", "español"],
    ["fr", "français"],
    ["ru", "русский"],
    ["uncensored/online", "無碼"],
    ["censored", "有碼"],
    ["censored/filter", "有碼"],
    ["censored/actor", "有碼"],
    ["code/LUXU", "LUXU"],
    ["code/ARA", "ARA"],
    ["code/SIRO", "SIRO"],
    ["western/online", "歐美"],
    ["fc2/online", "FC2"],
    ["hanime/online", "成人動畫"],
    ["chinese/online", "國產"],
    ["hanime", "成人動畫"],
    ["de", "Deutsch"],
    ["chinese", "國產"],
];

const DETAIL_HREF_RE = /\/[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+\/?(?:[?#].*)?$/;
const MEDIA_RE = /((?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?)/;
const ANCHOR_RE = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const IMG_DATA_RE = /(?:data-src|data-original)\s*=\s*"([^"]+)"/i;
const IMG_SRC_RE = /[\s"']src\s*=\s*"([^"]+)"/i;
const IMG_RE = /<img[^>]*?(?:src|data-src|data-original)="([^"]+)"/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/;
const TITLE_TAG_RE = /<title[^>]*>([\s\S]*?)<\/title>/;
const DESC_RE = /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i;
const OG_DESC_RE = /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i;
const OG_IMAGE_RE = /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i;
const TAG_STRIP_RE = /<[^>]+>/g;

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function unescapeHtml(text) {
    return str(text)
        .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&copy;/g, "©")
        .replace(/\s+/g, " ")
        .trim();
}

function txt(htmlFragment) {
    return unescapeHtml(str(htmlFragment).replace(TAG_STRIP_RE, " "));
}

function resolveUrl(rel) {
    try {
        return host.url.resolve(BASE + "/", str(rel));
    } catch (error) {
        return str(rel);
    }
}

// Same retry shape as the py _http_get: up to 3 attempts.
async function httpGet(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/json,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": referer || (BASE + "/"),
    };
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp && (resp.status === 200 || resp.status === 206) && resp.body) {
                return resp.body;
            }
            if (resp && resp.body) return resp.body;
            lastErr = new Error("HTTP " + (resp ? resp.status : "no response"));
        } catch (error) {
            lastErr = error;
        }
    }
    if (lastErr) throw lastErr;
    return "";
}

async function fetchPage(url) {
    let body = "";
    try {
        body = await httpGet(url, BASE + "/");
    } catch (error) {
        throw host.error((error && error.code) || "E_NETWORK",
            "javmenu page fetch failed: " + url + " (" + (error && error.message) + ")");
    }
    if (!body) throw host.error("E_NETWORK", "javmenu returned empty body: " + url);
    return body;
}

// Port of py _parse_cards: first pass collects covers per detail URL
// (data-src/data-original wins), second pass emits one card per URL with
// the first non-empty anchor title.
function parseCards(html) {
    const covers = {};
    const anchors = [];
    ANCHOR_RE.lastIndex = 0;
    let m;
    while ((m = ANCHOR_RE.exec(html || "")) !== null) {
        anchors.push([m[1].trim(), m[2]]);
    }
    for (const pair of anchors) {
        const href = pair[0];
        if (!DETAIL_HREF_RE.test(href)) continue;
        const url = resolveUrl(href);
        const inner = pair[1];
        const dm = IMG_DATA_RE.exec(inner);
        if (dm) {
            covers[url] = resolveUrl(dm[1].trim());
            continue;
        }
        if (!(url in covers)) {
            const sm = IMG_SRC_RE.exec(inner);
            if (sm) covers[url] = resolveUrl(sm[1].trim());
        }
    }
    const out = [];
    const seen = {};
    for (const pair of anchors) {
        const href = pair[0];
        if (!DETAIL_HREF_RE.test(href)) continue;
        const url = resolveUrl(href);
        if (seen[url]) continue;
        const title = txt(pair[1]);
        if (!title) continue;
        seen[url] = true;
        out.push({id: url, title: title, cover: covers[url] || "", remarks: "", tags: []});
    }
    return out;
}

function detailFields(html) {
    let title = "";
    const hm = H1_RE.exec(html || "");
    if (hm) title = txt(hm[1]);
    if (!title) {
        const tm = TITLE_TAG_RE.exec(html || "");
        if (tm) title = txt(tm[1]);
    }
    let cover = "";
    const om = OG_IMAGE_RE.exec(html || "");
    if (om) cover = om[1].trim();
    if (!cover) {
        const im = IMG_RE.exec(html || "");
        if (im) cover = im[1].trim();
    }
    if (cover.indexOf("//") === 0) cover = "https:" + cover;
    let synopsis = "";
    const dm = DESC_RE.exec(html || "");
    if (dm) synopsis = unescapeHtml(dm[1]);
    if (!synopsis) {
        const om2 = OG_DESC_RE.exec(html || "");
        if (om2) synopsis = unescapeHtml(om2[1]);
    }
    return {title: title, cover: cover, synopsis: synopsis};
}

async function catalog(tid) {
    const url = BASE + "/" + str(tid);
    const body = await fetchPage(url);
    return parseCards(body);
}

// ---------- idj1 contract ----------

async function home() {
    const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    const items = await catalog(CATS[0][0]);
    return {categories: categories, items: items, hasMore: false};
}

async function category(arg) {
    const tid = str(arg && arg.id) || CATS[0][0];
    const items = await catalog(tid);
    // py ignores the page number (URL template has no page placeholder).
    return {items: items, hasMore: false};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/search?wd=" + encodeURIComponent(keyword);
    const body = await fetchPage(url);
    return {items: parseCards(body), hasMore: false};
}

async function detail(arg) {
    let url = str(arg && arg.id).trim();
    if (!url) throw host.error("E_PARSE", "empty detail id");
    if (url.indexOf("http") !== 0) url = resolveUrl(url);
    const body = await fetchPage(url);
    const f = detailFields(body);
    if (!f.title) throw host.error("E_PARSE", "detail page has no title: " + url);
    return {
        id: url,
        title: f.title,
        cover: f.cover,
        desc: f.synopsis,
        tags: [],
        lines: [{name: "在线播放", episodes: [{id: KEY + ":" + url, name: "正片"}]}],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    const prefix = KEY + ":";
    if (raw.indexOf(prefix) === 0) raw = raw.slice(prefix.length);
    if (raw.indexOf("http") !== 0) throw host.error("E_PARSE", "invalid play id");
    const body = await fetchPage(raw);
    const m = MEDIA_RE.exec(body || "");
    if (!m) throw host.error("E_PARSE", "no direct media link on detail page");
    let stream = m[1];
    if (stream.indexOf("//") === 0) stream = "https:" + stream;
    const isHls = /\.m3u8($|\?)/i.test(stream);
    let finalUrl = stream;
    if (isHls) {
        // Pre-resolve a master playlist to its first variant so playback
        // does not depend on one more slow hop at play time.
        try {
            const pl = await httpGet(stream, stream);
            if (pl && pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const lines = pl.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s.charAt(0) !== "#");
                if (lines.length) finalUrl = host.url.resolve(stream, lines[0]);
            }
        } catch (error) {
            // Keep the master URL; the player can still walk it.
        }
    }
    return {
        streams: [{
            url: finalUrl,
            format: isHls ? "hls" : "mp4",
            headers: {"User-Agent": UA, "Referer": finalUrl},
            name: "在线播放",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
