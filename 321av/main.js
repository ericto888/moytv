// 321AV — idj1 插件（2026-11-24 摸站手写，非 CatVod 转换）
// 站点：https://www.321av.cc（MacCMS；备用域 321av.fans 未验）
// 导航 1:1：首页 / 有码影片 /vodtype/20 / 无码影片 /vodtype/21 /
//   中文字幕 /vodtype/22 / 女优 /actor.html
// 列表：卡片 <div class="thumbnail group">，封面 <img data-src>，
//   标题 + 标签 + 时长徽章；分类翻页 /vodtype/<id>-<n>.html；
//   搜索 GET /vod/search.html?wd=，翻页 /vod/search/page/<n>/wd/<kw>.html；
//   女优列表 /actor.html（翻页 /actor-<n>.html），女优详情 /actordetail-<id>.html。
// 详情：player_aaaa.url 是 URL 编码的 base64 JSON {"ss":[[0,"/cn/<code>"]]}，
//   另有 vod_data（片名/导演/分类）、o_poster_url（封面）。
// 播放：站内接线播放器 xplayer2.html 走 /private-getvideo/<code>，
//   2026-11-24 实测该路由 404（两部片、带详情页 Cookie 与 Referer 均 404，
//   服务端“页面错误！请稍后再试～”），站内接线播放链目前是断的；
//   插件改走站内另一播放器文件 /static/player/xplayer.html 的取流逻辑：
//   type 0 → GET https://rmissav.datalicdn.top/cn/<code> 取 JS，eval 出
//   videoInfo.videoUrl 再 eval 得 source/source842/source1280，取最高画质，
//   再按站内 replaceResUrl 改写到 rjmp1.datalicdn.top。
//   rmissav.datalicdn.top 在本机出口连不上（HTTP 000；另一候选
//   rmissav.centercdn.top 70 秒超时），播放未在本机验通——待手机终验，
//   绝不冒充通过。详情/列表/搜索/女优链路均已用真实页面验通。

const SITE = "https://www.321av.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATEGORIES = [
    {id: "latest", name: "最新"},
    {id: "20", name: "有码影片"},
    {id: "21", name: "无码影片"},
    {id: "22", name: "中文字幕"},
    {id: "actress", name: "女优"},
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

function b64decodeUrlSafe(s) {
    let t = str(s).replace(/-/g, "+").replace(/_/g, "/").replace(/[\s\r\n\t]/g, "");
    while (t.length % 4 !== 0) t += "=";
    return host.codec.base64Decode(t, {to: "latin1"});
}

// 站内 xplayer.html 的 replaceResUrl：资源 host 改写到 rjmp1.datalicdn.top，
// 原 host 变成路径上的一段。
function replaceResUrl(url) {
    return str(url).replace(/^(https?:\/\/)([\w.-]+?)(\/)/i, "$1rjmp1.datalicdn.top$3$2$3");
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

// 列表卡片：<div class="thumbnail group"> … /vodplay/<id>-1-1.html …
// <img data-src=封面> … <video data-src=预览 mp4> … 标题链接 … 左徽章分类 … 右徽章时长
function parseVideos(html) {
    const items = [];
    const seen = {};
    const chunks = html.split(/<div class="thumbnail group">/i).slice(1);
    for (const chunk of chunks) {
        const href = firstMatch(chunk, /href="\/vodplay\/(\d+)-1-1\.html"/i);
        if (!href || seen[href]) continue;
        seen[href] = true;
        const cover = firstMatch(chunk, /<img[^>]*data-src="([^"]+)"/i);
        const title = cleanText(firstMatch(chunk, /<a class="text-secondary[^"]*"[^>]*href="\/vodplay\/\d+-1-1\.html">([\s\S]*?)<\/a>/i));
        const tag = cleanText(firstMatch(chunk, /<span class="absolute bottom-1 left-1[^"]*">([\s\S]*?)<\/span>/i));
        const duration = cleanText(firstMatch(chunk, /<span class="absolute bottom-1 right-1[^"]*">([\s\S]*?)<\/span>/i));
        items.push({
            id: href,
            title: title || href,
            cover: absUrl(cover, SITE),
            remarks: duration || tag,
            duration: duration,
            tags: tag ? [tag] : [],
        });
    }
    return items;
}

function parseActresses(html) {
    const items = [];
    const seen = {};
    const regex = /href="\/actordetail-(\d+)\.html"[\s\S]*?data-src="([^"]+)"[^>]*alt="([^"]*)"[\s\S]*?<h4[^>]*>([^<]+)<\/h4>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const id = match[1];
        if (seen[id]) continue;
        seen[id] = true;
        const name = cleanText(match[4] || match[3]);
        items.push({
            id: "actress/" + id,
            title: name || id,
            cover: absUrl(match[2], SITE),
            remarks: "女优",
            duration: "",
            tags: ["女优"],
        });
    }
    return items;
}

// 分类页最大页码：/vodtype/<id>-<n>.html
function maxTypePage(html, tid) {
    let max = 1;
    const regex = new RegExp("href=\"/vodtype/" + tid + "-(\\d+)\\.html\"", "gi");
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

function typeUrl(tid, page) {
    // latest 只有首页三区，没有独立翻页地址；第 2 页起直接回空。
    if (tid === "latest") return page === 1 ? SITE + "/" : "";
    return page === 1 ? SITE + "/vodtype/" + tid + ".html" : SITE + "/vodtype/" + tid + "-" + page + ".html";
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

// player_aaaa.url：URL 编码的 base64 JSON {"ss":[[type,"path"],...]}
function parseSs(player) {
    if (!player || !player.url) return [];
    try {
        const decoded = decodeURIComponent(str(player.url));
        const json = JSON.parse(host.codec.base64Decode(decoded, {to: "utf8"}));
        if (json && Array.isArray(json.ss)) return json.ss;
    } catch (error) {
        // 兼容 encrypt:0 的情形：url 本身就是 JSON 文本
        try {
            const json = JSON.parse(str(player.url));
            if (json && Array.isArray(json.ss)) return json.ss;
        } catch (error2) {
            return [];
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
    if (tid === "actress") {
        let list = [];
        let hasMore = false;
        try {
            const url = page === 1 ? SITE + "/actor.html" : SITE + "/actor-" + page + ".html";
            const html = await fetchText(url);
            list = parseActresses(html);
            let max = 1;
            const regex = /href="\/actor-(\d+)\.html"/gi;
            let match;
            while ((match = regex.exec(html)) !== null) {
                const n = parseInt(match[1], 10);
                if (isFinite(n) && n > max) max = n;
            }
            hasMore = max > page;
        } catch (error) {
            list = [];
        }
        return {items: list, hasMore: hasMore};
    }
    if (tid !== "latest" && tid !== "20" && tid !== "21" && tid !== "22") {
        return {items: [], hasMore: false};
    }
    let items = [];
    let hasMore = false;
    try {
        const url = typeUrl(tid, page);
        if (!url) return {items: [], hasMore: false};
        const html = await fetchText(url);
        items = parseVideos(html);
        if (tid === "latest") {
            hasMore = false;
        } else {
            hasMore = maxTypePage(html, tid) > page;
        }
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

    // 女优：详情页只有一条线路「该女优作品」，分集即该女优的作品（第 1 页）。
    if (rawId.indexOf("actress/") === 0) {
        const aid = rawId.slice(8);
        let videos = [];
        let name = aid;
        try {
            const html = await fetchText(SITE + "/actordetail-" + aid + ".html");
            videos = parseVideos(html);
            const title = firstMatch(html, /<title>(.*?)<\/title>/is);
            if (title) name = cleanText(title.split("个人资料")[0]);
        } catch (error) {
            videos = [];
        }
        return {
            id: rawId,
            title: name,
            cover: "",
            desc: "",
            tags: ["女优"],
            lines: [{
                name: "该女优作品",
                episodes: videos.map((video) => ({id: video.id, name: video.title})),
            }],
        };
    }

    const vid = rawId.replace(/^\/?vodplay\//, "").replace(/-1-1\.html$/, "");
    let html = "";
    try {
        html = await fetchText(SITE + "/vodplay/" + vid + "-1-1.html");
    } catch (error) {
        html = "";
    }
    const player = parsePlayerAaaa(html);
    const vod = (player && player.vod_data) || {};
    const title = cleanText(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)) || str(vod.vod_name || "") || rawId;
    if (!title) {
        return {id: rawId, title: rawId, cover: "", desc: "", tags: [], lines: []};
    }
    const cover = firstMatch(html, /o_poster_url\s*=\s*"([^"]+)"/i)
        || firstMatch(html, /video_poster_url\s*=\s*"([^"]+)"/i);
    const intro = cleanText(firstMatch(html, /简介：([^<]{0,500})/i));
    const tags = str(vod.vod_class || "").split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    const director = str(vod.vod_director || "").trim();
    const related = parseVideos(html).filter((v) => v.id !== vid);
    const desc = [intro, director ? "导演：" + director : ""].filter(Boolean).join("\n");
    const lines = [{name: "321AV", episodes: [{id: vid, name: "正片"}]}];
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
        desc: desc,
        tags: unique(tags),
        lines: lines,
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    if (!raw) throw new Error("无效的播放地址");
    const vid = raw.replace(/^\/?vodplay\//, "").replace(/-1-1\.html$/, "");
    const html = await fetchText(SITE + "/vodplay/" + vid + "-1-1.html");
    const player = parsePlayerAaaa(html);
    const ss = parseSs(player);
    if (!ss.length) throw new Error("未找到可用播放地址");
    for (const row of ss) {
        if (!Array.isArray(row) || row.length < 2) continue;
        const type = row[0];
        const path = str(row[1]);
        if (type === 1) {
            const url = absUrl(path, SITE);
            return {streams: [{url: url, format: /\.m3u8/i.test(url) ? "hls" : "mp4", headers: {"User-Agent": UA, "Referer": SITE + "/vodplay/" + vid + "-1-1.html"}, name: "321AV"}]};
        }
        if (type === 0) {
            // 站内 xplayer.html 的逻辑：取 rmissav JS，eval 出各画质源。
            const apiUrl = "https://rmissav.datalicdn.top" + (path.indexOf("/") === 0 ? "" : "/") + path;
            const resp = await host.http.request({
                url: apiUrl,
                method: "GET",
                headers: {"User-Agent": UA, "Referer": SITE + "/vodplay/" + vid + "-1-1.html"},
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
            return {streams: [{url: url, format: /\.m3u8/i.test(url) ? "hls" : "mp4", headers: {"User-Agent": UA, "Referer": SITE + "/vodplay/" + vid + "-1-1.html"}, name: "321AV"}]};
        }
    }
    throw new Error("未找到可用播放地址");
}

export default {home: home, category: category, search: search, detail: detail, play: play};
