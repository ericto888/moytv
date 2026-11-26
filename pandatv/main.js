// PANDATV - idj1 plugin (ported 1:1 from the builtin py spider pandatv)
// Site: https://pandatv1346.lol, MacCMS server-rendered HTML.
// Categories mirror the py _cats(): scrape the homepage nav with the py
// regex, drop the "+more" entries, dedupe, and fall back to the py
// FALLBACK_CATS when nothing usable is found. Cards, detail
// (player_aaaa JSON on the play page) and search (POST wd=) reuse the py
// parsing verbatim. Play mirrors the py playerContent: the episode id is
// the stream URL taken from player_aaaa.url; a master playlist is
// pre-resolved to its first variant inside play().

const BASE = "https://pandatv1346.lol";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const FALLBACK_CATS = [
    ["75", "国产"],
    ["83", "高清无码"],
    ["84", "中文字幕"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function pageHeaders(referer) {
    return {"User-Agent": UA, "Referer": referer || BASE};
}

async function getText(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: pageHeaders(referer), timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
            if (resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw host.error("E_NETWORK", "request failed " + url + ": " + (lastError && lastError.message));
    return "";
}

async function postSearch(query) {
    const url = BASE + "/index.php/vod/search.html";
    const body = "wd=" + encodeURIComponent(query || "");
    const headers = {"User-Agent": UA, "Referer": BASE, "Content-Type": "application/x-www-form-urlencoded"};
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.post(url, body, {headers: headers, timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
            if (resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw host.error("E_NETWORK", "search failed: " + (lastError && lastError.message));
    return "";
}

function fixUrl(raw) {
    const u = str(raw);
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return BASE + u;
    return u;
}

function unescapePy(s) {
    return String(s || "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\\\//g, "/");
}

function textOf(v, keys) {
    if (!v || typeof v !== "object") return "";
    for (const k of keys) {
        const x = v[k];
        if (x == null || typeof x === "boolean") continue;
        const s = String(x);
        if (s) return s;
    }
    return "";
}

function normPg(pg) {
    const n = parseInt(pg, 10);
    return isFinite(n) && n >= 1 ? n : 1;
}

function parseCats(html) {
    const out = [];
    const seen = new Set();
    const re = /href="\/index\.php\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)</g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        const cid = m[1];
        const name = m[2].trim();
        if (name && name !== "+更多" && !seen.has(cid)) {
            seen.add(cid);
            out.push([cid, name]);
        }
    }
    return out.length ? out : FALLBACK_CATS.map(pair => [pair[0], pair[1]]);
}

function parseCards(html) {
    const out = [];
    const seen = new Set();
    const re = /<a href="\/index\.php\/vod\/play\/id\/(\d+)\/sid\/1\/nid\/1\.html" title="([^"]+)"[^>]*>[\s\S]*?<img src="([^"]+)"/g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        const vid = m[1].trim();
        if (!vid || seen.has(vid)) continue;
        const title = unescapePy(m[2].trim());
        if (!title) continue;
        seen.add(vid);
        const item = {id: vid, title: title};
        const cover = fixUrl(m[3]);
        if (cover) item.cover = cover;
        out.push(item);
    }
    return out;
}

async function catalog(tid, pg) {
    let url;
    if (pg <= 1) url = BASE + "/index.php/vod/type/id/" + tid + ".html";
    else url = BASE + "/index.php/vod/type/id/" + tid + "/page/" + pg + ".html";
    return parseCards(await getText(url));
}

async function home() {
    const cats = parseCats(await getText(BASE));
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
    const pg = normPg(arg && arg.page);
    const keyword = str(arg && arg.keyword);
    const items = parseCards(await postSearch(keyword));
    return {items: items, hasMore: false, page: pg};
}

async function detail(arg) {
    let vid = str(arg && arg.id);
    if (!vid) throw host.error("E_PARSE", "missing id");
    vid = vid.replace(/^\//, "");
    if (vid.indexOf("index.php/vod/play/id/") === 0) vid = vid.slice("index.php/vod/play/id/".length);
    vid = vid.split("/")[0];
    const playPage = BASE + "/index.php/vod/play/id/" + vid + "/sid/1/nid/1.html";
    const html = await getText(playPage);
    if (!html) throw host.error("E_NETWORK", "detail page empty");
    let player = null;
    const pm = /var player_aaaa=(\{[\s\S]*?\})\s*<\/script>/.exec(html);
    if (pm) {
        try { player = JSON.parse(pm[1]); } catch (error) { player = null; }
    }
    if (!player) throw host.error("E_PARSE", "player_aaaa not found");
    const vodData = (player.vod_data && typeof player.vod_data === "object") ? player.vod_data : {};
    const title = textOf(vodData, ["vod_name"]);
    const m3u8 = textOf(player, ["url"]);
    if (!title || !m3u8) throw host.error("E_PARSE", "detail missing title or stream url");
    const genre = textOf(vodData, ["vod_class"]);
    let cover = "";
    const imgRe = /<img[^>]*src="([^"]+)"/g;
    let im;
    while ((im = imgRe.exec(html)) !== null) {
        const src = fixUrl(im[1]);
        if (src && src.indexOf("/template/") < 0) { cover = src; break; }
    }
    let synopsis = "";
    const dm = /<meta name="description"[^>]*content="([^"]+)"/.exec(html);
    if (dm) synopsis = unescapePy(dm[1].trim());
    const out = {
        id: vid,
        title: title,
        desc: synopsis,
        tags: genre ? [genre] : [],
        lines: [{name: "在线播放", episodes: [{id: m3u8, name: "播放"}]}],
    };
    if (cover) out.cover = cover;
    return out;
}

async function resolveMaster(streamUrl, headers) {
    try {
        const resp = await host.http.get(streamUrl, {headers: headers, timeout: TIMEOUT});
        const text = resp.body || "";
        if ((resp.status === 200 || resp.status === 206) && text.indexOf("#EXT-X-STREAM-INF") >= 0) {
            const lines = text.split(/\r?\n/).map(s => s.trim());
            for (const line of lines) {
                if (line && line.charAt(0) !== "#") return host.url.resolve(streamUrl, line);
            }
        }
    } catch (error) {
        host.log("pandatv resolveMaster failed", streamUrl, String(error && error.message));
    }
    return streamUrl;
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (!raw) throw host.error("E_PARSE", "missing episode id");
    if (raw.indexOf("http") !== 0) throw host.error("E_PARSE", "stream id is not a url");
    const headers = {"User-Agent": UA, "Referer": BASE};
    const isHls = /\.m3u8($|\?)/i.test(raw);
    let url = raw;
    if (isHls) url = await resolveMaster(url, headers);
    if (url.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https: " + url.slice(0, 80));
    return {
        streams: [{
            url: url,
            format: isHls ? "hls" : "mp4",
            headers: headers,
            name: "PANDATV",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
