// YesPorn — idj1 插件（KVS 站 xyesporn.com 纯 HTML 抓取，无加密）
// 站点：https://xyesporn.com；免费、无需登录、无付费墙。
// 分类取自 https://xyesporn.com/categories/ 第 1–3 页（2026-11-24 实取，共 57 个，
// 与站导航 1:1；另加「最新」即首页最新列表 /latest-updates/）。
// 播放：详情页 flashvars 里 video_url（480p）与 video_alt_url（720p/1080p），
// 均为 /get_file/ 直链 mp4，play() 现取详情页挑最高画质。
// 注意：分类名照站原文（含 Teen 等站方标准分类）；排序/筛选（Top Rated 等）
// 是首页 AJAX 切换，无 idj 对应物，只保留最新列表。

const SITE = "https://xyesporn.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const PAGE_SIZE = 20;

// [slug, 显示名]，取自 /categories/ 第 1–3 页原文
const CATEGORIES = [
    ["anal", "Anal"], ["asian", "Asian"], ["bbc", "BBC"], ["bbw", "BBW"],
    ["bdsm", "BDSM"], ["big-ass", "Big Ass"], ["big-boobs", "Big Boobs"],
    ["big-tits", "Big tits"], ["blonde", "Blonde"], ["blowjob", "Blowjob"],
    ["brunette", "Brunette"], ["car", "Car"], ["cheating", "Cheating"],
    ["cosplay", "Cosplay"], ["creampie", "Creampie"], ["cuckold", "Cuckold"],
    ["curvy", "Curvy"], ["deep-throat", "Deep Throat"], ["doctor", "Doctor"],
    ["dp", "DP"], ["ebony", "Ebony"], ["facial", "Facial"], ["family", "Family"],
    ["feet", "Feet"], ["fetish", "Fetish"], ["gangbang", "Gangbang"],
    ["gilf", "GILF"], ["hairy-pussy", "Hairy Pussy"], ["hardcore", "Hardcore"],
    ["interracial", "Interracial"], ["japanese", "Japanese"], ["latina", "Latina"],
    ["lesbian", "Lesbians"], ["lingerie", "Lingerie"], ["massage", "Massage"],
    ["mature", "Mature"], ["milf", "MILF"], ["orgasm", "Orgasm"], ["orgy", "Orgy"],
    ["outdoor", "Outdoor"], ["pov", "POV"], ["public", "Public"], ["sex", "Sex"],
    ["sex-toys", "Sex Toys"], ["shaved-pussy", "shaved pussy"], ["skinny", "Skinny"],
    ["small-tits", "Small tits"], ["step-daughter", "Step Daughter"],
    ["step-sister", "Step sister"], ["stepmom", "Stepmom"],
    ["striptease", "Striptease"], ["swingers", "Swingers"], ["tattoo", "Tattoo"],
    ["teen", "Teen"], ["threesome", "Threesome"], ["uncategorized", "Uncategorized"],
    ["voyeur", "Voyeur"],
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

async function fetchText(url) {
    const resp = await host.http.request({
        url: url,
        method: "GET",
        headers: {
            "User-Agent": UA,
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": SITE + "/",
        },
        timeout: TIMEOUT,
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
    return resp.body == null ? "" : String(resp.body);
}

// 首页/列表页视频卡：<div data-vid="76432" ... class="thumb ...">
// <a href="https://xyesporn.com/video/76432/slug/" title="...">
// <img src=".../contents/videos_screenshots/76000/76432/390x218/1.jpg">
// <div class="time">8:00</div> … <span class="ypn ypn-strip">…1.2K</span>
function parseVideos(html) {
    const items = [];
    const seen = {};
    const chunks = html.split(/data-vid="/i).slice(1);
    for (const chunk of chunks) {
        const href = firstMatch(chunk, /<a[^>]+href="(https?:\/\/xyesporn\.com\/video\/\d+\/[^"\/]+\/)"/i)
            || firstMatch(chunk, /<a[^>]+href="(\/video\/\d+\/[^"\/]+\/)"/i);
        if (!href) continue;
        const id = href.replace(/^https?:\/\/xyesporn\.com\//i, "").replace(/\/$/, "");
        if (!id || seen[id]) continue;
        seen[id] = true;
        const title = cleanText(firstMatch(chunk, /<a[^>]+title="([^"]+)"/i));
        const cover = firstMatch(chunk, /<img[^>]+src="(https:[^"]*contents\/videos_screenshots[^"]+)"/i);
        const duration = cleanText(firstMatch(chunk, /<div class="time">([^<]+)<\/div>/i));
        const views = cleanText(firstMatch(chunk, /ypn-strip"[^>]*>[\s\S]{0,300}?([\d.,]+[KM]?)\s*<\/span>/i))
            || cleanText(firstMatch(chunk, /([\d.,]+[KM]?)\s*<\/span>/i));
        const remarks = [duration, views ? views + "次观看" : ""].filter(Boolean).join(" · ");
        items.push({
            id: id,
            title: title || id,
            cover: cover,
            remarks: remarks,
            duration: duration,
            tags: [],
        });
    }
    return items;
}

function pageCount(html, current) {
    // KVS 分类页分页是普通链接 /categories/<slug>/<N>/；首页分页是 AJAX，无链接可数
    const numbers = [];
    const regex = /\/(\d+)\/"[^>]*>(\d+)</gi;
    let match;
    while ((match = regex.exec(html)) !== null) numbers.push(parseInt(match[2], 10));
    if (!numbers.length) return current;
    return Math.max(current, Math.max.apply(null, numbers));
}

function listUrl(tid, page) {
    const pg = Math.max(1, parseInt(page, 10) || 1);
    if (tid === "latest") {
        return pg === 1 ? SITE + "/latest-updates/" : SITE + "/latest-updates/" + pg + "/";
    }
    if (tid.indexOf("cat/") === 0) {
        const slug = tid.slice(4);
        return pg === 1 ? SITE + "/categories/" + slug + "/" : SITE + "/categories/" + slug + "/" + pg + "/";
    }
    return "";
}

function allCategories() {
    const list = [{id: "latest", name: "最新"}];
    for (const item of CATEGORIES) {
        list.push({id: "cat/" + item[0], name: item[1]});
    }
    return list;
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
    return {categories: allCategories(), items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const tid = str(arg && arg.id);
    const url = listUrl(tid, page);
    if (!url) return {items: [], hasMore: false};
    let items = [];
    let hasMore = false;
    try {
        const html = await fetchText(url);
        items = parseVideos(html);
        const max = pageCount(html, page);
        hasMore = max > page || (max === page && items.length >= PAGE_SIZE);
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
        ? SITE + "/search/" + query + "/"
        : SITE + "/search/" + query + "/" + page + "/";
    let items = [];
    let hasMore = false;
    try {
        const html = await fetchText(url);
        items = parseVideos(html);
        const max = pageCount(html, page);
        hasMore = max > page || (max === page && items.length >= PAGE_SIZE);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: hasMore};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    if (!rawId) throw new Error("无效的影片 ID");
    const url = SITE + "/" + rawId.replace(/^\/+/, "") + "/";
    let html = "";
    try {
        html = await fetchText(url);
    } catch (error) {
        html = "";
    }
    const title = cleanText(firstMatch(html, /video_title:\s*'([^']+)'/i))
        || cleanText(firstMatch(html, /<title>([^<|]+)/i))
        || rawId;
    const description = cleanText(firstMatch(html, /<meta name="description" content="([^"]*)"/i));
    const duration = cleanText(firstMatch(html, /"duration" content="(\d+)"/i));
    const cover = firstMatch(html, /<meta property="og:image" content="([^"]+)"/i);
    const cats = cleanText(firstMatch(html, /video_categories:\s*'([^']*)'/i));
    const tagsRaw = cleanText(firstMatch(html, /video_tags:\s*'([^']*)'/i));
    const tags = unique((cats ? cats.split(",") : []).concat(tagsRaw ? tagsRaw.split(",") : [])
        .map(function (t) { return t.trim(); }).filter(Boolean));
    const desc = [description, cats ? "分类：" + cats : "", duration ? "片长：" + duration + "秒" : ""]
        .filter(Boolean).join("\n");
    return {
        id: rawId,
        title: title,
        cover: cover,
        desc: desc,
        duration: duration,
        tags: tags,
        lines: [{name: "YesPorn", episodes: [{id: rawId, name: "正片"}]}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    if (!raw) throw new Error("无效的播放地址");
    const url = SITE + "/" + raw.replace(/^\/+/, "") + "/";
    const html = await fetchText(url);
    // flashvars：video_url: 'function/0/<480p mp4>/'，video_url_text: '480p'；
    // video_alt_url: 'function/0/<720p mp4>', '720p', '1', 'function/0/<1080p mp4>', '1080p', '1'
    const urls = [];
    const urlRegex = /'function\/0\/(https:\/\/[^']+?\.mp4[^']*?)'/gi;
    let m;
    while ((m = urlRegex.exec(html)) !== null) urls.push(m[1].replace(/\/$/, ""));
    const labels = [];
    const labelRegex = /'(\d{3,4}p)'/g;
    while ((m = labelRegex.exec(html)) !== null) labels.push(m[1]);
    const cands = [];
    for (let i = 0; i < urls.length; i++) {
        const q = parseInt((labels[i] || "").replace("p", ""), 10) || 0;
        cands.push({url: urls[i], q: q});
    }
    if (!cands.length) throw new Error("未找到可用播放地址");
    cands.sort(function (a, b) { return b.q - a.q; });
    const best = cands[0];
    return {
        streams: [{
            url: best.url,
            format: "mp4",
            headers: {
                "User-Agent": UA,
                "Referer": SITE + "/",
            },
            name: "YesPorn",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
