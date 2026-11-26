// xHamster — idj1 插件（2026-11-24 摸站，纯 HTML + 内嵌 JSON，无 API）
// 站点：https://xhamster.com
// 首页 / 是年龄验证墙（无视频），插件 home() 改用 /newest 作首页 feed。
// 列表：分类页 / 搜索页内嵌 JSON 的 videoThumbProps 数组（46 条/页，字段 id、
// duration（秒）、title、pageURL、thumbURL、imageURL）；插件用括号计数法
// 抠出第一个 videoThumbProps 数组再 JSON.parse（字符串里有括号，必须跳过
// 引号与转义，不能用懒惰正则）。
// 分类翻页路径式：/categories/<slug>/2、/3…（?page=2 回空页，无效）；
// 最新翻页同款：/newest/2（2026-11-24 实测 200 有列表）。
// 详情：页内 "sources" 里的地址是加密 hex token，不可用；页内另有唯一一条
// m3u8（xhcdn.com，6 档 144p–2160p，签名约 2 小时过期），插件 play() 现取现解。
// 详情页广告 URL 里含该视频的 tags 原文（含 "18 Tight Pussy"、"18 Years"、
// "Cute Teen"、"Skinny Teen"、"Teen Babe" 等），插件不取广告 tags，详情 tags 留空。
//
// 分类：最新 + /categories 页内嵌 JSON trending.items 精选 12 个
// = 13 个。"18 Year Old" 为站方原名（slug 18-year-old），逐字保留。
// /categories 页另有 655 个 slug 的全量索引（含国籍等），不采用。
//
// 相对“从零摸站”丢掉 / 降级的能力：
// - 搜索翻页未验证：搜索第 2 页以后用 ?page= 拼，站方是否认这个参数未实测，
//   探针只验第 1 页；手机上翻页若为空即为本站方不支持，插件不伪造。
// - 详情页的女优/分类/tags 不解析（页内结构不稳定），详情 tags 留空。
// - 列表封面用 thumbURL（526x298 webp），不用 imageURL 大图（省流量）。
// - 详情页首次抓取曾拿到 49KB 截断体（无 mp4/m3u8），重抓才完整；插件
//   拿不到 m3u8 时抛错，不回 SFW 预告或空流。

const SITE = "https://xhamster.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 20000;
const PAGE_SIZE = 46;

const FIXED = [["newest", "最新"]];
const CATS = [
    ["amateur", "Amateur"],
    ["mature", "Mature"],
    ["homemade", "Homemade"],
    ["anal", "Anal"],
    ["bbw", "BBW"],
    ["granny", "Granny"],
    ["18-year-old", "18 Year Old"],
    ["american", "American"],
    ["lesbian", "Lesbian"],
    ["asian", "Asian"],
    ["creampie", "Creampie"],
    ["mom", "Mom"],
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function cleanText(value) {
    return str(value)
        .replace(/<[^>]*>/g, " ")
        .replace(/&#(\d+);/g, function (m, code) { return String.fromCharCode(parseInt(code, 10)); })
        .replace(/&#x([0-9a-fA-F]+);/g, function (m, code) { return String.fromCharCode(parseInt(code, 16)); })
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

function firstMatch(text, regex, index) {
    const match = regex.exec(text || "");
    return match ? str(match[index == null ? 1 : index]) : "";
}

function fmtDuration(seconds) {
    let total = 0;
    try { total = parseInt(seconds, 10); } catch (error) { total = 0; }
    if (!total || total <= 0) return "";
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    if (h) return h + ":" + pad(m) + ":" + pad(s);
    return m + ":" + pad(s);
}

async function fetchText(path) {
    const url = path.indexOf("http") === 0 ? path : SITE + path;
    const resp = await host.http.request({
        url: url,
        method: "GET",
        headers: {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": SITE + "/",
        },
        timeout: TIMEOUT,
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
    const body = resp.body == null ? "" : String(resp.body);
    if (body.length < 2000) throw new Error("body too small");
    if (body.toLowerCase().indexOf("just a moment") >= 0 && body.length < 12000) {
        throw new Error("cloudflare challenge");
    }
    return body;
}

// 抠出页内第一个 videoThumbProps 数组（跳过字符串与转义，括号计数）。
function extractVideoList(html) {
    const key = "videoThumbProps";
    let idx = (html || "").indexOf(key);
    if (idx < 0) return [];
    let start = (html || "").indexOf("[", idx);
    if (start < 0) return [];
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let i = start; i < html.length; i++) {
        const ch = html[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === "\\") esc = true;
            else if (ch === '"') inStr = false;
        } else {
            if (ch === '"') inStr = true;
            else if (ch === "[") depth++;
            else if (ch === "]") {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
    }
    if (end < 0) return [];
    let arr = null;
    try { arr = JSON.parse(html.slice(start, end + 1)); } catch (error) { arr = null; }
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const v of arr) {
        if (!v || !v.pageURL) continue;
        const dur = fmtDuration(v.duration);
        out.push({
            id: str(v.pageURL),
            title: v.title || str(v.pageURL),
            cover: v.thumbURL || v.imageURL || "",
            remarks: dur,
            duration: dur,
            tags: [],
        });
    }
    return out;
}

function extractM3u8(html) {
    const text = html || "";
    const regex = /https?:\/\/[a-z0-9.\-]*xhcdn\.com\/[^"\\]*\.m3u8[^"\\]*/gi;
    let m;
    while ((m = regex.exec(text)) !== null) {
        const url = m[0].replace(/\\\//g, "/").replace(/\\u0026/gi, "&");
        if (url.indexOf("master") >= 0 || url.indexOf("multi=") >= 0 || /\.m3u8/.test(url)) return url;
    }
    return "";
}

function allCategories() {
    const list = [];
    for (const row of FIXED) list.push({id: row[0], name: row[1]});
    for (const row of CATS) list.push({id: "cat@@" + row[0], name: row[1]});
    return list;
}

// ---------- idj1 契约 ----------

async function home() {
    let items = [];
    try {
        items = extractVideoList(await fetchText("/newest"));
    } catch (error) {
        items = [];
    }
    return {categories: allCategories(), items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, parseInt((arg && arg.page) || "1", 10) || 1);
    const tid = str(arg && arg.id);
    let items = [];
    try {
        if (tid === "newest") {
            const path = page === 1 ? "/newest" : "/newest/" + page;
            items = extractVideoList(await fetchText(path));
        } else if (tid.indexOf("cat@@") === 0) {
            const slug = tid.slice(5);
            const path = page === 1 ? "/categories/" + slug : "/categories/" + slug + "/" + page;
            items = extractVideoList(await fetchText(path));
        } else {
            items = extractVideoList(await fetchText("/newest"));
        }
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: items.length >= PAGE_SIZE};
}

async function search(arg) {
    const page = Math.max(1, parseInt((arg && arg.page) || "1", 10) || 1);
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let items = [];
    try {
        let path = "/search?q=" + encodeURIComponent(keyword);
        if (page > 1) path += "&page=" + page;
        items = extractVideoList(await fetchText(path));
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: items.length >= PAGE_SIZE};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    if (!rawId) throw new Error("无效的影片 ID");
    const url = rawId.indexOf("http") === 0 ? rawId : SITE + rawId;
    let html = "";
    try {
        html = await fetchText(url);
    } catch (error) {
        html = "";
    }
    let title = cleanText(firstMatch(html, /property="og:title"\s+content="([^"]+)"/i));
    if (!title) title = cleanText(firstMatch(html, /<title>([\s\S]*?)<\/title>/i));
    const cover = firstMatch(html, /property="og:image"\s+content="([^"]+)"/i);
    const m3u8 = extractM3u8(html);
    const episodes = m3u8 ? [{id: m3u8, name: "正片"}] : [{id: url, name: "播放"}];
    return {
        id: rawId,
        title: title || rawId,
        cover: cover,
        desc: "",
        duration: "",
        tags: [],
        lines: [{name: "xHamster", episodes: episodes}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    if (!raw) throw new Error("无效的播放地址");
    if (/\.m3u8/i.test(raw)) {
        return {
            streams: [{
                url: raw,
                format: "hls",
                headers: {"User-Agent": UA, "Referer": SITE + "/"},
                name: "xHamster",
            }],
        };
    }
    const url = raw.indexOf("http") === 0 ? raw : SITE + raw;
    const html = await fetchText(url);
    const m3u8 = extractM3u8(html);
    if (!m3u8) throw new Error("未找到可用播放地址");
    return {
        streams: [{
            url: m3u8,
            format: "hls",
            headers: {"User-Agent": UA, "Referer": SITE + "/"},
            name: "xHamster",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
