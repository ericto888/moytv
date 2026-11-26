// 黄果AI短剧 — idj1 plugin (ported 1:1 from the builtin py spider hgaidj)
// Site: https://hgaidjzun.lol, server-rendered HTML. Categories are parsed
// from the home page hunt links exactly like the py CAT_RE, with the py's
// 12 fixed names as fallback (id = name, same as the py). List cards,
// detail and search reuse the py regexes verbatim. Detail fetches the info
// page for title/cover/desc and the play page for playUrl, and emits one
// line 在线播放 with a single episode whose id carries the m3u8
// (hgaidj:<url>), exactly like the py vod_play_url.

const BASE = "https://hgaidjzun.lol";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATS = [
    "国产视频",
    "每日最新",
    "国产自拍",
    "国产偷拍",
    "国产传媒",
    "日本无码",
    "日本有码",
    "中文字幕",
    "人妻熟女",
    "AV解说",
    "主播大秀",
    "网曝黑料",
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
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    throw host.error("E_NETWORK", "请求失败 " + url + ": " + (lastError && lastError.message));
}

// ---------- py helpers ----------

function unescapeHtml(s) {
    if (!s) return "";
    s = String(s);
    s = s.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
    s = s.replace(/&#[xX]([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)));
    s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
    return s.trim();
}

function parseCards(html) {
    const out = [];
    const seen = new Set();
    const pat = /<a href="\/info\/id\/(\d+)"[^>]*>\s*<img src="([^"]+)"[^>]*>\s*<p class="video-title">(.*?)<\/p>/g;
    let m;
    while ((m = pat.exec(html || "")) !== null) {
        const vid = str(m[1]);
        if (!vid || seen.has(vid)) continue;
        const title = unescapeHtml(m[3]);
        if (!title) continue;
        seen.add(vid);
        out.push({id: vid, title: title, cover: str(m[2]), remarks: "", tags: []});
    }
    return out;
}

function parseCategories(html) {
    const out = [];
    const seen = new Set();
    const pat = /href="\/hunt\/([^"\/]+)\.html"[^>]*>([^<]+)<\/a>/g;
    let m;
    while ((m = pat.exec(html || "")) !== null) {
        const cid = str(m[1]);
        const name = str(m[2]);
        if (!name || seen.has(cid)) continue;
        seen.add(cid);
        out.push({id: cid, name: name});
    }
    return out;
}

async function fetchCats() {
    const src = await getText(BASE + "/");
    const cats = parseCategories(src);
    if (cats.length) return {cats: cats, homeHtml: src};
    return {cats: CATS.map(name => ({id: name, name: name})), homeHtml: src};
}

async function catalog(tid, pg) {
    const url = pg <= 1
        ? (BASE + "/hunt/" + encodeURIComponent(tid) + ".html")
        : (BASE + "/hunt/" + encodeURIComponent(tid) + "/h/" + pg + ".html");
    const src = await getText(url);
    return parseCards(src);
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
            if (line && line.charAt(0) !== "#") {
                return host.url.resolve(url, line);
            }
        }
        return url;
    } catch (error) {
        host.log("hgaidj resolveMaster failed", url, String(error && error.message));
        return url;
    }
}

// ---------- idj1 contract ----------

async function home() {
    const got = await fetchCats();
    let items = [];
    if (got.cats.length) items = await catalog(got.cats[0].id, 1);
    return {categories: got.cats, items: items, hasMore: false};
}

async function category(arg) {
    const tid = str(arg && arg.id);
    if (!tid) throw host.error("E_PARSE", "missing category id");
    let pg = parseInt(arg && arg.page, 10);
    if (!isFinite(pg) || pg < 1) pg = 1;
    const items = await catalog(tid, pg);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    const url = BASE + "/hunt/" + encodeURIComponent(keyword);
    const src = await getText(url);
    return {items: parseCards(src), hasMore: false};
}

async function detail(arg) {
    let nid = str(arg && arg.id).replace(/^\//, "");
    if (nid.indexOf("info/id/") === 0) nid = nid.slice("info/id/".length);
    if (nid.slice(-5) === ".html") nid = nid.slice(0, -5);
    nid = nid.replace(/\/$/, "");
    if (!nid) throw host.error("E_PARSE", "missing id");
    const src = await getText(BASE + "/info/id/" + nid);
    let title = "";
    const tm = /<title>(.*?)<\/title>/.exec(src);
    if (tm) title = unescapeHtml(tm[1]);
    const marker = title.indexOf("-黄果AI短剧");
    if (marker >= 0) title = title.slice(0, marker);
    if (!title) throw host.error("E_PARSE", "detail has no title");
    let cover = "";
    const cm = /<img[^>]*src="(https?:\/\/[^"]+\/upload\/vod\/[^"]+)"/.exec(src);
    if (cm) cover = cm[1];
    let desc = "";
    const dm = /<meta name="description"[^>]*content="([^"]+)"/.exec(src);
    if (dm) desc = unescapeHtml(dm[1]);
    const playSrc = await getText(BASE + "/play/id/" + nid);
    let m3u8 = "";
    const pm = /playUrl\s*=\s*'([^']+)'/.exec(playSrc);
    if (pm) m3u8 = str(pm[1]);
    if (!m3u8) throw host.error("E_PARSE", "detail has no playUrl for id " + nid);
    const out = {
        id: nid,
        title: title,
        desc: desc,
        tags: [],
        lines: [{name: "在线播放", episodes: [{id: "hgaidj:" + m3u8, name: "播放"}]}],
    };
    if (cover) out.cover = cover;
    return out;
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("$") >= 0) raw = str(raw.split("$")[1]);
    if (raw.indexOf("hgaidj:") === 0) raw = raw.slice("hgaidj:".length);
    const m3u8 = raw.indexOf("http") === 0 ? raw : "";
    if (!m3u8) throw host.error("E_PARSE", "no stream url in episode id");
    if (m3u8.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https: " + m3u8.slice(0, 80));
    const streamHeaders = {"User-Agent": UA, "Referer": BASE + "/"};
    const finalUrl = await resolveMaster(m3u8, streamHeaders);
    return {
        streams: [{
            url: finalUrl,
            format: "hls",
            headers: streamHeaders,
            name: "黄果AI短剧",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
