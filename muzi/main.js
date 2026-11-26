// muzi - idj1 plugin (rewritten from the built-in py spider muzi)
// Site: https://web.mzsp1.cc/a (MacCMS). Categories are scraped from the
// homepage nav with a fixed fallback list, cards come from the stui
// vodlist markup, detail resolves the play page player_aaaa url (m3u8).

const BASE = "https://web.mzsp1.cc/a";
const HOST = "https://web.mzsp1.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 55000;

const FALLBACK_CATS = [
    ["386", "黄瓜短剧"],
    ["244", "55资源"],
    ["119", "不卡资源"],
    ["286", "兔儿资源"],
    ["370", "森林资源"],
    ["358", "母子资源"],
    ["329", "库库资源"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function unescapeText(s) {
    if (!s) return "";
    let out = String(s)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\\\//g, "/");
    out = out.replace(/&#(\d+);/g, (m, d) => {
        const n = parseInt(d, 10);
        return isFinite(n) ? String.fromCharCode(n) : m;
    });
    out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
        const n = parseInt(h, 16);
        return isFinite(n) ? String.fromCharCode(n) : m;
    });
    return out;
}

function cleanText(s) {
    if (!s) return "";
    const noTags = String(s).replace(/<[^>]+>/g, " ");
    return unescapeText(noTags.replace(/\s+/g, " ")).trim();
}

function headers() {
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
}

async function getText(url) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(), timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
            if (resp.body) return resp.body;
            throw new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return "";
}

async function getTextSoft(url) {
    try {
        return await getText(url);
    } catch (error) {
        return "";
    }
}

let catsCache = null;

async function fetchCategories() {
    if (catsCache) return catsCache;
    const html = await getTextSoft(BASE + "/");
    const out = [];
    const seen = {};
    const re = /href="[^"]*\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        const cid = m[1];
        const name = str(m[2]);
        if (name && !seen[cid]) {
            seen[cid] = true;
            out.push([cid, name]);
        }
    }
    catsCache = out.length ? out : FALLBACK_CATS.slice();
    return catsCache;
}

function parseCards(html) {
    const out = [];
    const seen = {};
    const re = /<a class="stui-vodlist__thumb lazyload" href="[^"]*\/vod\/play\/id\/(\d+)\/sid\/\d+\/nid\/\d+\.html"[^>]*title="([^"]+)"[^>]*data-original="([^"]+)"/g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        const vid = str(m[1]);
        if (!vid || seen[vid]) continue;
        const title = unescapeText(str(m[2]));
        if (!title) continue;
        seen[vid] = true;
        out.push({
            id: vid,
            title: title,
            cover: str(m[3]),
            remarks: "",
            tags: [],
        });
    }
    return out;
}

async function catalog(tid, pg) {
    let url;
    if (pg <= 1) {
        url = BASE + "/index.php/vod/type/id/" + tid + ".html";
    } else {
        url = BASE + "/index.php/vod/type/id/" + tid + "/page/" + pg + ".html";
    }
    return parseCards(await getTextSoft(url));
}

async function home() {
    const cats = await fetchCategories();
    const categories = cats.map((c) => ({id: c[0], name: c[1]}));
    let items = [];
    if (cats.length) items = await catalog(cats[0][0], 1);
    return {categories: categories, items: items, hasMore: items.length >= 12};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    if (!tid) return {items: [], hasMore: false};
    const items = await catalog(tid, page);
    return {items: items, hasMore: items.length >= 12};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/index.php/vod/search/wd/" + encodeURIComponent(keyword) + ".html";
    const items = parseCards(await getTextSoft(url));
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    let vid = raw.replace(/^\//, "");
    const marker = "/vod/detail/id/";
    const pos = vid.indexOf(marker);
    if (pos >= 0) vid = vid.slice(pos + marker.length);
    vid = vid.replace(/^\//, "").replace(/\.html$/, "");
    const empty = {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    if (!vid) return empty;
    const html = await getTextSoft(BASE + "/index.php/vod/detail/id/" + vid + ".html");
    if (!html) return empty;
    let title = "";
    let m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (m) title = cleanText(m[1]);
    let cover = "";
    m = html.match(/data-original="(https?:\/\/[^"]+)"/);
    if (m) cover = m[1];
    let synopsis = "";
    m = html.match(/<meta name="description"[^>]*content="([^"]*)"/);
    if (m) synopsis = unescapeText(str(m[1]));
    let playLink = "";
    const playRe = new RegExp('href="([^"]*/vod/play/id/' + vid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '/sid/\\d+/nid/1\\.html)"');
    m = html.match(playRe);
    if (m) playLink = m[1];
    if (!title || !playLink) return empty;
    const playHtml = await getTextSoft(HOST + playLink);
    let m3u8 = "";
    m = (playHtml || "").match(/player_aaaa=[\s\S]*?"url":"([^"]+)"/);
    if (m) m3u8 = unescapeText(m[1]);
    if (!m3u8) return empty;
    return {
        id: raw,
        title: title,
        cover: cover,
        desc: synopsis,
        tags: [],
        lines: [{
            name: "在线播放",
            episodes: [{id: m3u8, name: "播放"}],
        }],
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    const hdrs = {"User-Agent": UA, "Referer": BASE + "/"};
    if (!raw.startsWith("http")) throw new Error("invalid play id");
    let playUrl = raw;
    try {
        const resp = await host.http.get(raw, {headers: hdrs, timeout: TIMEOUT});
        const text = resp && resp.body ? String(resp.body) : "";
        if (text.indexOf("#EXT-X-STREAM-INF") >= 0) {
            const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
                    for (let j = i + 1; j < lines.length; j++) {
                        if (lines[j].charAt(0) !== "#") {
                            playUrl = new URL(lines[j], raw).href;
                            break;
                        }
                    }
                    break;
                }
            }
        }
    } catch (error) {
        // master pre-resolve is best effort; the player can still follow the master list
    }
    return {
        streams: [{
            url: playUrl,
            format: "hls",
            headers: hdrs,
            name: "muzi",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
