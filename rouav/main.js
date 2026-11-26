// rouAV（肉视频）— idj1 插件（2026-11-24 摸站手写，非 CatVod 转换）
// 2026-11-25 复核（v1.0.1）：本机出口实跑全链通过——home 40 条（标题/封面齐）、
//   国产AV 分类 20 条、详情、播放回 rou666.net 真 m3u8（200 #EXTM3U）。
//   封面为站方图床（*.vclarith.top / *.piccdn1.mom）原样返回的签名地址，插件不改写；
//   该图床对数据中心出口直接断连/回 530，封面字节本机验不了，待手机终验。逻辑未动，仅升版本促 App 侧刷新安装。
// 站点：https://site2.321av.cc（MacCMS fense 模板；标题 rouAV - 肉视频）
// 99dh 导航里的「肉视频」与「rouAV」是同一站（同一域名、同一标题），
// 故只出一个插件，显示名 rouAV，描述里注明即肉视频。
// 导航 1:1：首页 / 国产AV /vodtype/7 / 日本 /vodtype/3 /
//   自拍流出 /vodtype/6 / 探花 /vodtype/5 / OnlyFans /vodtype/4 / 其他 /vodtype/1
// 列表：卡片 <div class="movie-item thumbnail">，封面 <img class="thumbnail-poster">，
//   标题 <h3 class="movie-title">，信息 <p class="movie-info">，时长徽章；
//   分类翻页 /vod/show/id/<id>/page/<n>.html；
//   搜索 GET /vod/search.html?wd=，翻页 /vod/search/page/<n>/wd/<kw>.html。
// 详情：player_aaaa.url 是 base64 JSON {"ss":[[3,"/api/v/<vid>"]]}（encrypt:0，
//   url 字段本身就是 base64，无需 URL 解码），另有 vod_data（片名/分类）
//   与 o_poster_url（封面）。
// 播放（2026-11-24 本机出口实测全通）：
//   GET https://rou123.top/api/v/<vid> → JSON {video:{videoUrl}}，
//   videoUrl 是 https://rou666.net/api/hls/<vid>，直接回真 m3u8 播放列表
//   （#EXTM3U VOD，带签名分片地址，72KB 已拉到）。
// type 0（rmissav.centercdn.top + eval）是站内 xplayer.html 里另一条取流分支，
// 本站详情目前只出现 type 3，type 0 分支未在本机验通，仅作兜底。

const SITE = "https://site2.321av.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATEGORIES = [
    {id: "latest", name: "最新"},
    {id: "7", name: "国产AV"},
    {id: "3", name: "日本"},
    {id: "6", name: "自拍流出"},
    {id: "5", name: "探花"},
    {id: "4", name: "OnlyFans"},
    {id: "1", name: "其他"},
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function absUrl(url, base) {
    const value = str(url).trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (/^\/\//.test(value)) return "https:" + value;
    if (/^\//.test(value)) return base.replace(/\/+$/, "") + value;
    return base.replace(/\/+$/, "") + "/" + value;
}

function cleanText(value) {
    return str(value)
        .replace(/<[^>]*>/g, " ")
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
    const match = regex.exec(text);
    return match ? str(match[index == null ? 1 : index]) : "";
}

function unique(list) {
    const seen = {};
    const result = [];
    for (const item of list) {
        const key = str(item);
        if (!key || seen[key]) continue;
        seen[key] = true;
        result.push(item);
    }
    return result;
}

// 站内 xplayer.html 的 replaceResUrl：资源 host 改写到 rjmp1.centercdn.top。
function replaceResUrl(url) {
    return str(url).replace(/^(https?:\/\/)([\w.-]+?)(\/)/i, "$1rjmp1.centercdn.top$3$2$3");
}

async function fetchText(url, referer) {
    const resp = await host.http.request({
        url: url,
        method: "GET",
        headers: {
            "User-Agent": UA,
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": referer || SITE + "/",
        },
        timeout: TIMEOUT,
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
    return resp.body == null ? "" : String(resp.body);
}

async function fetchJson(url, referer) {
    const text = await fetchText(url, referer);
    return JSON.parse(text);
}

// 列表卡片：<div class="movie-item thumbnail"> … /vodplay/<id>-1-1.html …
// <img class="thumbnail-poster" src=封面> … 时长徽章 … <h3 class="movie-title"> …
// <p class="movie-info">分类 | 时间</p>
function parseVideos(html) {
    const items = [];
    const seen = {};
    const chunks = html.split(/<div class="movie-item thumbnail">/i).slice(1);
    for (const chunk of chunks) {
        const href = firstMatch(chunk, /href="\/vodplay\/(\d+)-1-1\.html"/i);
        if (!href || seen[href]) continue;
        seen[href] = true;
        const cover = firstMatch(chunk, /<img class="thumbnail-poster"[^>]*src="([^"]+)"/i)
            || firstMatch(chunk, /<img[^>]*src="([^"]+)"/i);
        const title = cleanText(firstMatch(chunk, /<h3 class="movie-title">([\s\S]*?)<\/h3>/i));
        const info = cleanText(firstMatch(chunk, /<p class="movie-info">([\s\S]*?)<\/p>/i));
        const duration = cleanText(firstMatch(chunk, /<span class="movie-duration-span">([\s\S]*?)<\/span>/i));
        const cat = info.split("|")[0].trim();
        items.push({
            id: href,
            title: title || href,
            cover: absUrl(cover, SITE),
            remarks: duration || info,
            duration: duration,
            tags: cat ? [cat] : [],
        });
    }
    return items;
}

function maxShowPage(html, tid) {
    let max = 1;
    const regex = new RegExp("href=\"/vod/show/id/" + tid + "/page/(\\d+)\\.html\"", "gi");
    let match;
    while ((match = regex.exec(html)) !== null) {
        const n = parseInt(match[1], 10);
        if (isFinite(n) && n > max) max = n;
    }
    return max;
}

function maxSearchPage(html) {
    let max = 1;
    const regex = /href="\/vod\/search\/page\/(\d+)\/wd\//gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const n = parseInt(match[1], 10);
        if (isFinite(n) && n > max) max = n;
    }
    return max;
}

function parsePlayerAaaa(html) {
    const raw = firstMatch(html, /var player_aaaa=(\{.*?\})<\/script>/s);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

// player_aaaa.url：encrypt:0 时 url 字段本身就是 base64 JSON；
// encrypt:1 时先 URL 解码再 base64 解码。
function parseSs(player) {
    if (!player || !player.url) return [];
    const tries = [str(player.url)];
    try { tries.push(decodeURIComponent(str(player.url))); } catch (error) {}
    for (const cand of tries) {
        try {
            const json = JSON.parse(host.codec.base64Decode(cand, {to: "utf8"}));
            if (json && Array.isArray(json.ss)) return json.ss;
        } catch (error) {
            try {
                const json = JSON.parse(cand);
                if (json && Array.isArray(json.ss)) return json.ss;
            } catch (error2) {}
        }
    }
    return [];
}

// ---------- idj1 契约 ----------

async function home() {
    let items = [];
    try {
        const html = await fetchText(SITE + "/");
        items = parseVideos(html);
    } catch (error) {
        items = [];
    }
    return {categories: CATEGORIES, items: items, hasMore: false};
}

async function category(arg) {
    const page = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const tid = str(arg && arg.id);
    if (tid !== "latest" && tid !== "7" && tid !== "3" && tid !== "6" && tid !== "5" && tid !== "4" && tid !== "1") {
        return {items: [], hasMore: false};
    }
    let items = [];
    let hasMore = false;
    try {
        // latest 只有首页，没有独立翻页地址；第 2 页起直接回空。
        if (tid === "latest" && page > 1) return {items: [], hasMore: false};
        let url;
        if (tid === "latest") {
            url = SITE + "/";
        } else if (page === 1) {
            url = SITE + "/vodtype/" + tid + ".html";
        } else {
            url = SITE + "/vod/show/id/" + tid + "/page/" + page + ".html";
        }
        const html = await fetchText(url);
        items = parseVideos(html);
        hasMore = tid === "latest" ? false : maxShowPage(html, tid) > page;
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: hasMore};
}

async function search(arg) {
    const page = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const query = encodeURIComponent(keyword);
    const url = page === 1
        ? SITE + "/vod/search.html?wd=" + query
        : SITE + "/vod/search/page/" + page + "/wd/" + query + ".html";
    let items = [];
    let hasMore = false;
    try {
        const html = await fetchText(url);
        items = parseVideos(html);
        hasMore = maxSearchPage(html) > page;
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: hasMore};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    if (!rawId) throw new Error("无效的影片 ID");
    const vid = rawId.replace(/^\/?vodplay\//, "").replace(/-1-1\.html$/, "");
    let html = "";
    try {
        html = await fetchText(SITE + "/vodplay/" + vid + "-1-1.html");
    } catch (error) {
        html = "";
    }
    const player = parsePlayerAaaa(html);
    const vod = (player && player.vod_data) || {};
    const title = str(vod.vod_name || "").trim()
        || cleanText(firstMatch(html, /<title>(.*?)<\/title>/is)).split("第1集")[0].trim()
        || rawId;
    if (!title) {
        return {id: rawId, title: rawId, cover: "", desc: "", tags: [], lines: []};
    }
    const cover = firstMatch(html, /o_poster_url\s*=\s*"([^"]+)"/i)
        || firstMatch(html, /video_poster_url\s*=\s*"([^"]+)"/i);
    const tags = str(vod.vod_class || "").split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    // 标签行（主演 / 标签）也补进 tags
    const tagBlock = firstMatch(html, /<span>标签:<\/span>([\s\S]*?)<\/div>/i);
    if (tagBlock) {
        const tagRegex = />([^<>]+)<\/a>/g;
        let m;
        while ((m = tagRegex.exec(tagBlock)) !== null) {
            const t = m[1].trim();
            if (t) tags.push(t);
        }
    }
    const related = parseVideos(html).filter((v) => v.id !== vid);
    const lines = [{name: "rouAV", episodes: [{id: vid, name: "正片"}]}];
    if (related.length) {
        lines.push({
            name: "相关推荐",
            episodes: related.slice(0, 12).map((v) => ({id: v.id, name: v.title})),
        });
    }
    return {
        id: rawId,
        title: title,
        cover: absUrl(cover, SITE),
        desc: "",
        tags: unique(tags),
        lines: lines,
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    if (!raw) throw new Error("无效的播放地址");
    const vid = raw.replace(/^\/?vodplay\//, "").replace(/-1-1\.html$/, "");
    const referer = SITE + "/vodplay/" + vid + "-1-1.html";
    const html = await fetchText(referer);
    const player = parsePlayerAaaa(html);
    const ss = parseSs(player);
    if (!ss.length) throw new Error("未找到可用播放地址");
    for (const row of ss) {
        if (!Array.isArray(row) || row.length < 2) continue;
        const type = row[0];
        const path = str(row[1]);
        if (type === 1) {
            const url = absUrl(path, SITE);
            return {streams: [{url: url, format: /\.m3u8/i.test(url) ? "hls" : "mp4", headers: {"User-Agent": UA, "Referer": referer}, name: "rouAV"}]};
        }
        if (type === 3) {
            // 站内 xplayer.html 的逻辑：rou123.top 的 /api/v/ 接口回 JSON。
            const apiUrl = "https://rou123.top" + (path.indexOf("/") === 0 ? "" : "/") + path;
            const data = await fetchJson(apiUrl, referer);
            const videoUrl = data && data.video && data.video.videoUrl;
            if (!videoUrl) continue;
            const url = str(videoUrl);
            // /api/hls/<id> 固定回 m3u8 播放列表（已在线下实测拉到 #EXTM3U），
            // 地址本身不带 .m3u8 后缀，故格式直接写 hls，不按后缀猜。
            return {streams: [{url: url, format: "hls", headers: {"User-Agent": UA, "Referer": referer}, name: "rouAV"}]};
        }
        if (type === 0) {
            // 站内 xplayer.html 的另一分支（本站详情目前只出现 type 3，此分支未验通）。
            const apiUrl = "https://rmissav.centercdn.top" + (path.indexOf("/") === 0 ? "" : "/") + path;
            const resp = await host.http.request({
                url: apiUrl,
                method: "GET",
                headers: {"User-Agent": UA, "Referer": referer},
                timeout: TIMEOUT,
            });
            if (resp.status < 200 || resp.status >= 300) continue;
            const text = resp.body == null ? "" : String(resp.body);
            if (!text) continue;
            var videoInfo;
            eval(text);
            if (!videoInfo || !videoInfo.videoUrl) continue;
            var source, source842, source1280;
            eval(videoInfo.videoUrl);
            const best = source1280 || source842 || source;
            if (!best) continue;
            const url = replaceResUrl(str(best));
            return {streams: [{url: url, format: /\.m3u8/i.test(url) ? "hls" : "mp4", headers: {"User-Agent": UA, "Referer": referer}, name: "rouAV"}]};
        }
    }
    throw new Error("未找到可用播放地址");
}

export default {home: home, category: category, search: search, detail: detail, play: play};
