// shaofu - idj1 plugin (rewritten from the built-in py spider shaofu)
// Site: https://www.shaofudj.top/aa (MacCMS). Category/list/search pages are
// HTML; the play page carries player_aaaa with a master m3u8 that play()
// pre-resolves to its first child playlist.

const BASE = "https://www.shaofudj.top/aa";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    ["1", "玉兔资源"],
    ["10", "网曝系列"],
    ["43", "番茄资源"],
    ["61", "杏吧资源"],
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
    let out = String(s);
    out = out.replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
    out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
        try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return m; }
    });
    out = out.replace(/&#(\d+);/g, (m, d) => {
        try { return String.fromCharCode(parseInt(d, 10)); } catch (e) { return m; }
    });
    out = out.replace(/\\\//g, "/");
    out = out.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => {
        try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return m; }
    });
    return out;
}

function pageHeaders(referer) {
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": referer || (BASE + "/"),
    };
}

async function getText(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: pageHeaders(referer), timeout: TIMEOUT});
            if (resp && resp.body) return resp.body;
            if (resp && resp.status === 200) return "";
            lastError = new Error("HTTP " + (resp ? resp.status : "no response"));
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
    const seen = new Set();
    const blocks = String(html || "").split("<li>");
    for (const block of blocks) {
        const m = block.match(/vod\/play\/id\/(\d+)\/sid\/1\/nid\/1\.html/);
        if (!m) continue;
        const vid = m[1];
        if (seen.has(vid)) continue;
        seen.add(vid);
        const cm = block.match(/data-original="([^"]+)"/);
        const cover = cm ? unescapeText(cm[1].trim()) : "";
        const tm = block.match(/<h3 class="video-title">[\s\S]*?<text>([^<]+)<\/text>/);
        const title = tm ? unescapeText(tm[1].trim()) : "";
        if (!title) continue;
        out.push({id: vid, title: title, cover: cover, remarks: "", tags: []});
    }
    return out;
}

function categoryUrl(tid, pg) {
    if (pg <= 1) return BASE + "/index.php/vod/type/id/" + tid + ".html";
    return BASE + "/index.php/vod/type/id/" + tid + "/page/" + pg + ".html";
}

function playPageUrl(vid) {
    return BASE + "/index.php/vod/play/id/" + vid + "/sid/1/nid/1.html";
}

async function fetchPlayInfo(vid) {
    const html = await getTextSoft(playPageUrl(vid), BASE + "/");
    if (!html) return {url: "", name: "", cls: ""};
    const m = html.match(/player_aaaa=\{[\s\S]*?"url":"([^"]+)"/);
    const u = m ? unescapeText(m[1]) : "";
    const nm = html.match(/"vod_name":"((?:[^"\\]|\\.)*)"/);
    let name = nm ? unescapeText(nm[1]) : "";
    const cm = html.match(/"vod_class":"((?:[^"\\]|\\.)*)"/);
    const cls = cm ? unescapeText(cm[1]) : "";
    if (!name) {
        const tm = html.match(/<title>([\s\S]*?)<\/title>/);
        if (tm) name = unescapeText(tm[1].trim()).split("在线播放")[0].trim();
    }
    return {url: u, name: name, cls: cls};
}

async function resolveMaster(url, headers) {
    try {
        const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
        const text = resp && resp.body ? String(resp.body) : "";
        if (!text.includes("#EXT-X-STREAM-INF")) return url;
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
        for (const line of lines) {
            if (!line.startsWith("#")) {
                return host.url.resolve(url, line);
            }
        }
        return url;
    } catch (error) {
        return url;
    }
}

async function home() {
    const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    const html = await getTextSoft(categoryUrl(CATS[0][0], 1), BASE + "/");
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length >= 20};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || CATS[0][0];
    const html = await getTextSoft(categoryUrl(tid, page), BASE + "/");
    const items = parseCards(html);
    let total = 0;
    const tm = String(html || "").match(/找到\s*(\d+)\s*条/);
    if (tm) total = intValue(tm[1], 0);
    let hasMore;
    if (total > 0) hasMore = page * items.length < total;
    else hasMore = items.length >= 20;
    return {items: items, hasMore: hasMore};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/index.php/vod/search.html?wd=" + encodeURIComponent(keyword);
    const html = await getTextSoft(url, BASE + "/");
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const vid = raw.replace(/[^0-9]/g, "");
    if (!vid) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const info = await fetchPlayInfo(vid);
    if (!info.name || !info.url) {
        return {id: raw, title: info.name || raw, cover: "", desc: "", tags: [], lines: []};
    }
    const parts = [];
    if (info.cls) parts.push("分类：" + info.cls);
    return {
        id: raw,
        title: info.name,
        cover: "",
        desc: parts.join("\n"),
        tags: info.cls ? [info.cls] : [],
        lines: [{
            name: "在线播放",
            episodes: [{id: vid + "|" + info.url, name: "播放"}],
        }],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.includes("$")) raw = raw.split("$").slice(1).join("$");
    let vid = "";
    let url = raw;
    if (raw.includes("|")) {
        const p = raw.indexOf("|");
        vid = raw.slice(0, p);
        url = raw.slice(p + 1);
    }
    const headers = {"User-Agent": UA, "Referer": vid ? playPageUrl(vid) : (BASE + "/")};
    if (url.startsWith("http") && url.includes(".m3u8")) {
        const finalUrl = await resolveMaster(url, headers);
        return {
            streams: [{url: finalUrl, format: "hls", headers: headers, name: "少妇·短剧AV"}],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const dm = raw.match(/(\d+)/);
    if (dm) {
        const info = await fetchPlayInfo(dm[1]);
        if (info.url) {
            headers["Referer"] = playPageUrl(dm[1]);
            const finalUrl = await resolveMaster(info.url, headers);
            return {
                streams: [{url: finalUrl, format: "hls", headers: headers, name: "少妇·短剧AV"}],
                expiresAt: Date.now() + 3600 * 1000,
            };
        }
    }
    throw new Error("未取到播放地址");
}

export default {home: home, category: category, search: search, detail: detail, play: play};
