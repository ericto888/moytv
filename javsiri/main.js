// JAVSiri (javsiri.cc) - idj1 plugin, 1:1 port of the builtin py spider.
// Server-rendered KVS catalog pages; the detail page carries flashvars
// (video_title / video_categories / video_url). The video_url is a
// get_file mp4 link gated by the kt_acctoken cookie that the detail
// response sets: play re-reads that cookie from the detail response and
// hands it to the player in the stream headers, and get_file then 302s
// to the cloud.javsiri.cc CDN, whose final URL needs no cookie.

const BASE = "https://javsiri.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    ["latest", "最新"],
    ["top-rated", "最高评分"],
    ["popular", "最多观看"],
    ["cat:amateur", "Amateur"],
    ["cat:censored", "Censored"],
    ["cat:fc2ppv", "FC2PPV"],
    ["cat:jav-uncensored", "Uncensored"],
];

const CARD_MARK = 'href="https://javsiri.cc/video/';

function str(value) {
    if (value == null) return "";
    return String(value);
}

function decodeEntities(s) {
    if (!s) return "";
    return str(s)
        .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
}

function cleanText(s) {
    if (!s) return "";
    return decodeEntities(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function trunc(s, n) {
    s = str(s || "");
    return s.length > n ? s.slice(0, n) : s;
}

function normPg(pg) {
    const n = parseInt(pg, 10);
    return isFinite(n) && n >= 1 ? n : 1;
}

async function rawRequest(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    };
    if (referer) headers["Referer"] = referer;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.request({
                url: url, method: "GET", headers: headers, body: "", timeout: TIMEOUT,
            });
            if (resp && resp.status === 200 && resp.body) return resp;
            if (resp && resp.body) return resp;
            if (resp) return resp;
        } catch (error) {
            lastErr = error;
        }
    }
    if (lastErr) throw lastErr;
    return {status: 0, url: url, headers: {}, body: ""};
}

async function getHtml(url, referer) {
    try {
        const resp = await rawRequest(url, referer || (BASE + "/"));
        return resp.body || "";
    } catch (error) {
        return "";
    }
}

function parseCards(html) {
    const out = [];
    const seen = {};
    const parts = str(html || "").split(CARD_MARK);
    for (let i = 1; i < parts.length; i++) {
        const block = parts[i];
        const q = block.indexOf('"');
        if (q < 0) continue;
        const path = block.slice(0, q);
        const vid = path.split("/")[0] || "";
        if (!vid || !/^\d+$/.test(vid)) continue;
        const vidUrl = BASE + "/video/" + path;
        if (seen[vidUrl]) continue;
        let title = "";
        let p = block.indexOf('title="');
        if (p >= 0) {
            const s = p + 7;
            const e = block.indexOf('"', s);
            if (e >= 0) title = decodeEntities(block.slice(s, e));
        }
        let cover = "";
        p = block.indexOf('data-original="');
        if (p >= 0) {
            const s = p + 15;
            const e = block.indexOf('"', s);
            if (e >= 0) {
                const src = block.slice(s, e);
                if (src.indexOf("//") === 0) cover = "https:" + src;
                else if (src.indexOf("http") === 0) cover = src;
                else cover = BASE + src;
            }
        }
        if (!title) {
            p = block.indexOf('alt="');
            if (p >= 0) {
                const s = p + 5;
                const e = block.indexOf('"', s);
                if (e >= 0) title = decodeEntities(block.slice(s, e));
            }
        }
        if (!title) continue;
        let remark = "";
        p = block.indexOf('<div class="time">');
        if (p >= 0) {
            const s = p + 18;
            const e = block.indexOf("</div>", s);
            if (e >= 0) remark = block.slice(s, e).trim();
        }
        seen[vidUrl] = true;
        out.push({id: vidUrl, title: trunc(title, 90), cover: cover, remarks: remark, tags: []});
    }
    return out;
}

function catalogUrl(tid, pg) {
    function paged(base) {
        if (pg <= 1) return base;
        return base + pg + "/";
    }
    if (tid === "latest") return paged(BASE + "/latest-updates/");
    if (tid === "top-rated") return paged(BASE + "/top-rated/");
    if (tid === "popular") return paged(BASE + "/most-popular/");
    if (tid.indexOf("cat:") === 0) return paged(BASE + "/categories/" + tid.slice(4) + "/");
    return paged(BASE + "/latest-updates/");
}

function flashvar(html, name) {
    const marker = name + ": '";
    const p = str(html || "").indexOf(marker);
    if (p < 0) return "";
    const s = p + marker.length;
    let out = "";
    for (let i = s; i < html.length; i++) {
        const ch = html.charAt(i);
        if (ch === "\\" && i + 1 < html.length) {
            out += html.charAt(i + 1);
            i++;
            continue;
        }
        if (ch === "'") break;
        out += ch;
    }
    return out;
}

function tagTitle(html) {
    const p = str(html || "").indexOf("<title>");
    if (p < 0) return "";
    const s = p + 7;
    const e = html.indexOf("</title>", s);
    let t = decodeEntities(e >= 0 ? html.slice(s, e) : html.slice(s));
    const seps = [" - JAVSiri", " | JAVSiri"];
    for (const sep of seps) {
        const i = t.lastIndexOf(sep);
        if (i >= 0) return t.slice(0, i).trim();
    }
    return t;
}

function metaContent(html, attr, key) {
    const marker = attr + '="' + key + '"';
    const p = str(html || "").indexOf(marker);
    if (p < 0) return "";
    const after = html.slice(p);
    const c = after.indexOf('content="');
    if (c < 0) return "";
    const s = c + 9;
    const e = after.indexOf('"', s);
    if (e < 0) return "";
    return decodeEntities(after.slice(s, e));
}

function cookieFromHeaders(headers) {
    const sc = str((headers || {})["set-cookie"] || "");
    if (!sc) return "";
    const pairs = [];
    const names = ["kt_acctoken", "kt_qparams", "PHPSESSID"];
    for (const name of names) {
        const m = new RegExp(name + "=([^;,]+)").exec(sc);
        if (m) pairs.push(name + "=" + m[1]);
    }
    return pairs.join("; ");
}

async function home() {
    const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    const html = await getHtml(catalogUrl(CATS[0][0], 1), BASE + "/");
    return {categories: categories, items: parseCards(html), hasMore: false};
}

async function category(arg) {
    const tid = str(arg && arg.id) || "latest";
    const pg = normPg(arg && arg.page);
    const html = await getHtml(catalogUrl(tid, pg), BASE + "/");
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/search/?q=" + encodeURIComponent(keyword);
    const html = await getHtml(url, BASE + "/");
    return {items: parseCards(html).slice(0, 60), hasMore: false};
}

async function detail(arg) {
    const nid = str(arg && arg.id).trim();
    if (!nid) throw host.error("E_PARSE", "empty detail id");
    const pageUrl = nid.indexOf("http") === 0 ? nid : BASE + nid;
    const html = await getHtml(pageUrl, BASE + "/");
    if (!html) throw host.error("E_NETWORK", "detail page fetch failed");
    let title = flashvar(html, "video_title");
    if (!title) title = tagTitle(html);
    if (!title) throw host.error("E_PARSE", "detail title not found");
    const cover = metaContent(html, "property", "og:image");
    const cats = flashvar(html, "video_categories");
    const parts = [];
    if (cats) parts.push("分类：" + cats);
    return {
        id: pageUrl,
        title: title,
        cover: cover,
        desc: parts.join("\n"),
        tags: cats ? [cats] : [],
        lines: [{
            name: "在线播放",
            episodes: [{id: pageUrl, name: trunc(title, 60)}],
        }],
    };
}

async function resolveMaster(streamUrl, headers) {
    try {
        const resp = await rawRequest(streamUrl, headers && headers["Referer"]);
        const text = resp.body || "";
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return streamUrl;
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s.charAt(0) !== "#");
        if (lines.length) return host.url.resolve(streamUrl, lines[0]);
    } catch (error) {
        // Keep the master URL; the player can still walk it.
    }
    return streamUrl;
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    if (!raw) throw host.error("E_PARSE", "empty play id");
    const plainHeaders = {"User-Agent": UA, "Referer": BASE + "/"};
    if (raw.indexOf("http") === 0 && raw.indexOf(".mp4") >= 0) {
        return {
            streams: [{url: raw, format: "mp4", headers: plainHeaders, name: "在线播放"}],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const pageUrl = raw.split("$").pop().trim();
    let resp;
    try {
        resp = await rawRequest(pageUrl, BASE + "/");
    } catch (error) {
        throw host.error("E_NETWORK", "play page fetch failed: " + (error && error.message));
    }
    const html = resp.body || "";
    const url = flashvar(html, "video_url");
    if (!url || url.indexOf("http") !== 0 || url.indexOf(".mp4") < 0) {
        throw host.error("E_PARSE", "play returned no mp4 url");
    }
    const headers = {"User-Agent": UA, "Referer": pageUrl};
    const cookie = cookieFromHeaders(resp.headers);
    if (cookie) headers["Cookie"] = cookie;
    const isHls = /\.m3u8($|\?)/i.test(url);
    const finalUrl = isHls ? await resolveMaster(url, headers) : url;
    return {
        streams: [{
            url: finalUrl, format: isHls ? "hls" : "mp4",
            headers: headers, name: "在线播放",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
