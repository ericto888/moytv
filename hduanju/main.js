// H-短剧 — idj1 plugin (ported 1:1 from the builtin py spider hduanju)
// Site: https://xiaonverjtx.click, server-rendered HTML (MacCMS-style
// /type/id/N.html, /info/id/N.html, /play/id/N.html, /lookup/<kw>.html).
// Categories are parsed from the homepage nav with the py CAT_RE and fall
// back to the py CATS list verbatim (39 entries, nothing removed; the py
// has no category flag filter). Cards, detail fields and the play-page
// playUrl/contentUrl regexes are the py ones verbatim. Detail carries a
// single line "在线播放" with one episode "播放$hduanju:<id>", exactly
// like the py vod_play_from / vod_play_url. play() pre-resolves a master
// playlist to its first variant sub-playlist.

const BASE = "https://xiaonverjtx.click";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATS = [
    ["21", "无码专区"],
    ["25", "制服诱惑"],
    ["27", "三级伦理"],
    ["29", "AI换脸"],
    ["30", "中文字幕"],
    ["32", "卡通动漫"],
    ["35", "欧美系列"],
    ["36", "美女主播"],
    ["38", "国产自拍"],
    ["40", "熟女人妻"],
    ["42", "萝莉少女"],
    ["44", "女同性爱"],
    ["46", "多人群交"],
    ["48", "美乳巨乳"],
    ["49", "强奸乱伦"],
    ["50", "抖阴视频"],
    ["51", "韩国主播"],
    ["52", "网红头条"],
    ["53", "网爆黑料"],
    ["54", "欧美无码"],
    ["55", "女优明星"],
    ["56", "SM调教"],
    ["57", "AV解说"],
    ["285", "生活都市"],
    ["286", "不偷恋情"],
    ["287", "学生校园"],
    ["288", "人妻熟女"],
    ["289", "暴力虐待"],
    ["290", "明星偶像"],
    ["291", "玄幻仙侠"],
    ["292", "科学幻想"],
    ["293", "街拍偷拍"],
    ["294", "丝袜美腿"],
    ["295", "欧美风情"],
    ["296", "网友自拍"],
    ["297", "卡通漫画"],
    ["298", "露出激情"],
    ["299", "唯美写真"],
    ["300", "女优情报"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function headers() {
    return {"User-Agent": UA, "Referer": BASE + "/"};
}

async function getText(url) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(), timeout: TIMEOUT});
            if (resp.status === 200 || resp.status === 206) return resp.body || "";
            if (resp.status === 404) return resp.body || "";
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw host.error("E_NETWORK", "请求失败 " + url + ": " + (lastError && lastError.message));
    return "";
}

// py _unescape (html.unescape + &nbsp; handling)
function unescapeHtml(s) {
    if (!s) return "";
    s = String(s);
    s = s.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
    s = s.replace(/&#[xX]([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)));
    s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
    return s.trim();
}

function absUrl(u) {
    if (!u) return "";
    u = String(u).trim();
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return BASE + u;
    return u;
}

// py _parse_categories (CAT_RE)
function parseCategories(html) {
    const out = [];
    const seen = new Set();
    const pat = /href="\/type\/id\/(\d+)\.html"[^>]*>([^<]+)</g;
    let m;
    while ((m = pat.exec(html || "")) !== null) {
        const cid = m[1];
        const name = m[2].trim();
        if (!name || seen.has(cid)) continue;
        seen.add(cid);
        out.push([cid, name]);
    }
    return out;
}

async function fetchCats() {
    let cats = [];
    try {
        cats = parseCategories(await getText(BASE));
    } catch (error) {
        cats = [];
    }
    return cats.length ? cats : CATS.slice();
}

// py _parse_cards (CARD_RE)
function parseCards(html) {
    const out = [];
    const seen = new Set();
    const pat = /<a[^>]*href="\/info\/id\/(\d+)\.html"[^>]*class="video-unit"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<div class="video-unit__caption">\s*([\s\S]*?)\s*<\/div>/g;
    let m;
    while ((m = pat.exec(html || "")) !== null) {
        const vid = m[1];
        if (seen.has(vid)) continue;
        seen.add(vid);
        const title = unescapeHtml(m[3]);
        if (!title) continue;
        const item = {id: vid, title: title, remarks: "", tags: []};
        const pic = absUrl(m[2]);
        if (pic) item.cover = pic;
        out.push(item);
    }
    return out;
}

async function catalog(tid, pg) {
    const url = pg <= 1
        ? (BASE + "/type/id/" + tid + ".html")
        : (BASE + "/type/id/" + tid + "/" + pg + ".html");
    return parseCards(await getText(url));
}

// py _detail_id
function detailId(sid) {
    let s = str(sid).replace(/^\//, "");
    if (s.indexOf("info/id/") === 0) s = s.slice("info/id/".length);
    if (s.slice(-5) === ".html") s = s.slice(0, -5);
    return s.replace(/\/$/, "");
}

// py _parse_play_url (PLAY_RE then LD_RE)
function parsePlayUrl(html) {
    let m = /var playUrl\s*=\s*'([^']+)'/.exec(html || "");
    if (m) return m[1].trim();
    m = /"contentUrl":\s*"([^"]+)"/.exec(html || "");
    if (m) return m[1].trim();
    return "";
}

// master playlist pre-resolve: first variant sub-playlist
async function resolveMaster(url, streamHeaders) {
    try {
        const resp = await host.http.get(url, {headers: streamHeaders, timeout: TIMEOUT});
        if (resp.status !== 200 && resp.status !== 206) return url;
        const text = resp.body || "";
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/).map(s => s.trim());
        for (const line of lines) {
            if (line && line.charAt(0) !== "#") {
                return host.url.resolve(url, line);
            }
        }
        return url;
    } catch (error) {
        host.log("hduanju resolveMaster failed", url, String(error && error.message));
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
    const tid = str(arg && arg.id);
    let pg = parseInt(arg && arg.page, 10);
    if (!isFinite(pg) || pg < 1) pg = 1;
    const items = await catalog(tid, pg);
    // py reports pagecount 0 (unknown); more pages exist while a page is full.
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    let pg = parseInt(arg && arg.page, 10);
    if (!isFinite(pg) || pg < 1) pg = 1;
    const keyword = str(arg && arg.keyword);
    const url = BASE + "/lookup/" + encodeURIComponent(keyword) + ".html";
    const items = parseCards(await getText(url));
    return {items: items, hasMore: false};
}

async function detail(arg) {
    let raw = str(arg && arg.id);
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
    const nid = detailId(raw);
    if (!nid) throw host.error("E_PARSE", "missing id");
    let src = await getText(BASE + "/info/id/" + nid + ".html");
    let hm = /<h2 id="pagetitle">([\s\S]*?)<\/h2>/.exec(src);
    if (!hm) {
        // Site change: /info/ pages currently answer nginx 404 for every id
        // (verified on multiple ids), while /play/ pages are alive and carry
        // the same <h2 id="pagetitle"> title. Fall back to the play page so
        // the detail chain stays usable; cover/genre/description only exist
        // on the /info/ page, so they stay empty in that case.
        src = await getText(BASE + "/play/id/" + nid + ".html");
        hm = /<h2 id="pagetitle">([\s\S]*?)<\/h2>/.exec(src);
    }
    const title = hm ? unescapeHtml(hm[1]) : "";
    if (!title) throw host.error("E_PARSE", "detail has no title");
    const cm = /<a href="\/play\/id\/\d+\.html"[^>]*><img[^>]*src="([^"]+)"/.exec(src);
    const cover = cm ? absUrl(cm[1]) : "";
    const gm = /aria-current="page"[^>]*href="\/type\/id\/\d+\.html"[^>]*>([^<]+)</.exec(src);
    const genre = gm ? unescapeHtml(gm[1]) : "";
    const dm = /<meta name="description"[^>]*content="([^"]+)"/.exec(src);
    const synopsis = dm ? unescapeHtml(dm[1]) : "";
    const out = {
        id: nid,
        title: title,
        desc: synopsis,
        tags: genre ? [genre] : [],
        lines: [{name: "在线播放", episodes: [{id: "hduanju:" + nid, name: "播放"}]}],
    };
    if (cover) out.cover = cover;
    return out;
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
    if (raw.indexOf("hduanju:") === 0) raw = raw.slice("hduanju:".length);
    const streamHeaders = {"User-Agent": UA, "Referer": BASE + "/"};
    let m3u8 = "";
    if (/\.m3u8$/.test(raw) || /\.mp4$/.test(raw)) {
        m3u8 = raw;
    } else {
        const url = raw.indexOf("http") === 0 ? raw : (BASE + "/play/id/" + detailId(raw) + ".html");
        const src = await getText(url);
        if (src) m3u8 = parsePlayUrl(src);
    }
    if (!m3u8) throw host.error("E_PARSE", "no stream found for " + raw);
    if (m3u8.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https: " + m3u8.slice(0, 80));
    const isHls = /\.m3u8($|\?)/i.test(m3u8);
    const finalUrl = isHls ? await resolveMaster(m3u8, streamHeaders) : m3u8;
    return {
        streams: [{
            url: finalUrl,
            format: isHls ? "hls" : "mp4",
            headers: streamHeaders,
            name: "H-短剧",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
