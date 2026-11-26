// 黄色仓库 — idj1 插件（2026-11-24 新写，非 CatVod 改写）
// 站点：https://www.hsck01.net（99dh 第 11 项；永久域 hsck.la，镜像 17188.cc / 69ck1.com）
// 模板：MacCMS + stui 模板；首页 /enter，分类 /index.php/vod/type/id/N.html（翻页 /page/P.html），
// 搜索 GET /index.php/vod/search.html?wd=关键词（表单 method=get，input 名 wd）。
// 列表项直链播放页（无详情页）：/index.php/vod/play/id/N/sid/1/nid/1.html。
// 播放：播放页内嵌 iframe https://player.centercdn.top/player.html?video_url=<urlencoded m3u8>，
// 取 video_url 参数解码即 m3u8 直链（本机出口实测 200、真 #EXTM3U 播放列表）。
//
// 降级 / 硬限制：
// - 详情页没有独立封面（播放页无海报图），detail 的 cover 回空；封面只在列表项里有。
// - 搜索只按 MacCMS 表单写法实现，本机出口两次直连 search.html 均失败（000），
//   未能在线验通，待手机终验；分类/首页/播放均已在线验通。

const SITE = "https://www.hsck01.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 30000;

// 导航分类（home 解析不到时兜底；与 2026-11-24 实抓导航 1:1）
const FALLBACK_CATEGORIES = [
    ["1", "麻豆"], ["2", "中字"], ["3", "国产"], ["4", "欧美"], ["5", "日韩"],
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

async function fetchText(url, referer) {
    const resp = await host.http.request({
        url: url,
        method: "GET",
        headers: {
            "User-Agent": UA,
            "Referer": referer || SITE + "/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
        },
        timeout: TIMEOUT,
    });
    if (resp.status !== 200) throw new Error("请求失败 HTTP " + resp.status + "：" + url);
    return resp.body || "";
}

function parseCategories(html) {
    const seen = {};
    const result = [];
    const regex = /href="\/index\.php\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const id = match[1];
        const name = cleanText(match[2]);
        if (!id || !name || seen[id]) continue;
        seen[id] = true;
        result.push({id: id, name: name});
    }
    if (!result.length) {
        for (const pair of FALLBACK_CATEGORIES) result.push({id: pair[0], name: pair[1]});
    }
    return result;
}

// 列表项：<a class="stui-vodlist__thumb lazyload" href=".../vod/play/id/N/..." title="标题"
// data-original="封面">…<span class="pic-text text-right">时长</span>
function parseVideos(html) {
    const items = [];
    const seen = {};
    const anchorRegex = /<a[^>]+href="\/index\.php\/vod\/play\/id\/(\d+)\/sid\/1\/nid\/1\.html"[^>]*>/gi;
    let match;
    while ((match = anchorRegex.exec(html)) !== null) {
        const id = match[1];
        if (!id || seen[id]) continue;
        seen[id] = true;
        const tag = match[0];
        const title = cleanText(firstMatch(tag, /title="([^"]*)"/i));
        const cover = absUrl(firstMatch(tag, /data-original="([^"]*)"/i), SITE);
        // 时长在 </a> 之后 400 字符内的 pic-text 里
        const tail = html.slice(match.index, match.index + 1200);
        const remarks = cleanText(firstMatch(tail, /<span class="pic-text[^"]*">([^<]*)<\/span>/i));
        items.push({id: id, title: title || id, cover: cover, remarks: remarks});
    }
    return items;
}

function pageCount(html, current) {
    const numbers = [];
    const regex = /\/index\.php\/vod\/type\/id\/\d+\/page\/(\d+)\.html/gi;
    let match;
    while ((match = regex.exec(html)) !== null) numbers.push(parseInt(match[1], 10));
    if (!numbers.length) return current;
    const max = Math.max.apply(null, numbers);
    return Math.max(current, isFinite(max) ? max : current);
}

function categoryUrl(id, page) {
    if (page <= 1) return SITE + "/index.php/vod/type/id/" + id + ".html";
    return SITE + "/index.php/vod/type/id/" + id + "/page/" + page + ".html";
}

async function home() {
    let html = "";
    try {
        html = await fetchText(SITE + "/enter");
    } catch (error) {
        html = "";
    }
    return {
        categories: parseCategories(html),
        items: parseVideos(html),
        hasMore: false,
    };
}

async function category(arg) {
    const id = str(arg && arg.id);
    const page = Math.max(1, parseInt((arg && arg.page) || "1", 10) || 1);
    if (!id) throw new Error("无效的分类 ID");
    const html = await fetchText(categoryUrl(id, page));
    return {
        items: parseVideos(html),
        hasMore: pageCount(html, page) > page,
    };
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    const page = Math.max(1, parseInt((arg && arg.page) || "1", 10) || 1);
    if (!keyword) return {items: [], hasMore: false};
    let url = SITE + "/index.php/vod/search.html?wd=" + encodeURIComponent(keyword);
    if (page > 1) url += "&page=" + page;
    const html = await fetchText(url);
    return {
        items: parseVideos(html),
        hasMore: pageCount(html, page) > page,
    };
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    if (!rawId) throw new Error("无效的影片 ID");
    const id = rawId.replace(/\D/g, "");
    if (!id) throw new Error("无效的影片 ID");
    let html = "";
    try {
        html = await fetchText(SITE + "/index.php/vod/play/id/" + id + "/sid/1/nid/1.html");
    } catch (error) {
        html = "";
    }
    // 注意：页内有 3 个 <h3 class="title">（目录 / 本片标题 / 相关视频），
    // 取第一个会误取“目录”——优先用 <title>（“标题 - 热门岛国视频和麻豆视频 - 黄色仓库”）。
    let title = cleanText(firstMatch(html, /<title>([^<]*)<\/title>/i)).replace(/ - .*$/, "");
    if (!title) title = cleanText(firstMatch(html, /<h3 class="title">([\s\S]*?)<\/h3>/i));
    const desc = cleanText(firstMatch(html, /<meta name="description" content="([^"]*)"/i));
    return {
        id: rawId,
        title: title || rawId,
        cover: "",
        desc: desc,
        tags: [],
        lines: [{name: "在线播放", episodes: [{id: id, name: "正片"}]}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    const id = raw.replace(/\D/g, "");
    if (!id) throw new Error("无效的播放地址");
    const pageUrl = SITE + "/index.php/vod/play/id/" + id + "/sid/1/nid/1.html";
    const html = await fetchText(pageUrl);
    const iframe = firstMatch(html, /player\.centercdn\.top\/player\.html\?video_url=([^"'\s&]+)/i);
    if (!iframe) throw new Error("未找到可用播放地址");
    let url = "";
    try {
        url = decodeURIComponent(iframe);
    } catch (error) {
        url = iframe;
    }
    if (!/^https?:\/\//i.test(url)) throw new Error("未找到可用播放地址");
    return {
        streams: [{
            url: url,
            format: "hls",
            headers: {"User-Agent": UA, "Referer": SITE + "/"},
            name: "黄色仓库",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
