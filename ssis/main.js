// ssisJAV - idj1 plugin (rewritten from the built-in py spider ssis)
// Site: https://ssis1.cc ; pages carry an XOR-encrypted payload keyed by
// CRYPT_KEY, decrypted page holds window.__INITIAL_DATA__ JSON.

const BASE = "https://ssis1.cc";
const UA = "Mozilla/5.0 (Linux; Android 14; HarmonyOS; HUAWEI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const TIMEOUT = 58000;
const PAGE_SIZE = 24;

const CATS = [
    ["t14", "中文字幕"],
    ["t11", "亚洲有码"],
    ["t40", "制服丝袜"],
    ["t18", "亚洲无码"],
    ["t6", "日本精品"],
    ["t5", "女优系列"],
    ["t7", "巨乳美乳"],
    ["t15", "欧美精品"],
    ["t47", "过膝袜"],
    ["t17", "男同性恋"],
    ["t19", "传媒出品"],
    ["t33", "兽耳系列"],
    ["t27", "古装扮演"],
    ["t32", "瑜伽裤"],
    ["t28", "野外露出"],
    ["t34", "女同性恋"],
    ["t13", "韩国御姐"],
    ["t31", "可爱学生"],
    ["t21", "台湾辣妹"],
    ["t26", "唯美港姐"],
    ["t41", "闷骚护士"],
    ["t29", "多人多P"],
    ["t20", "伦理三级"],
    ["t3", "东南亚AV"],
    ["t25", "剧情介绍"],
    ["t12", "风情旗袍"],
    ["t10", "欺辱凌辱"],
    ["t8", "恋腿狂魔"],
    ["t36", "素人自拍"],
    ["t37", "网红流出"],
    ["t38", "自拍偷拍"],
    ["t30", "Cosplay"],
    ["t9", "口交颜射"],
    ["t24", "主播直播"],
    ["t43", "精品推荐"],
    ["t22", "网曝门"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function headers(referer) {
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
            const resp = await host.http.get(url, {headers: headers(referer), timeout: TIMEOUT});
            if (resp && resp.body) return resp.body;
            if (resp) lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("request failed");
}

async function getTextSoft(url, referer) {
    try {
        return await getText(url, referer);
    } catch (error) {
        return "";
    }
}

function decryptPage(html) {
    const text = html || "";
    const km = text.match(/CRYPT_KEY="([^"]+)"/);
    if (!km) return text;
    const pm = text.match(/h=decrypt\('([^']+)'\)/);
    if (!pm) return text;
    const key = km[1];
    if (!key) return text;
    let raw;
    try {
        raw = host.codec.base64Decode(pm[1], {to: "latin1"});
    } catch (error) {
        return text;
    }
    let out = "";
    for (let i = 0; i < raw.length; i++) {
        out += String.fromCharCode((raw.charCodeAt(i) & 0xff) ^ (key.charCodeAt(i % key.length) & 0xff));
    }
    try {
        return host.codec.convert(out, "latin1", "utf8");
    } catch (error) {
        return out;
    }
}

function initialData(html) {
    const marker = "window.__INITIAL_DATA__ = ";
    const start0 = (html || "").indexOf(marker);
    if (start0 < 0) return null;
    const start = start0 + marker.length;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < html.length; i++) {
        const ch = html[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === "\\") esc = true;
            else if (ch === '"') inStr = false;
        } else if (ch === '"') {
            inStr = true;
        } else if (ch === "{") {
            depth += 1;
        } else if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
                try {
                    return JSON.parse(html.slice(start, i + 1));
                } catch (error) {
                    return null;
                }
            }
        }
    }
    return null;
}

function txtOf(v, keys) {
    if (!v || typeof v !== "object") return "";
    for (const k of keys) {
        const val = v[k];
        if (typeof val === "string" && val) return val;
        if (typeof val === "number") return String(val);
    }
    return "";
}

function videosToItems(data) {
    const out = [];
    if (!data || typeof data !== "object" || !Array.isArray(data.videos)) return out;
    for (const v of data.videos) {
        if (!v || typeof v !== "object") continue;
        const title = txtOf(v, ["title"]);
        const vid = txtOf(v, ["id"]);
        if (!title || !vid) continue;
        const cover = txtOf(v, ["thumb"]);
        const date = txtOf(v, ["date"]);
        const tag = txtOf(v, ["tag", "code", "category"]);
        let remark = "";
        if (date && tag) remark = date + " · " + tag;
        else remark = date || tag;
        const item = {id: "/watch?id=" + vid, title: title, remarks: remark};
        if (cover) item.cover = cover;
        out.push(item);
    }
    return out;
}

function unescapeHtml(s) {
    return String(s || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
}

function parseCards(html) {
    const out = [];
    const seen = {};
    const pat = /<a[^>]*href="\/watch\?id=(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = pat.exec(html || "")) !== null) {
        const vid = "/watch?id=" + m[1];
        if (seen[vid]) continue;
        seen[vid] = true;
        const body = m[2];
        const tm = body.match(/alt="([^"]+)"/);
        const title = tm ? unescapeHtml(tm[1].trim()) : "";
        if (!title) continue;
        const cm = body.match(/<img[^>]*src="([^"]+)"/);
        const dm = body.match(/(\d{4}-\d{2}-\d{2})/);
        const item = {id: vid, title: title, remarks: dm ? dm[1] : ""};
        if (cm) item.cover = cm[1];
        out.push(item);
    }
    return out;
}

function liveCats(html) {
    const out = [];
    const seen = {};
    const push = (num, name) => {
        const n = str(name);
        if (!n || n === "首页" || n === "分类" || n === "公告" || n === "搜索") return;
        const cid = "t" + num;
        if (seen[cid]) return;
        seen[cid] = true;
        out.push([cid, n]);
    };
    let m;
    const nav = /<a href="\/topic\?id=(\d+)"[^>]*>([^<]+)<\/a>/g;
    while ((m = nav.exec(html || "")) !== null) push(m[1], m[2]);
    const grid = /<a class="iw-cat-card" href="\/topic\?id=(\d+)"[\s\S]*?<span class="iw-cat-name">([^<]+)<\/span>/g;
    while ((m = grid.exec(html || "")) !== null) push(m[1], m[2]);
    return out;
}

let catsCache = null;

async function fetchCats() {
    if (catsCache) return catsCache;
    const html = await getTextSoft(BASE + "/genres", BASE + "/");
    if (html) {
        const live = liveCats(decryptPage(html));
        if (live.length) {
            catsCache = live;
            return catsCache;
        }
    }
    return CATS.map((c) => [c[0], c[1]]);
}

function topicNum(tid) {
    let t = str(tid);
    if (t.charAt(0) === "t") t = t.slice(1);
    return t;
}

function watchId(raw) {
    const s = str(raw);
    const m = s.match(/id=(\d+)/);
    if (m) return m[1];
    return s.replace(/^\//, "").replace(/^watch/, "").replace(/^\?/, "");
}

async function home() {
    const cats = await fetchCats();
    const categories = cats.map((c) => ({id: c[0], name: c[1]}));
    let items = [];
    try {
        const r = await category({id: cats[0][0], page: 1});
        items = r.items || [];
    } catch (error) {
        items = [];
    }
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const num = topicNum(arg && arg.id);
    const url = BASE + "/topic?id=" + encodeURIComponent(num) + "&page=" + page;
    const html = await getTextSoft(url, BASE + "/");
    const inner = decryptPage(html);
    const data = initialData(inner);
    let items;
    let total = 0;
    let hasMore;
    if (data !== null) {
        items = videosToItems(data);
        total = intValue(data.total, 0);
        if (total > 0) hasMore = page * PAGE_SIZE < total;
        else hasMore = !!items.length && inner.indexOf("page=" + (page + 1)) >= 0;
    } else {
        items = parseCards(inner);
        hasMore = !!items.length && inner.indexOf("page=" + (page + 1)) >= 0;
    }
    return {items: items, hasMore: hasMore};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/search?q=" + encodeURIComponent(keyword) + "&page=1";
    const html = await getTextSoft(url, BASE + "/");
    const inner = decryptPage(html);
    const data = initialData(inner);
    const items = data !== null ? videosToItems(data) : parseCards(inner);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const vid = watchId(raw);
    if (!vid) throw host.error("E_PARSE", "invalid detail id");
    const url = BASE + "/watch?id=" + encodeURIComponent(vid);
    const html = await getText(url, BASE + "/");
    const inner = decryptPage(html);
    const data = initialData(inner);
    if (!data || typeof data !== "object") throw host.error("E_PARSE", "detail data missing");
    const video = data.video;
    if (!video || typeof video !== "object") throw host.error("E_PARSE", "detail video missing");
    const title = txtOf(video, ["title"]);
    let m3u8 = txtOf(video, ["videoUrl"]) || txtOf(video, ["magnet"]);
    if (!m3u8) {
        const m = inner.match(/data-video-url="([^"]+\.m3u8[^"]*)"/);
        if (m) m3u8 = m[1];
    }
    if (!title || !m3u8) throw host.error("E_PARSE", "detail title or stream missing");
    const cover = txtOf(video, ["thumb"]);
    const out = {
        id: "/watch?id=" + vid,
        title: title,
        desc: txtOf(video, ["desc"]),
        tags: [],
        lines: [{name: "在线播放", episodes: [{id: m3u8, name: "播放"}]}],
    };
    if (cover) out.cover = cover;
    return out;
}

async function resolveMaster(url, hdrs) {
    try {
        const resp = await host.http.get(url, {headers: hdrs, timeout: TIMEOUT});
        if (!resp || !resp.body || resp.body.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = resp.body.split(/\r?\n/);
        let best = "";
        let bestBw = -1;
        let pendingBw = 0;
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
                const bm = line.match(/BANDWIDTH=(\d+)/);
                pendingBw = bm ? parseInt(bm[1], 10) : 0;
            } else if (line && line.charAt(0) !== "#") {
                if (!best || pendingBw > bestBw) {
                    best = line;
                    bestBw = pendingBw;
                }
                pendingBw = 0;
            }
        }
        if (best) return host.url.resolve(url, best);
        return url;
    } catch (error) {
        return url;
    }
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || "";
    if (!raw || raw.indexOf("http") !== 0) throw host.error("E_PARSE", "no playable url");
    const hdrs = {"User-Agent": UA, "Referer": BASE + "/"};
    let url = raw;
    if (/\.m3u8($|\?)/i.test(url)) {
        url = await resolveMaster(url, hdrs);
    }
    const isHls = /\.m3u8($|\?)/i.test(url);
    return {
        streams: [{
            url: url,
            format: isHls ? "hls" : "mp4",
            headers: hdrs,
            name: "ssisJAV",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
