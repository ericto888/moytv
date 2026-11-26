// 黑桃短剧 — idj1 plugin (ported 1:1 from the builtin py spider heitaoduanju)
// Site: MacCMS-style SSR HTML under /a/ on two mirror bases
// (wap.heitaoduanju7.cc / hei.heitaoduanju8.cc), tried in the py's order.
// Categories come from the /a/ page cat-icon links, with the py's fixed
// CATS list as fallback — nothing dropped. Cards, detail episodes and the
// player_aaaa play regex are the py's verbatim. The site is slow
// (~35-45s per page from here), so timeouts are widened to 60s with
// retries on both bases.

const BASES = ["https://wap.heitaoduanju7.cc", "https://hei.heitaoduanju8.cc"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATS = [
    ["386", "黄瓜资源"],
    ["358", "番号资源"],
    ["119", "不卡资源"],
    ["421", "黑桃资源"],
    ["286", "玉兔资源"],
    ["329", "裤子资源"],
    ["370", "森林资源"],
    ["244", "163资源"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function headers(referer) {
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": referer || (BASES[0] + "/"),
    };
}

// py _unescape: html.unescape + "\/" -> "/" + strip.
function unescapeText(s) {
    if (!s) return "";
    let t = String(s);
    t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
    t = t.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
    t = t.replace(/&#[xX]([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)));
    return t.replace(/\\\//g, "/").trim();
}

// py _fix_url
function fixUrl(raw, base) {
    const u = str(raw);
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return (base || BASES[0]) + u;
    return u;
}

// py _get_text: try each base in order (py _http_get retries twice per
// base), return {body, base} of the first non-empty 200.
async function getText(path) {
    let lastError = null;
    for (const base of BASES) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const resp = await host.http.get(base + path, {headers: headers(base + "/"), timeout: TIMEOUT});
                if (resp.status === 200 && resp.body) return {body: resp.body, base: base};
                if (resp.status) lastError = new Error("HTTP " + resp.status);
            } catch (error) {
                lastError = error;
            }
        }
    }
    if (lastError) throw host.error("E_NETWORK", "请求失败 " + path + ": " + (lastError && lastError.message));
    return {body: "", base: BASES[0]};
}

// ---------- py parsers (regexes verbatim) ----------

const CARD_RE = /<a class="vod-card-item" href="\/a\/index\.php\/vod\/detail\/id\/(\d+)\.html"[\s\S]*?<div class="vod-card-name">([\s\S]*?)<\/div>[\s\S]*?<span class="vod-card-remarks">([^<]*)<\/span>/g;
const COVER_RE = /data-original="([^"]+)"/;
const CAT_RE = /<a href="\/a\/index\.php\/vod\/type\/id\/(\d+)\.html" class="cat-icon-item"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g;

function parseCards(html, base) {
    const out = [];
    const seen = new Set();
    CARD_RE.lastIndex = 0;
    let m;
    while ((m = CARD_RE.exec(html || "")) !== null) {
        const vid = str(m[1]);
        if (!vid || seen.has(vid)) continue;
        const title = unescapeText(m[2]);
        if (!title) continue;
        seen.add(vid);
        const cm = COVER_RE.exec(m[0]);
        const item = {id: vid, title: title, remarks: str(m[3]), tags: []};
        if (cm) item.cover = fixUrl(cm[1], base);
        out.push(item);
    }
    return out;
}

function parseCategories(html) {
    const out = [];
    const seen = new Set();
    CAT_RE.lastIndex = 0;
    let m;
    while ((m = CAT_RE.exec(html || "")) !== null) {
        const cid = m[1];
        const name = str(m[2]);
        if (!name || seen.has(cid)) continue;
        seen.add(cid);
        out.push([cid, name]);
    }
    return out;
}

async function fetchCats() {
    const got = await getText("/a/");
    const cats = parseCategories(got.body);
    return cats.length ? cats : CATS.slice();
}

async function catalog(tid, pg) {
    const path = pg <= 1
        ? ("/a/index.php/vod/type/id/" + tid + ".html")
        : ("/a/index.php/vod/type/id/" + tid + "/page/" + pg + ".html");
    const got = await getText(path);
    return parseCards(got.body, got.base);
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
        host.log("heitaoduanju resolveMaster failed", url, String(error && error.message));
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
    const tid = str(arg && arg.id) || CATS[0][0];
    let pg = parseInt(arg && arg.page, 10);
    if (!isFinite(pg) || pg < 1) pg = 1;
    const items = await catalog(tid, pg);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    let pg = parseInt(arg && arg.page, 10);
    if (!isFinite(pg) || pg < 1) pg = 1;
    // py searchContent always fetches the same first search page.
    if (pg !== 1) return {items: [], hasMore: false};
    const keyword = str(arg && arg.keyword);
    const got = await getText("/a/index.php/vod/search/wd/" + encodeURIComponent(keyword) + ".html");
    return {items: parseCards(got.body, got.base), hasMore: false};
}

async function detail(arg) {
    const nid = str(arg && arg.id).replace(/^\//, "");
    if (!nid) throw host.error("E_PARSE", "missing id");
    const got = await getText("/a/index.php/vod/detail/id/" + nid + ".html");
    const html = got.body;
    if (!html) throw host.error("E_PARSE", "empty detail page");
    const hm = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    let title = hm ? unescapeText(hm[1]) : "";
    if (title.indexOf("<") >= 0) title = title.slice(0, title.indexOf("<")).trim();
    if (!title) throw host.error("E_PARSE", "detail has no title");
    let cover = "";
    const im = /<img class="main-img" src="([^"]+)"/.exec(html);
    if (im) cover = fixUrl(im[1], got.base);
    if (!cover) {
        const cm = COVER_RE.exec(html);
        if (cm) cover = fixUrl(cm[1], got.base);
    }
    const dm = /<meta name="description"[^>]*content="([^"]+)"/.exec(html);
    const synopsis = dm ? unescapeText(dm[1]) : "";
    const eps = [];
    const seen = new Set();
    const epRe = /<a[^>]*href="(\/a\/index\.php\/vod\/play\/id\/\d+\/sid\/\d+\/nid\/\d+\.html)"[^>]*>([^<]+)<\/a>/g;
    let em;
    while ((em = epRe.exec(html)) !== null) {
        const href = str(em[1]);
        const name = str(em[2]);
        if (name === "▶ 立即播放" || seen.has(href)) continue;
        seen.add(href);
        eps.push({id: fixUrl(href, got.base), name: name});
    }
    if (!eps.length) throw host.error("E_PARSE", "detail has no episodes");
    const out = {
        id: nid,
        title: title,
        desc: synopsis,
        tags: [],
        lines: [{name: "在线播放", episodes: eps}],
    };
    if (cover) out.cover = cover;
    return out;
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("heitaoduanju:") === 0) raw = raw.slice("heitaoduanju:".length);
    const url = fixUrl(raw);
    const streamHeaders = {"User-Agent": UA, "Referer": BASES[0] + "/"};
    let m3u8 = "";
    if (url.indexOf("/vod/play/") >= 0) {
        let path = url;
        const idx = url.indexOf("/a/index.php");
        if (idx >= 0) path = url.slice(idx);
        const got = await getText(path);
        const m = /player_aaaa=[\s\S]*?"url":"([^"]+)"/.exec(got.body || "");
        if (m) m3u8 = unescapeText(m[1]);
    } else if (url.indexOf("http") === 0 && /\.m3u8($|\?)/i.test(url)) {
        m3u8 = url;
    }
    if (!m3u8) throw host.error("E_PARSE", "no m3u8 found for episode " + raw.slice(0, 80));
    if (m3u8.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https: " + m3u8.slice(0, 80));
    const finalUrl = await resolveMaster(m3u8, streamHeaders);
    return {
        streams: [{
            url: finalUrl,
            format: "hls",
            headers: streamHeaders,
            name: "黑桃短剧",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
