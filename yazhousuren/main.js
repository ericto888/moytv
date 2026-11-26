// 亚洲素人精选 — idj1 插件（2026-11-24 新写，非 CatVod 改写）
// 站点：https://591av.ws（99dh 第 20 项，站名 PPP.Porn；镜像 591av.net / 591av.sbs / 91-av.men / 91-av.one）
// 首页 /enter 跳转到 /pp1/；分类 /categories/<slug>/（翻页 /categories/<slug>/<页>/），
// 搜索 GET /search/<关键词>/，视频页 /v/<短码>/。
// 列表项：<div class="item card-video">，<a href="https://591av.ws/v/<短码>/">，
// 封面 img data-src（lazyload），标题 alt / <h4>，时长 figcaption.card-video__duration。
// 播放：视频页内联 var stream = '<m3u8>'（591av.ws/jmpres/.../stream/.../<时间戳>/.../<id>.m3u8），
// 直接取该地址；播放器跟随 302 跳到 CDN 真实 m3u8。
//
// 降级 / 硬限制：
// - jmpres 地址是带时间戳的签名地址，302 跳转后的 CDN 边缘偶发 410 Gone（本机实测：
//   同一地址一次 410、一次跟到另一边缘回 200 真播放列表）；播不通时重试一次，仍 410 待手机终验。
// - 分类「学生」一名已逐字记入 NOTES.md，请协调员复核（本站其余 33 个分类无此类旗标）。
// - 搜索翻页（/search/<关键词>/<页>/）未在线验通，只验了第 1 页。

const SITE = "https://591av.ws";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 30000;

// 分类（/categories/ 页取不到时兜底；与 2026-11-24 实抓分类页 1:1，共 34 个）
const FALLBACK_CATEGORIES = [
    ["91-tanhua", "探花"], ["acg", "动漫"], ["amateur", "素人自拍"], ["bdsm", "凌辱"],
    ["cheongsam", "旗袍"], ["china-av", "中国AV"], ["china", "中国"], ["cosplay", "Cosplay"],
    ["costume", "古装"], ["dolfin-shorts", "真理裤"], ["drama", "剧情"], ["exhibitionists", "野外露出"],
    ["first-person-pov", "主观视角"], ["flight-attendant", "空姐"], ["hongkong", "香港"],
    ["japan-producer", "日本片商"], ["japan", "日本"], ["kemonomimi", "兽耳"],
    ["knee-socks", "过膝袜"], ["korea", "韩国"], ["lesbian", "百合"], ["maid", "女仆"],
    ["nurse", "护士"], ["office-lady", "OL"], ["pantyhose", "丝袜"], ["released", "流出"],
    ["se-asia", "东南亚"], ["streamer", "主播"], ["student", "学生"], ["taiwan", "台湾"],
    ["threesome", "多P"], ["uncensored", "无码"], ["yoga-pants", "瑜伽裤"],
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

// 列表项：<a href="https://591av.ws/v/<短码>/"><img data-src="封面" alt="标题">…<figcaption>时长</figcaption>
function parseVideos(html) {
    const items = [];
    const seen = {};
    const regex = /<a href="https?:\/\/591av\.ws\/v\/([\w-]+)\/"[^>]*>([\s\S]{0,900}?)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const code = match[1];
        if (!code || seen[code]) continue;
        seen[code] = true;
        const inner = match[2];
        const cover = absUrl(
            firstMatch(inner, /data-src="([^"]+)"/i) || firstMatch(inner, /<img[^>]+src="([^"]+)"/i),
            SITE);
        const title = cleanText(firstMatch(inner, /alt="([^"]*)"/i));
        const remarks = cleanText(firstMatch(inner, /<figcaption[^>]*>([^<]*)<\/figcaption>/i));
        items.push({id: "v/" + code, title: title || code, cover: cover, remarks: remarks});
    }
    return items;
}

function parseCategories(html) {
    const seen = {};
    const result = [];
    // 分类卡片是 <a href=".../categories/<slug>/"><figure><img><figcaption count>…</figcaption><figcaption class="card-cat-v2__title">名</figcaption>
    // 标题在 <a> 开头约 300 字后，窗口放宽到 800 字，直接取 title figcaption
    const regex = /<a[^>]+href="https?:\/\/591av\.ws\/categories\/([\w-]+)\/"[\s\S]{0,800}?<figcaption class="card-cat-v2__title">([^<]+)<\/figcaption>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const slug = match[1];
        const name = cleanText(match[2]);
        if (!slug || !name || seen[slug]) continue;
        seen[slug] = true;
        result.push({id: slug, name: name});
    }
    if (!result.length) {
        for (const pair of FALLBACK_CATEGORIES) result.push({id: pair[0], name: pair[1]});
    }
    return result;
}

function categoryUrl(id, page) {
    if (page <= 1) return SITE + "/categories/" + id + "/";
    return SITE + "/categories/" + id + "/" + page + "/";
}

async function home() {
    let html = "";
    try {
        html = await fetchText(SITE + "/pp1/");
    } catch (error) {
        html = "";
    }
    let categories = [];
    try {
        const catsHtml = await fetchText(SITE + "/categories/");
        categories = parseCategories(catsHtml);
    } catch (error) {
        categories = [];
    }
    if (!categories.length) {
        for (const pair of FALLBACK_CATEGORIES) categories.push({id: pair[0], name: pair[1]});
    }
    return {
        categories: categories,
        items: parseVideos(html),
        hasMore: false,
    };
}

async function category(arg) {
    const id = str(arg && arg.id);
    const page = Math.max(1, parseInt((arg && arg.page) || "1", 10) || 1);
    if (!id) throw new Error("无效的分类 ID");
    const html = await fetchText(categoryUrl(id, page));
    const items = parseVideos(html);
    return {items: items, hasMore: items.length >= 24};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    const page = Math.max(1, parseInt((arg && arg.page) || "1", 10) || 1);
    if (!keyword) return {items: [], hasMore: false};
    let url = SITE + "/search/" + encodeURIComponent(keyword) + "/";
    if (page > 1) url += page + "/";
    const html = await fetchText(url);
    const items = parseVideos(html);
    return {items: items, hasMore: items.length >= 24};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    if (!rawId) throw new Error("无效的影片 ID");
    const code = rawId.replace(/^v\//, "").replace(/\/$/, "");
    if (!code) throw new Error("无效的影片 ID");
    const url = SITE + "/v/" + code + "/";
    let html = "";
    try {
        html = await fetchText(url);
    } catch (error) {
        html = "";
    }
    let title = cleanText(firstMatch(html, /<title>([^<]*)<\/title>/i))
        .replace(/ - PPP\.Porn.*$/, "");
    if (!title) title = rawId;
    const cover = absUrl(firstMatch(html, /<video[^>]+poster="([^"]+)"/i), SITE);
    const desc = cleanText(firstMatch(html, /<meta name="description" content="([^"]*)"/i));
    const tags = [];
    const tagRegex = /href="https?:\/\/591av\.ws\/categories\/[\w-]+\/"[^>]*>([^<]{1,20})<\/a>/gi;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(html)) !== null) {
        const tag = cleanText(tagMatch[1]);
        if (tag && tags.indexOf(tag) === -1 && tags.length < 20) tags.push(tag);
    }
    return {
        id: rawId,
        title: title,
        cover: cover,
        desc: desc,
        tags: tags,
        lines: [{name: "在线播放", episodes: [{id: rawId, name: "正片"}]}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    const code = raw.replace(/^v\//, "").replace(/\/$/, "");
    if (!code) throw new Error("无效的播放地址");
    const pageUrl = SITE + "/v/" + code + "/";
    const html = await fetchText(pageUrl);
    const url = firstMatch(html, /var stream = '([^']+\.m3u8)'/i);
    if (!url) throw new Error("未找到可用播放地址");
    return {
        streams: [{
            url: url,
            format: "hls",
            headers: {"User-Agent": UA, "Referer": pageUrl},
            name: "亚洲素人精选",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
