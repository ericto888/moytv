// AV Today — idj1 plugin (rewritten from the built-in py spider avtoday.py)
// Site: https://avtoday.io (traditional-Chinese section /cht/). Plain HTML scraping:
// list pages carry cards as data-spcode + background cover + video-title;
// detail pages carry og:title / og:image / description meta;
// the player page /player?s=<code> embeds var m3u8_url (fallback var video_link).
// The py spider's flag-word filter on category names is kept as-is.
// The site is slow through this egress (tens of seconds per page), so requests
// use a 60s timeout with 2 attempts.

const BASE = "https://avtoday.io";
const UA = "Mozilla/5.0 (Linux; Android 14; HarmonyOS; HUAWEI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const TIMEOUT = 60000;
const ATTEMPTS = 2;

// 16 categories, 1:1 with the py spider (name -> URL-encoded catalog slug).
const CATS = [
    ["中文字幕", "%E4%B8%AD%E6%96%87%E5%AD%97%E5%B9%95"],
    ["無碼", "%E7%84%A1%E7%A2%BC"],
    ["絲襪", "%E7%B5%B2%E8%A5%AA"],
    ["FC2", "FC2"],
    ["多人", "%E5%A4%9A%E4%BA%BA"],
    ["長腿", "%E9%95%B7%E8%85%BF"],
    ["巨乳", "%E5%B7%A8%E4%B9%B3"],
    ["自慰", "%E8%87%AA%E6%85%B0"],
    ["素人", "%E7%B4%A0%E4%BA%BA"],
    ["足交", "%E8%B6%B3%E4%BA%A4"],
    ["潮吹", "%E6%BD%AE%E5%90%B9"],
    ["痴女", "%E7%97%B4%E5%A5%B3"],
    ["熟女", "%E7%86%9F%E5%A5%B3"],
    ["制服", "%E5%88%B6%E6%9C%8D"],
    ["人妻", "%E4%BA%BA%E5%A6%BB"],
    ["泡泡浴", "%E6%B3%A1%E6%B3%A1%E6%B5%B4"],
];
const ENC = {};
for (const pair of CATS) ENC[pair[0]] = pair[1];

const FLAG_WORDS = [
    "loli", "lolita", "幼女", "幼齿", "初中生", "小学生", "未成年",
    "未满", "萝莉", "童颜", "幼态", "处女", "小萝莉",
];

function isFlagged(name) {
    const low = String(name || "").toLowerCase();
    return FLAG_WORDS.some((w) => low.indexOf(w.toLowerCase()) >= 0);
}

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function unescapeHtml(s) {
    if (!s) return "";
    return s.replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return BASE + u;
    return BASE + "/" + u;
}

async function fetchText(path, referer) {
    const url = /^https?:\/\//i.test(path) ? path : BASE + path;
    let lastError = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
            const resp = await host.http.get(url, {
                headers: {
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Referer": referer || (BASE + "/"),
                },
                timeout: TIMEOUT,
            });
            if (resp.status === 200 && resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) host.log("fetch failed: " + url + " " + (lastError.message || lastError));
    return "";
}

const CARD_RE = /data-spcode="([^"]+)"([\s\S]*?)video-title truncate">\s*<a[^>]*>([\s\S]*?)<\/a>/g;
const COVER_RE = /background:\s*url\('([^']+)'\)/;
const DUR_RE = /video-duration">\s*([^<]+?)\s*</;

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    let m;
    CARD_RE.lastIndex = 0;
    while ((m = CARD_RE.exec(html)) !== null) {
        const code = m[1].trim();
        if (!code || seen[code]) continue;
        const title = unescapeHtml(m[3].replace(/<[^>]*>/g, ""));
        if (!title) continue;
        seen[code] = true;
        const middle = m[2];
        let cover = "";
        const cm = COVER_RE.exec(middle);
        if (cm) cover = fixUrl(cm[1]);
        let duration = "";
        const dm = DUR_RE.exec(middle);
        if (dm) duration = dm[1].trim();
        out.push({
            id: "/cht/video/" + code + ".html",
            title: title,
            cover: cover,
            remarks: duration,
            duration: duration,
            tags: [],
        });
    }
    return out;
}

function metaContent(html, re) {
    if (!html) return "";
    const m = re.exec(html);
    return m ? unescapeHtml(m[1]) : "";
}

const TITLE_RE = /<meta property="og:title"[^>]*content="([^"]+)"/;
const COVER_META_RE = /<meta property="og:image"[^>]*content="([^"]+)"/;
const DESC_RE = /<meta name="description"[^>]*content="([^"]+)"/;
const TITLE_TAG_RE = /<title[^>]*>([\s\S]*?)<\/title>/;

function codeOf(pageUrl) {
    let code = str(pageUrl).split("/").pop() || "";
    if (code.slice(-5) === ".html") code = code.slice(0, -5);
    return code;
}

async function home() {
    const categories = CATS.filter((pair) => !isFlagged(pair[0]))
        .map((pair) => ({id: pair[0], name: pair[0]}));
    const html = await fetchText("/cht/index.html");
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id).trim();
    if (isFlagged(tid)) return {items: [], hasMore: false};
    const enc = ENC[tid] || ENC["巨乳"];
    const path = page <= 1
        ? "/cht/catalog/" + enc + ".html"
        : "/cht/catalog/" + enc + ".html?page=" + page;
    const html = await fetchText(path);
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const html = await fetchText("/search?s=" + encodeURIComponent(keyword).replace(/%20/g, "+"));
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const pageUrl = str(arg && arg.id).trim();
    if (!pageUrl) throw new Error("invalid video id");
    const html = await fetchText(pageUrl);
    let title = metaContent(html, TITLE_RE);
    if (!title) {
        title = metaContent(html, TITLE_TAG_RE);
        if (title.indexOf(" | AVToday") >= 0) title = title.split(" | AVToday")[0].trim();
    }
    if (!title) return {id: pageUrl, title: pageUrl, cover: "", desc: "", tags: [], lines: []};
    const cover = fixUrl(metaContent(html, COVER_META_RE));
    const desc = metaContent(html, DESC_RE);
    const code = codeOf(pageUrl);
    return {
        id: pageUrl,
        title: title,
        cover: cover,
        desc: desc,
        tags: [],
        lines: [{
            name: "在线播放",
            episodes: [{id: code, name: "播放"}],
        }],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id) || "");
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || "";
    if (!raw) throw new Error("invalid play id");
    if (/^https?:\/\//i.test(raw)) {
        return {
            streams: [{
                url: raw,
                format: /\.m3u8($|\?)/i.test(raw) ? "hls" : "mp4",
                headers: {"User-Agent": UA, "Referer": BASE + "/"},
                name: "AV Today",
            }],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const code = codeOf(raw);
    const html = await fetchText("/player?s=" + encodeURIComponent(code), BASE + "/");
    let url = "";
    if (html) {
        let m = /var m3u8_url\s*=\s*'([^']*)'/.exec(html);
        if (m && m[1].trim()) url = m[1].trim();
        if (!url) {
            m = /var video_link\s*=\s*'([^']*)'/.exec(html);
            if (m && m[1].trim()) url = m[1].trim();
        }
    }
    if (!url) throw new Error("no playable url found on player page");
    url = fixUrl(url);
    return {
        streams: [{
            url: url,
            format: /\.m3u8($|\?)/i.test(url) ? "hls" : "mp4",
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
            name: "AV Today",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home, category, search, detail, play};
