// TaiAV - idj1 plugin (rewritten from the built-in py spider taiav)
// Site: https://taiav.com; lists and details are HTML pages, play resolves
// through /api/getmovie which returns an m3u8 path on the site host.

const HOST = "https://taiav.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 58000;
const ATTEMPTS = 2;

const CATS = [
    ["uncensored", "无码"],
    ["censored", "有码"],
    ["domestic", "国产AV"],
    ["influencer", "网红主播"],
    ["hots", "热门视频"],
    ["random", "随机"],
];

const ID_RE = /\/cn\/movie\/([0-9a-f]{24})/;

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function decodeEntities(s) {
    if (!s) return "";
    let out = String(s).replace(/&nbsp;/g, " ");
    out = out.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
    out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)));
    out = out.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    return out.trim();
}

function trunc(s, n) {
    s = s || "";
    return s.length > n ? s.slice(0, n) : s;
}

function pageHeaders(referer) {
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": referer || (HOST + "/cn/"),
    };
}

async function getText(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: pageHeaders(referer), timeout: TIMEOUT});
            if (resp && resp.body) return resp.body;
            if (resp && resp.status === 200) return resp.body || "";
            lastError = new Error("HTTP " + (resp ? resp.status : "?"));
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return "";
}

async function getTextSoft(url, referer) {
    try {
        return await getText(url, referer);
    } catch (error) {
        return "";
    }
}

function parseCards(html) {
    const out = [];
    const seen = {};
    const blocks = String(html || "").split('class="movie-card"').slice(1);
    for (let block of blocks) {
        const end = block.indexOf('class="movie-card"');
        if (end >= 0) block = block.slice(0, end);
        const m = ID_RE.exec(block);
        if (!m) continue;
        const vid = m[1];
        const pageUrl = HOST + "/cn/movie/" + vid;
        if (seen[pageUrl]) continue;
        let cover = "";
        let title = "";
        const p = block.indexOf("poster2.webp");
        if (p >= 0) {
            const head = block.slice(0, p);
            const a = head.lastIndexOf("<img ");
            if (a >= 0) {
                const img = block.slice(a);
                const sm = /src="([^"]+)"/.exec(img);
                if (sm) cover = sm[1];
                const am = /alt="([^"]+)"/.exec(img);
                if (am) title = decodeEntities(am[1]);
            }
        }
        if (!title) continue;
        seen[pageUrl] = true;
        out.push({id: pageUrl, title: trunc(title, 90), cover: cover, remarks: "", tags: []});
    }
    return out;
}

function catalogUrl(tid, pg) {
    const wp = (base) => (pg <= 1 ? base : base + "?page=" + pg);
    if (tid === "uncensored") return wp(HOST + "/cn/category/" + encodeURIComponent("无码"));
    if (tid === "censored") return wp(HOST + "/cn/category/" + encodeURIComponent("有码"));
    if (tid === "domestic") return wp(HOST + "/cn/category/" + encodeURIComponent("国产AV"));
    if (tid === "influencer") return wp(HOST + "/cn/category/" + encodeURIComponent("网红主播"));
    if (tid === "hots") return wp(HOST + "/hots");
    if (tid === "random") return HOST + "/random";
    return wp(HOST + "/cn/category/" + encodeURIComponent("无码"));
}

function metaContent(html, attr, key) {
    const marker = attr + '="' + key + '"';
    const p = String(html || "").indexOf(marker);
    if (p < 0) return "";
    const after = html.slice(p);
    const c = after.indexOf('content="');
    if (c < 0) return "";
    const s = c + 9;
    const e = after.slice(s).indexOf('"');
    if (e < 0) return "";
    return decodeEntities(after.slice(s, s + e));
}

function tagTitle(html) {
    const p = String(html || "").indexOf("<title>");
    if (p < 0) return "";
    const s = p + 7;
    let e = html.slice(s).indexOf("</title>");
    if (e < 0) e = html.length - s;
    let t = decodeEntities(html.slice(s, s + e));
    const seps = [" 在线观看,免费高清 - Taiav.com", " - Taiav.com"];
    for (const sep of seps) {
        if (t.indexOf(sep) >= 0) return t.split(sep).slice(0, -1).join(sep).trim();
    }
    return t;
}

async function home() {
    const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    let items = [];
    try {
        const r = await category({id: CATS[0][0], page: 1});
        items = r.items || [];
    } catch (error) {
        items = [];
    }
    return {categories: categories, items: items, hasMore: false};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || CATS[0][0];
    const url = catalogUrl(tid, page);
    const html = await getTextSoft(url, HOST + "/cn/");
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = HOST + "/cn/search?q=" + encodeURIComponent(keyword);
    const html = await getTextSoft(url, HOST + "/cn/");
    const items = parseCards(html).slice(0, 60);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    let pageUrl = str(arg && arg.id);
    if (pageUrl.indexOf("$") >= 0) pageUrl = pageUrl.split("$").slice(-1)[0];
    if (!pageUrl) return {id: "", title: "", cover: "", desc: "", tags: [], lines: []};
    const html = await getTextSoft(pageUrl, HOST + "/cn/");
    const title = tagTitle(html);
    if (!title) return {id: pageUrl, title: "", cover: "", desc: "", tags: [], lines: []};
    const cover = metaContent(html, "property", "og:image");
    const desc = trunc(metaContent(html, "name", "description"), 400);
    return {
        id: pageUrl,
        title: title,
        cover: cover,
        desc: desc,
        tags: [],
        lines: [{
            name: "在线播放",
            episodes: [{id: pageUrl, name: "正片"}],
        }],
    };
}

async function resolveMaster(url, headers) {
    try {
        const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
        const text = resp && resp.body ? String(resp.body) : "";
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/).map((s) => s.trim());
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j] && lines[j].indexOf("#") !== 0) {
                        try {
                            return new URL(lines[j], url).href;
                        } catch (error) {
                            return host.url.resolve(url, lines[j]);
                        }
                    }
                }
            }
        }
        return url;
    } catch (error) {
        return url;
    }
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("$") >= 0) raw = raw.split("$").slice(-1)[0];
    const header = {"User-Agent": UA, "Referer": HOST + "/cn/"};
    if (raw.indexOf("http") === 0 && raw.indexOf(".m3u8") >= 0) {
        return {streams: [{url: raw, format: "hls", headers: header, name: "TaiAV"}], expiresAt: Date.now() + 3600 * 1000};
    }
    const pageUrl = raw;
    const m = ID_RE.exec(pageUrl);
    if (!m) throw new Error("无效的播放 ID");
    const api = HOST + "/api/getmovie?type=1280&id=" + m[1];
    const body = await getText(api, pageUrl);
    let obj = {};
    try {
        obj = JSON.parse(body || "{}");
    } catch (error) {
        obj = {};
    }
    const path = str(obj && obj.m3u8);
    if (!path) throw new Error("未取到播放地址");
    let url = "";
    if (path.indexOf("http") === 0) url = path;
    else if (path.indexOf("/") === 0) url = HOST + path;
    else throw new Error("播放地址格式异常");
    header["Referer"] = pageUrl;
    const finalUrl = await resolveMaster(url, header);
    return {
        streams: [{url: finalUrl, format: "hls", headers: header, name: "TaiAV"}],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
