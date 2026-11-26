// JJavFun - idj1 plugin (rewritten from the built-in py spider javfun)
// Site: https://en.javfun.me ; HTML catalog pages, play resolves through
// /ajax/get_sources/<episode>/<md5> where md5 = md5(episode + b + salt)
// and b is a random 6-char token also carried by a derived cookie name.

const HOST = "https://en.javfun.me";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const TOKEN_STR = "n1sqcua67bcq9826avrbi6m49vd7shxkn985mhodk06twz87wwxtp3dqiicks2dfyud213k6ygiomq01s94e4tr9v0k887bkyud213k6ygiomq01s94e4tr9v0k887bkqocxzw39esdyfhvtkpzq9n4e7at4kc6k8sxom08bl4dukp16h09oplu7zov4m5f8";
const MD5_SALT = "9826avrbi6m49vd7shxkn9815";

const CATS = [
    ["movie", "全部"],
    ["studio:1pondo", "1PONDO"],
    ["studio:caribbeancom", "CARIBBEANCOM"],
    ["studio:10musume", "10MUSUME"],
    ["studio:pacopacomama", "PACOPACOMAMA"],
    ["studio:heyzo", "HEYZO"],
    ["studio:tokyo-hot", "Tokyo Hot"],
    ["studio:japanhdv", "JapanHDV"],
    ["studio:asiansexdiary", "AsianSexDiary"],
    ["category:uncensored", "Jav Uncensored"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function decodeEntities(s) {
    let out = String(s || "");
    out = out.replace(/&#(\d+);/g, (m, d) => {
        const n = parseInt(d, 10);
        return isFinite(n) ? String.fromCharCode(n) : m;
    });
    out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
        const n = parseInt(h, 16);
        return isFinite(n) ? String.fromCharCode(n) : m;
    });
    out = out.replace(/&nbsp;/g, " ")
        .replace(/&ndash;/g, "–")
        .replace(/&mdash;/g, "—")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    return out.trim();
}

function truncate(s, n) {
    s = s || "";
    return s.length > n ? s.slice(0, n) : s;
}

function pageHeaders(referer) {
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": referer || (HOST + "/"),
    };
}

async function getText(url, referer, extraHeaders) {
    const headers = pageHeaders(referer);
    if (extraHeaders) {
        for (const k of Object.keys(extraHeaders)) headers[k] = extraHeaders[k];
    }
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp && resp.body) return resp.body;
            if (resp && resp.status >= 200 && resp.status < 400) return resp.body || "";
            throw new Error("HTTP " + (resp ? resp.status : "?"));
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return "";
}

async function getTextSoft(url, referer, extraHeaders) {
    try {
        return await getText(url, referer, extraHeaders);
    } catch (error) {
        return "";
    }
}

function resolveUrl(u) {
    u = str(u);
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return HOST + u;
    return u;
}

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    const cardRe = /<a href="\/movies\/([A-Za-z0-9._-]+)"[^>]*class="ml-mask jt"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<img data-original='([^']+)'/g;
    let m;
    while ((m = cardRe.exec(html)) !== null) {
        const vid = HOST + "/movies/" + m[1];
        if (seen[vid]) continue;
        seen[vid] = true;
        const title = decodeEntities(m[2]);
        if (!title) continue;
        const tail = html.slice(m.index, m.index + 3000);
        const qm = /<span class="mli-quality">([^<]+)<\/span>/.exec(tail);
        out.push({
            id: vid,
            title: truncate(title, 90),
            cover: resolveUrl(m[3]),
            remarks: qm ? qm[1] : "",
            tags: [],
        });
    }
    return out;
}

function catalogUrl(tid, pg) {
    const pagePart = pg <= 1 ? "" : "/page-" + pg;
    if (tid === "movie") return HOST + "/japanese-porn-videos" + pagePart;
    if (tid.indexOf("studio:") === 0) return HOST + "/studio/" + tid.slice(7) + pagePart;
    if (tid.indexOf("category:") === 0) return HOST + "/category/" + tid.slice(9) + pagePart;
    return HOST + "/japanese-porn-videos" + pagePart;
}

function metaContent(html, attr, key) {
    const marker = attr + '="' + key + '"';
    const p = html.indexOf(marker);
    if (p < 0) return "";
    const after = html.slice(p);
    const c = after.indexOf('content="');
    if (c < 0) return "";
    const s = c + 9;
    const e = after.indexOf('"', s);
    return e >= 0 ? decodeEntities(after.slice(s, e)) : "";
}

function tagTitle(html) {
    const p = html.indexOf("<title>");
    if (p < 0) return "";
    const s = p + 7;
    let e = html.indexOf("</title>", s);
    if (e < 0) e = html.length;
    return decodeEntities(html.slice(s, e));
}

function randomB() {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    let out = "";
    for (let i = 0; i < 6; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}

function cookieName(episodeId) {
    return TOKEN_STR.slice(13, 37) + episodeId + TOKEN_STR.slice(40, 64);
}

function sourcesUrl(episodeId, b) {
    const md5 = host.crypto.md5(episodeId + b + MD5_SALT);
    return HOST + "/ajax/get_sources/" + episodeId + "/" + md5 + "?count=1&mobile=false";
}

async function home() {
    const categories = CATS.map((item) => ({id: item[0], name: item[1]}));
    const html = await getTextSoft(HOST + "/japanese-porn-videos", HOST + "/");
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "movie";
    const html = await getTextSoft(catalogUrl(tid, page), HOST + "/");
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const specials = "`~!@#$%^&*()_|=?;:'\",.<>{}[]\\/";
    let cleaned = "";
    for (const ch of keyword) {
        if (specials.indexOf(ch) < 0 && ch !== "<" && ch !== ">") cleaned += ch;
    }
    const enc = encodeURIComponent(cleaned.trim()).replace(/\+/g, "%20");
    const html = await getTextSoft(HOST + "/search/" + enc, HOST + "/");
    const items = parseCards(html).slice(0, 60);
    return {items: items, hasMore: false, page: page};
}

async function detail(arg) {
    const nid = str(arg && arg.id);
    if (!nid) return {id: "", title: "", cover: "", desc: "", tags: [], lines: []};
    const html = await getTextSoft(nid, HOST + "/");
    const title = tagTitle(html);
    if (!title) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    const cover = metaContent(html, "property", "og:image");
    const desc = metaContent(html, "name", "description");
    const epIds = [];
    const epRe = /loadEpisode\(\d+,"([A-Za-z0-9]+)"\)/g;
    let m;
    while ((m = epRe.exec(html || "")) !== null) {
        if (epIds.indexOf(m[1]) < 0) epIds.push(m[1]);
    }
    if (!epIds.length) return {id: nid, title: title, cover: cover, desc: "", tags: [], lines: []};
    const episodes = epIds.map((ep, i) => ({
        id: ep + "$" + nid,
        name: epIds.length === 1 ? "正片" : "线路" + (i + 1),
    }));
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: truncate(desc, 400),
        tags: [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
}

async function resolveMaster(playUrl, headers) {
    try {
        const resp = await host.http.get(playUrl, {headers: headers, timeout: TIMEOUT});
        const text = resp && resp.body ? resp.body : "";
        if (!text || text.indexOf("#EXT-X-STREAM-INF") < 0) return playUrl;
        const lines = text.split(/\r?\n/);
        let bestUrl = "";
        let bestBandwidth = -1;
        let firstUrl = "";
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
            const bm = /BANDWIDTH=(\d+)/.exec(line);
            const bw = bm ? parseInt(bm[1], 10) : 0;
            let variant = "";
            for (let j = i + 1; j < lines.length; j++) {
                const cand = lines[j].trim();
                if (!cand) continue;
                if (cand.charAt(0) === "#") continue;
                variant = cand;
                break;
            }
            if (!variant) continue;
            const abs = host.url.resolve(playUrl, variant);
            if (!firstUrl) firstUrl = abs;
            if (bw > bestBandwidth) {
                bestBandwidth = bw;
                bestUrl = abs;
            }
        }
        return bestUrl || firstUrl || playUrl;
    } catch (error) {
        return playUrl;
    }
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    const baseHeader = {"User-Agent": UA, "Referer": HOST + "/"};
    if (raw.indexOf(".m3u8") >= 0) {
        return {streams: [{url: raw, format: "hls", headers: baseHeader, name: "JJavFun"}], expiresAt: Date.now() + 3600 * 1000};
    }
    const parts = raw.split("$");
    const episodeId = parts[0] || "";
    const referer = parts[2] || parts[1] || HOST;
    if (!episodeId) throw new Error("无效的播放 ID");
    const b = randomB();
    const url = sourcesUrl(episodeId, b);
    const cookie = cookieName(episodeId) + "=" + b;
    const txt = await getText(url, referer, {"Accept": "application/json, */*", "Cookie": cookie});
    let data = null;
    try {
        data = JSON.parse(txt || "{}");
    } catch (error) {
        data = null;
    }
    let file = "";
    try {
        file = str(data.playlist[0].sources[0].file);
    } catch (error) {
        file = "";
    }
    if (!file) throw new Error("未取到播放地址");
    const streamHeaders = {"User-Agent": UA, "Referer": referer};
    let finalUrl = file;
    if (/\.m3u8($|\?)/i.test(file)) {
        finalUrl = await resolveMaster(file, streamHeaders);
    }
    const isHls = /\.m3u8($|\?)/i.test(finalUrl);
    return {
        streams: [{
            url: finalUrl,
            format: isHls ? "hls" : "video",
            headers: streamHeaders,
            name: "JJavFun",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
