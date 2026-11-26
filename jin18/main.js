// 18jin le yuan - idj1 plugin (rewritten from bundled py spider jin18)
// Site: https://18jin1109.lol (MacCMS). Categories are parsed live from the
// homepage exactly like the py spider, with the py CATS table as fallback.
// Detail resolves the play page player_aaaa url; play pre-resolves a master
// playlist to its first variant sub-playlist.

const BASE = "https://18jin1109.lol";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    ["1", "国产自拍"],
    ["2", "主播诱惑"],
    ["3", "探花约炮"],
    ["4", "偷拍偷窥"],
    ["5", "网曝吃瓜"],
    ["6", "抖阴短片"],
    ["7", "传媒剧情"],
    ["8", "日韩无码"],
    ["9", "中文字幕"],
    ["10", "换脸明星"],
    ["11", "强奸乱伦"],
    ["12", "女优明星"],
    ["13", "欧美激情"],
    ["14", "剧情动漫"],
    ["15", "SM调教"],
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
    let t = String(s || "").replace(/\\\//g, "/");
    t = t.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)));
    t = t.replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)));
    t = t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
    return t.trim();
}

function cleanText(t) {
    if (!t) return "";
    return unescapeHtml(String(t).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function fixUrl(raw) {
    const u = str(raw);
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASE + u;
    return u;
}

function headers(referer) {
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": referer || (BASE + "/"),
    };
}

async function getHtml(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(referer), timeout: TIMEOUT});
            if (resp && resp.body) return resp.body;
            if (resp && resp.status) lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return "";
}

async function getHtmlSoft(url, referer) {
    try {
        return await getHtml(url, referer);
    } catch (error) {
        return "";
    }
}

function parseCards(html) {
    const out = [];
    const seen = {};
    const pat = /<a[^>]+href="\/index\.php\/vod\/detail\/id\/(\d+)\.html"[^>]*>[\s\S]*?<img src="([^"]+)" alt="([^"]+)"/g;
    let m;
    while ((m = pat.exec(html || "")) !== null) {
        const vid = str(m[1]);
        if (!vid || seen[vid]) continue;
        const title = unescapeHtml(m[3]);
        if (!title) continue;
        seen[vid] = true;
        out.push({id: vid, title: title, cover: fixUrl(m[2]), remarks: "", tags: []});
    }
    return out;
}

function parseCategories(html) {
    const out = [];
    const seen = {};
    const pat = /href="\/index\.php\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)</g;
    let m;
    while ((m = pat.exec(html || "")) !== null) {
        const cid = str(m[1]);
        const name = str(m[2]);
        if (!name || seen[cid]) continue;
        seen[cid] = true;
        out.push([cid, name]);
    }
    return out;
}

let catsCache = null;

async function fetchCategories() {
    if (catsCache) return catsCache;
    const html = await getHtmlSoft(BASE, BASE + "/");
    const parsed = parseCategories(html);
    catsCache = parsed.length ? parsed : CATS.slice();
    return catsCache;
}

function parsePlayerUrl(html) {
    const m = /player_aaaa=[\s\S]*?"url":"([^"]+)"/.exec(html || "");
    if (!m) return "";
    return unescapeHtml(m[1]);
}

function parseTitle(html) {
    const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html || "");
    if (!m) return "";
    return unescapeHtml(cleanText(m[1]));
}

function parseCover(html, title) {
    const pat = /<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"/g;
    let m;
    if (title) {
        while ((m = pat.exec(html || "")) !== null) {
            if (str(m[2]) === title) return fixUrl(m[1]);
        }
    }
    const pat2 = /<img[^>]+src="(https?:\/\/[^"]+)"/g;
    while ((m = pat2.exec(html || "")) !== null) {
        if (m[1].indexOf("logo.png") < 0) return fixUrl(m[1]);
    }
    return "";
}

function parseSynopsis(html) {
    const m = /<meta name="description"[^>]*content="([^"]+)"/.exec(html || "");
    if (!m) return "";
    return unescapeHtml(m[1]);
}

async function home() {
    const cats = await fetchCategories();
    const categories = cats.map((c) => ({id: c[0], name: c[1]}));
    const tid = cats.length ? cats[0][0] : "1";
    const html = await getHtmlSoft(BASE + "/index.php/vod/type/id/" + tid + "/", BASE + "/");
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "1";
    let url;
    if (page <= 1) url = BASE + "/index.php/vod/type/id/" + tid + "/";
    else url = BASE + "/index.php/vod/type/id/" + tid + "/page/" + page + ".html";
    const html = await getHtmlSoft(url, BASE + "/");
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/index.php/vod/search.html?wd=" + encodeURIComponent(keyword);
    const html = await getHtmlSoft(url, BASE + "/");
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    let nid = str(arg && arg.id);
    nid = nid.replace(/^\/+|\/+$/g, "").replace("index.php/vod/detail/id/", "").replace(/\.html$/, "");
    if (!nid) return {id: str(arg && arg.id), title: "", cover: "", desc: "", tags: [], lines: []};
    const html = await getHtmlSoft(BASE + "/index.php/vod/detail/id/" + nid + ".html", BASE + "/");
    if (!html) return {id: nid, title: "", cover: "", desc: "", tags: [], lines: []};
    const title = parseTitle(html);
    const cover = parseCover(html, title);
    const synopsis = parseSynopsis(html);
    const pm = /href="(\/index\.php\/vod\/play\/id\/\d+\/sid\/1\/nid\/1\.html)"/.exec(html);
    const playPath = pm ? pm[1] : "";
    if (!title || !playPath) return {id: nid, title: title, cover: cover, desc: synopsis, tags: [], lines: []};
    const playHtml = await getHtmlSoft(BASE + playPath, BASE + "/");
    const m3u8 = parsePlayerUrl(playHtml);
    if (!m3u8) return {id: nid, title: title, cover: cover, desc: synopsis, tags: [], lines: []};
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: synopsis,
        tags: [],
        lines: [{name: "在线播放", episodes: [{id: m3u8, name: "播放"}]}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (!raw.startsWith("http")) throw new Error("invalid play id");
    const hdrs = {"User-Agent": UA, "Referer": BASE + "/"};
    let playUrl = raw;
    const isHls = /\.m3u8($|\?)/i.test(raw);
    if (isHls) {
        try {
            const resp = await host.http.get(raw, {headers: hdrs, timeout: TIMEOUT});
            const text = resp && resp.body ? resp.body : "";
            if (text.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                        for (let j = i + 1; j < lines.length; j++) {
                            if (!lines[j].startsWith("#")) {
                                playUrl = new URL(lines[j], raw).href;
                                break;
                            }
                        }
                        break;
                    }
                }
            }
        } catch (error) {
            playUrl = raw;
        }
    }
    return {
        streams: [{
            url: playUrl,
            format: isHls ? "hls" : "",
            headers: hdrs,
            name: "18jin",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
