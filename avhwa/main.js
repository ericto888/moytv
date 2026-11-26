// AVHWA — idj1 插件（由内置 py 蜘蛛 avhwa.py 改写）
// 站点：https://avhwa.com，服务端 HTML 直出，无接口、无加密签名。
// 列表页卡片在 <div class="thumb thumb_rel item ..."> 块里（标题/封面 data-original/时长）；
// 详情页 og:title / og:image / description；播放地址在详情页脚本里：
// video_url: '<base64>' 解码得 https://avhwa.com/get_file/.../xxx.mp4/?br=...，
// 该地址 302 跳到 wwww1.tubegifs.com 的签名 mp4 直链（HEAD 跟随跳转取最终地址）。
// 原 py 的旗标过滤（分类名含敏感词剔除）照搬；11 个分类名均不命中，分类 1:1 全保留。
// 本机出口慢：超时 55 秒、失败重试共 2 次尝试。

const BASE = "https://avhwa.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 55000;
const ATTEMPTS = 2;

const CATS = [
    ["vip", "KVIP"],
    ["jvip", "JVIP"],
    ["korean-porn", "Korean Porn"],
    ["korean-bj", "Korean BJ"],
    ["fc2ppv", "FC2PPV"],
    ["jav", "Uncensored"],
    ["voyeur-jp", "Voyeur JP"],
    ["china", "CHINA"],
    ["myfans", "myfans"],
    ["asian-leak", "Asian Leak"],
    ["mib", "MIB"],
];

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
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function unescapeHtml(s) {
    return str(s)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("/") === 0) return BASE + u;
    return BASE + "/" + u;
}

// ---------- HTTP：GET 页面，200 才算成功，失败重试 ----------

async function fetchPage(url) {
    let lastError = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
            const resp = await host.http.get(url, {
                headers: {
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Referer": BASE + "/",
                },
                timeout: TIMEOUT,
            });
            if (resp.status === 200 && resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) host.log("fetch fail", url, str(lastError && lastError.message));
    return "";
}

// ---------- 解析（与原 py 的字符串切分逻辑一一对应） ----------

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    const blocks = html.split('<div class="thumb thumb_rel item');
    for (let i = 1; i < blocks.length; i++) {
        let block = blocks[i];
        const next = block.indexOf('<div class="thumb thumb_rel item');
        if (next >= 0) block = block.slice(0, next);
        const p = block.indexOf('<a href="https://avhwa.com/video/');
        if (p < 0) continue;
        const s = p + 9;
        const e = block.indexOf('"', s);
        if (e < 0) continue;
        const href = block.slice(s, e).trim();
        if (!href || seen[href]) continue;
        seen[href] = true;
        let title = "";
        let p2 = block.indexOf('<div class="title">');
        if (p2 >= 0) {
            const s2 = p2 + 19;
            const e2 = block.indexOf("</div>", s2);
            if (e2 >= 0) title = unescapeHtml(block.slice(s2, e2));
        }
        if (!title) {
            p2 = block.indexOf('title="');
            if (p2 >= 0) {
                const s2 = p2 + 7;
                const e2 = block.indexOf('"', s2);
                if (e2 >= 0) title = unescapeHtml(block.slice(s2, e2));
            }
        }
        if (!title) continue;
        if (title.length > 90) title = title.slice(0, 90);
        let cover = "";
        p2 = block.indexOf('data-original="');
        if (p2 >= 0) {
            const s2 = p2 + 15;
            const e2 = block.indexOf('"', s2);
            if (e2 >= 0) cover = fixUrl(block.slice(s2, e2));
        }
        let remark = "";
        p2 = block.indexOf('<div class="time">');
        if (p2 >= 0) {
            const s2 = p2 + 18;
            const e2 = block.indexOf("</div>", s2);
            if (e2 >= 0) remark = block.slice(s2, e2).trim();
        }
        out.push({
            id: href,
            title: title,
            cover: cover,
            remarks: remark,
            duration: remark,
            tags: [],
        });
    }
    return out;
}

function metaContent(html, attr, key) {
    const marker = attr + '="' + key + '"';
    const p = html.indexOf(marker);
    if (p < 0) return "";
    const after = html.slice(p);
    const c = after.indexOf('content="');
    if (c < 0) return "";
    const s = c + 9;
    const e = after.indexOf('"', s);
    if (e < 0) return "";
    return unescapeHtml(after.slice(s, e));
}

function extractVideoUrl(html) {
    if (!html) return "";
    const marker = "video_url: '";
    const p = html.indexOf(marker);
    if (p < 0) return "";
    const s = p + marker.length;
    const e = html.indexOf("'", s);
    if (e < 0) return "";
    const b64 = html.slice(s, e).trim();
    if (!b64) return "";
    let url = "";
    try {
        url = str(host.codec.base64Decode(b64, {to: "utf8"})).trim();
    } catch (error) {
        return "";
    }
    if (url.indexOf("/get_file/") >= 0 && url.indexOf(".mp4") >= 0) return url;
    return "";
}

// get_file 地址会 302 到 CDN 签名直链：HEAD 跟随跳转，resp.url 即最终地址；
// 失败就回原地址（播放器/探针自己也会跟随跳转）。
async function resolveRedirect(url) {
    try {
        const resp = await host.http.request({
            url: url,
            method: "HEAD",
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
            timeout: TIMEOUT,
        });
        if (resp && resp.url && resp.url !== url && resp.status < 400) return resp.url;
    } catch (error) {
        host.log("resolve fail", url, str(error && error.message));
    }
    return url;
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = CATS
        .filter((item) => !isFlagged(item[1]))
        .map((item) => ({id: item[0], name: item[1]}));
    const html = await fetchPage(BASE + "/categories/jav/");
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    let tid = str(arg && arg.id).trim();
    const page = Math.max(1, intValue(arg && arg.page, 1));
    for (const item of CATS) {
        if (item[0] === tid && isFlagged(item[1])) {
            return {items: [], hasMore: false};
        }
    }
    if (!tid || tid === "all") tid = "jav";
    const path = page <= 1
        ? "/categories/" + tid + "/"
        : "/categories/" + tid + "/" + page + "/";
    const html = await fetchPage(BASE + path);
    const items = parseCards(html);
    return {items: items, hasMore: items.length >= 30};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const kw = encodeURIComponent(keyword).replace(/%20/g, "+");
    const html = await fetchPage(BASE + "/search/" + kw + "/");
    const items = parseCards(html).slice(0, 60);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const pageUrl = str(arg && arg.id).trim();
    if (!pageUrl) throw new Error("无效的影片 ID");
    const html = await fetchPage(pageUrl);
    if (!html) return {id: pageUrl, title: pageUrl, cover: "", desc: "", tags: [], lines: []};
    const title = metaContent(html, "property", "og:title");
    if (!title) return {id: pageUrl, title: pageUrl, cover: "", desc: "", tags: [], lines: []};
    const cover = fixUrl(metaContent(html, "property", "og:image"));
    let desc = metaContent(html, "name", "description");
    if (desc === "Default site description.") desc = "";
    if (desc.length > 400) desc = desc.slice(0, 400);
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

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id) || "");
    if (raw.indexOf("$") >= 0) raw = raw.split("$").slice(1).join("$");
    if (raw.indexOf("avhwa:") === 0) raw = raw.slice("avhwa:".length).trim();
    if (!raw) throw new Error("无效的播放 ID");
    const headers = {"User-Agent": UA, "Referer": BASE + "/"};
    if (raw.indexOf("http") === 0 && raw.indexOf(".mp4") >= 0) {
        const direct = await resolveRedirect(raw);
        return {
            streams: [{url: direct, format: "mp4", headers: headers, name: "AVHWA"}],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const pageUrl = raw.indexOf("http") === 0 ? raw : BASE + raw;
    const html = await fetchPage(pageUrl);
    const fileUrl = extractVideoUrl(html);
    if (!fileUrl) throw new Error("未找到播放地址");
    const finalUrl = await resolveRedirect(fileUrl);
    return {
        streams: [{url: finalUrl, format: "mp4", headers: headers, name: "AVHWA"}],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
