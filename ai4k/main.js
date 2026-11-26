// 4K.AI短剧 — idj1 插件（由内置 py 蜘蛛 ai4k 改写）
// 站点：https://wyswspqjtr.click（MacCMS 风格 HTML 站，无接口、无加密）
// 列表/详情/播放全是服务端 HTML：
// - 首页与分类页用 <article class="card"> 卡片（/info/id/<id>.html + 封面 + 标题）
// - 分类从首页 <nav class="site-nav"> 里的 /type/id/<id>.html 动态取，取不到用内置兜底表
// - 详情页 /info/id/<id>.html 取标题/封面/简介（meta description）
// - 播放页 /play/id/<id>.html 里有 playUrl = '<m3u8>'，现取现用
// 与原 py 一致：带旗标词的分类名过滤掉（兜底表本身不含旗标分类）。

const BASE = "https://wyswspqjtr.click";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 55000;

const FALLBACK_CATS = [
    ["7", "中文字幕"],
    ["8", "国产传媒"],
    ["9", "日本有码"],
    ["10", "日本无码"],
    ["11", "欧美无码"],
    ["12", "强奸乱伦"],
    ["13", "制服诱惑"],
    ["14", "国产主播"],
    ["15", "激情动漫"],
    ["16", "明星换脸"],
    ["17", "抖阴视频"],
    ["18", "女优明星"],
    ["22", "网曝黑料"],
    ["26", "伦理三级"],
    ["28", "AV解说"],
    ["31", "SM调教"],
    ["34", "极品媚黑"],
    ["37", "女同性恋"],
    ["39", "网红头条"],
    ["43", "人妖系列"],
    ["45", "韩国主播"],
    ["47", "VR视角"],
];

const FLAG_WORDS = [
    "loli", "lolita", "幼女", "幼齿", "初中生", "小学生", "未成年",
    "未满", "萝莉", "童颜", "幼态", "处女", "小萝莉",
];

function isFlagged(name) {
    const low = String(name || "").toLowerCase();
    for (const w of FLAG_WORDS) {
        if (low.indexOf(w.toLowerCase()) >= 0) return true;
    }
    return false;
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
    return str(s)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\\\//g, "/");
}

function stripTags(s) {
    return unescapeHtml(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return BASE + u;
    return u;
}

function digitsOnly(raw) {
    return str(raw).replace(/[^0-9]/g, "");
}

// ---------- HTTP ----------

async function fetchText(path, referer) {
    const url = BASE + path;
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": referer || (BASE + "/"),
    };
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp.status === 200 && resp.body && resp.body.length > 2048) return resp.body;
            lastError = new Error("HTTP " + resp.status + " len=" + (resp.body ? resp.body.length : 0));
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return "";
}

// ---------- 解析 ----------

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const pat = /<article class="card">[\s\S]*?<a[^>]*href="\/info\/id\/(\d+)\.html"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<h2 class="card-title"[^>]*>([\s\S]*?)<\/h2>/g;
    const seen = {};
    let m;
    while ((m = pat.exec(html)) !== null) {
        const vid = m[1];
        const title = unescapeHtml(m[3]).trim();
        if (!vid || seen[vid] || !title) continue;
        seen[vid] = true;
        out.push({
            id: vid,
            title: title,
            cover: fixUrl(m[2]),
            remarks: "",
            duration: "",
            tags: [],
        });
    }
    return out;
}

let catsCache = null;

function parseCategories(html) {
    const cats = [];
    if (html) {
        let nav = html;
        const i = html.indexOf("<nav class=\"site-nav\"");
        if (i >= 0) {
            const j = html.indexOf("</nav>", i);
            if (j > i) nav = html.slice(i, j);
        }
        const pat = /href="\/type\/id\/(\d+)\.html"[^>]*>([^<]+)<\/a>/g;
        const seen = {};
        let m;
        while ((m = pat.exec(nav)) !== null) {
            const cid = m[1];
            const name = m[2].trim();
            if (!name || seen[cid]) continue;
            seen[cid] = true;
            cats.push([cid, name]);
        }
    }
    return cats;
}

async function fetchCategories(prefetchedHtml) {
    if (catsCache) return catsCache;
    let cats = [];
    try {
        const html = prefetchedHtml != null ? prefetchedHtml : await fetchText("/");
        cats = parseCategories(html);
    } catch (error) {
        cats = [];
    }
    if (!cats.length) cats = FALLBACK_CATS.slice();
    cats = cats.filter((c) => !isFlagged(c[1]));
    catsCache = cats;
    return cats;
}

function parseTitle(html) {
    const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html || "");
    if (!m) return "";
    let raw = unescapeHtml(m[1]).trim();
    const suf = " - 详情页";
    if (raw.slice(-suf.length) === suf) raw = raw.slice(0, raw.length - suf.length);
    return raw.trim();
}

function parseCover(html) {
    let m = /<div class="detail-cover">[\s\S]*?<img[^>]+src="([^"]+)"/.exec(html || "");
    if (m) return fixUrl(m[1]);
    m = /<img[^>]+src="(https?:\/\/[^"]+)"/.exec(html || "");
    if (m) return fixUrl(m[1]);
    return "";
}

function parseSynopsis(html) {
    const m = /<meta name="description"[^>]*content="([^"]+)"/.exec(html || "");
    if (!m) return "";
    return unescapeHtml(m[1]).trim();
}

function parsePlayerUrl(html) {
    if (!html) return "";
    const m = /playUrl\s*=\s*'([^']+)'/.exec(html);
    if (m) return unescapeHtml(m[1]).trim();
    return "";
}

// ---------- idj1 契约 ----------

async function home() {
    let html = "";
    try {
        html = await fetchText("/");
    } catch (error) {
        html = "";
    }
    const cats = await fetchCategories(html);
    const categories = cats.map((c) => ({id: c[0], name: c[1]}));
    const items = html ? parseCards(html) : [];
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const tid = str(arg && arg.id);
    const page = Math.max(1, intValue(arg && arg.page, 1));
    if (!tid) return {items: [], hasMore: false};
    const cats = await fetchCategories();
    for (const c of cats) {
        if (c[0] === tid && isFlagged(c[1])) return {items: [], hasMore: false};
    }
    const path = page <= 1 ? ("/type/id/" + tid + ".html") : ("/type/id/" + tid + "/" + page + ".html");
    let items = [];
    try {
        items = parseCards(await fetchText(path));
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let items = [];
    try {
        items = parseCards(await fetchText("/hunt/" + encodeURIComponent(keyword) + ".html"));
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const nid = digitsOnly(arg && arg.id);
    if (!nid) throw new Error("无效的影片 ID");
    let html = "";
    try {
        html = await fetchText("/info/id/" + nid + ".html");
    } catch (error) {
        html = "";
    }
    const title = html ? parseTitle(html) : "";
    if (!title) {
        return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    }
    return {
        id: nid,
        title: title,
        cover: parseCover(html),
        desc: parseSynopsis(html),
        tags: [],
        lines: [{
            name: "在线播放",
            episodes: [{id: "ai4k:" + nid, name: "播放"}],
        }],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
    if (raw.indexOf("ai4k:") === 0) raw = raw.slice("ai4k:".length);
    let playUrl = "";
    let referer = BASE + "/";
    if (/^https?:\/\//i.test(raw) && raw.toLowerCase().indexOf(".m3u8") >= 0) {
        playUrl = raw;
    } else {
        const nid = digitsOnly(raw);
        if (!nid) throw new Error("无效的播放 ID");
        const playPage = "/play/id/" + nid + ".html";
        const html = await fetchText(playPage);
        playUrl = parsePlayerUrl(html);
        referer = BASE + playPage;
        if (!playUrl) throw new Error("播放页未找到 playUrl");
    }
    const isHls = /\.m3u8($|\?)/i.test(playUrl);
    return {
        streams: [{
            url: playUrl,
            format: isHls ? "hls" : "video",
            headers: {"User-Agent": UA, "Referer": referer},
            name: "在线播放",
        }],
        expiresAt: Date.now() + 30 * 60 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
