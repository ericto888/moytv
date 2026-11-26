// Senzuri Tube - idj1 plugin (rewritten from the built-in py spider senzuri)
// Site: https://senzuri.tube; data via the site JSON API (/api/json/...),
// play via /api/videofile.php + custom B164 decode of the /get_file/ path,
// then pre-resolve the HLS variant (&f=video.m3u8) through CDN redirects
// to the final sub-playlist; fall back to the direct mp4 path from the py.

const HOST = "https://senzuri.tube";
const API = "https://senzuri.tube/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 55000;

const CATS = [
    ["latest-updates", "最新"],
    ["most-popular", "最热"],
    ["longest", "最长"],
    ["cat:jav-censored", "JAV Censored"],
    ["cat:hd", "HD"],
    ["cat:cuckold", "Cuckold"],
    ["cat:asian", "Asian"],
    ["cat:toys", "Toys"],
    ["cat:japanese", "Japanese"],
    ["cat:cheating", "Cheating"],
    ["cat:female-orgasm", "Female Orgasm"],
    ["cat:compilation", "Compilation"],
    ["cat:blowjob-fera", "Blowjob/Fera"],
];

function str(value) {
    if (value == null || typeof value === "boolean") return "";
    return String(value);
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function decodeEntities(s) {
    return str(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'").replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").trim();
}

function truncate(s, n) {
    s = str(s);
    return s.length > n ? s.slice(0, n) : s;
}

function headers(referer) {
    return {
        "User-Agent": UA,
        "Accept": "application/json, text/html, */*",
        "Referer": referer || (HOST + "/"),
    };
}

async function getText(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(referer), timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("request failed");
}

async function getJsonSoft(url, referer) {
    try {
        return JSON.parse(await getText(url, referer));
    } catch (error) {
        return null;
    }
}

async function getJson(url, referer) {
    return JSON.parse(await getText(url, referer));
}

// ---------- B164 decode (site custom alphabet, padding index 64) ----------
const B164_ALPHABET = "АВСDЕFGHIJKLМNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,~";

function b164Decode(input) {
    const alpha = B164_ALPHABET;
    const clean = [];
    for (const c of str(input)) {
        if (alpha.indexOf(c) >= 0) clean.push(c);
    }
    const idx = (c) => {
        const i = alpha.indexOf(c);
        return i >= 0 ? i : 64;
    };
    const bytes = [];
    let i = 0;
    while (i < clean.length) {
        const a = idx(clean[i]);
        const b = i + 1 < clean.length ? idx(clean[i + 1]) : 64;
        const c = i + 2 < clean.length ? idx(clean[i + 2]) : 64;
        const d = i + 3 < clean.length ? idx(clean[i + 3]) : 64;
        bytes.push(((a << 2) | (b >> 4)) & 0xff);
        if (c !== 64) bytes.push((((b & 15) << 4) | (c >> 2)) & 0xff);
        if (d !== 64) bytes.push((((c & 3) << 6) | d) & 0xff);
        i += 4;
    }
    let latin1 = "";
    for (const b of bytes) latin1 += String.fromCharCode(b);
    try {
        return host.codec.convert(latin1, "latin1", "utf8");
    } catch (error) {
        return latin1;
    }
}

// ---------- lists ----------

function videosUrl(categoryId, page) {
    if (categoryId.indexOf("cat:") === 0) {
        return API + "/json/videos2/86400/str/latest-updates/60/categories." +
            categoryId.slice(4) + "." + page + ".all...json";
    }
    return API + "/json/videos2/86400/str/" + categoryId + "/60/.." + page + ".all...json";
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

function parseVideos(data) {
    const out = [];
    if (!data || !Array.isArray(data.videos)) return out;
    for (const video of data.videos) {
        if (!video || typeof video !== "object") continue;
        const vid = textOf(video, ["video_id"]);
        if (!vid) continue;
        const title = decodeEntities(textOf(video, ["title"]));
        if (!title) continue;
        const cover = textOf(video, ["thumbsrc"]) || textOf(video, ["thumb"]) || textOf(video, ["scr"]);
        out.push({
            id: vid,
            title: truncate(title, 90),
            cover: cover,
            remarks: textOf(video, ["duration"]),
            duration: textOf(video, ["duration"]),
            tags: [],
        });
    }
    return out;
}

function videoJsonUrl(videoId) {
    const n = parseInt(videoId, 10);
    if (!isFinite(n)) return null;
    const m = Math.floor(n / 1000000) * 1000000;
    const k = Math.floor(n / 1000) * 1000;
    return API + "/json/video/86400/" + m + "/" + k + "/" + videoId + ".json";
}

function normId(raw) {
    let s = raw;
    if (Array.isArray(s)) s = s.length ? s[0] : "";
    s = str(s).trim();
    const dollar = s.lastIndexOf("$");
    if (dollar >= 0) s = s.slice(dollar + 1);
    return s.replace(/[^0-9]/g, "");
}

// ---------- idj1 contract ----------

async function home() {
    const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    const data = await getJsonSoft(videosUrl("latest-updates", 1), HOST + "/");
    const items = parseVideos(data);
    return {categories: categories, items: items, hasMore: items.length >= 60};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "latest-updates";
    const data = await getJsonSoft(videosUrl(tid, page), HOST + "/");
    const items = parseVideos(data);
    return {items: items, hasMore: items.length >= 60};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = API + "/videos2.php?params=86400/str/relevance/60/search..1.all...&s=" +
        encodeURIComponent(keyword);
    const data = await getJsonSoft(url, HOST + "/");
    const items = parseVideos(data).slice(0, 60);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const nid = normId(arg && arg.id);
    if (!nid) return {id: str(arg && arg.id), title: "", cover: "", desc: "", tags: [], lines: []};
    const url = videoJsonUrl(nid);
    if (!url) return {id: nid, title: "", cover: "", desc: "", tags: [], lines: []};
    const data = await getJsonSoft(url, HOST + "/");
    const video = data && data.video && typeof data.video === "object" ? data.video : null;
    if (!video) return {id: nid, title: "", cover: "", desc: "", tags: [], lines: []};
    const title = decodeEntities(textOf(video, ["title"]));
    if (!title) return {id: nid, title: "", cover: "", desc: "", tags: [], lines: []};
    const cover = textOf(video, ["thumbsrc"]) || textOf(video, ["thumb"]);
    const desc = decodeEntities(textOf(video, ["description"]));
    const duration = textOf(video, ["duration"]);
    const cats = [];
    const cmap = video.categories;
    if (cmap && typeof cmap === "object") {
        for (const key of Object.keys(cmap)) {
            const t = textOf(cmap[key], ["title"]);
            if (t) cats.push(t);
        }
    }
    const lines = [];
    if (cats.length) lines.push("分类：" + cats.join("、"));
    if (duration) lines.push("时长：" + duration);
    let synopsis = desc;
    if (lines.length) {
        if (synopsis) synopsis += "\n";
        synopsis += lines.join("\n");
    }
    synopsis = truncate(synopsis, 400);
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: synopsis,
        duration: duration,
        tags: cats,
        lines: [{
            name: "在线播放",
            episodes: [{id: nid, name: "正片"}],
        }],
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf(".mp4") >= 0) {
        return {
            streams: [{
                url: raw,
                format: "mp4",
                headers: {"User-Agent": UA, "Referer": HOST + "/"},
                name: "Senzuri Tube",
            }],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const vid = normId(raw);
    if (!vid) throw new Error("invalid play id");
    const referer = HOST + "/videos/" + vid + "/";
    const url = API + "/videofile.php?video_id=" + vid + "&lifetime=864000";
    const data = await getJson(url, referer);
    if (!Array.isArray(data) || !data.length) throw new Error("no play file");
    let chosen = null;
    for (const entry of data) {
        if (entry && typeof entry === "object" && String(entry.is_default) === "1") {
            chosen = entry;
            break;
        }
        if (!chosen && entry && typeof entry === "object") chosen = entry;
    }
    if (!chosen) throw new Error("no play file");
    const enc = textOf(chosen, ["video_url"]);
    if (!enc) throw new Error("no play file");
    const decoded = b164Decode(enc);
    if (!decoded || decoded.indexOf("get_file/") < 0) throw new Error("decode failed");
    let stream;
    if (decoded.indexOf("/") === 0) stream = HOST + decoded;
    else if (decoded.indexOf("http") === 0) stream = decoded;
    else stream = HOST + "/" + decoded;
    const playHeaders = {"User-Agent": UA, "Referer": referer};
    // Pre-resolve the HLS variant through the CDN redirects to the final
    // sub-playlist; if that fails, fall back to the direct mp4 from the py.
    try {
        const sep = stream.indexOf("?") >= 0 ? "&" : "?";
        const hlsUrl = stream + sep + "f=video.m3u8";
        const resp = await host.http.get(hlsUrl, {headers: headers(referer), timeout: TIMEOUT});
        if (resp && resp.url && /\.m3u8($|\?)/i.test(resp.url)) {
            return {
                streams: [{
                    url: resp.url,
                    format: "hls",
                    headers: playHeaders,
                    name: "Senzuri Tube",
                }],
                expiresAt: Date.now() + 3600 * 1000,
            };
        }
        if (resp && resp.body && resp.body.indexOf("#EXTM3U") === 0) {
            return {
                streams: [{
                    url: hlsUrl,
                    format: "hls",
                    headers: playHeaders,
                    name: "Senzuri Tube",
                }],
                expiresAt: Date.now() + 3600 * 1000,
            };
        }
    } catch (error) {
        // fall through to the direct mp4
    }
    return {
        streams: [{
            url: stream,
            format: "mp4",
            headers: playHeaders,
            name: "Senzuri Tube",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
