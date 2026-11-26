// OKXXX — idj1 插件（KVS 站 ok.xxx 纯 HTML 抓取，无加密）
// 站点：https://ok.xxx（OK.XXX）。免费、无需登录、无付费墙、无 CF 挡（本机出口 200）。
// 站导航：New（首页）/ Popular / Trending / Tags / Models / Channels；
// 其中 Tags（数千标签）、Models、Channels 是索引页、不是视频列表，未做成分类
// （见 NOTES.md）；分类只保留三路视频列表：最新 / 热门 / 趋势。
// 播放：详情页 <video> 内 <source src label="360p|480p|720p">，均为 /get_file/ 直链；
// 实测该地址回 m3u8 主清单（非 mp4 文件），play() 取最高画质、format 标 hls。

const SITE = "https://ok.xxx";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const PAGE_SIZE = 59;

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

// 视频卡：<div class="  item thumb-bl thumb-bl-video ...">
// <a href="/video/808601/" title="Morning Blowjob" ...>
// <img class="thumb lazy-load" ... data-original="https://static.ok.xxx/contents/videos_screenshots/808000/808601/640x360/1.jpg">
// <ul class="video-meta"><li><i class="fa fa-clock-o"></i> <span>42:25</span></li>
// <li><i class="fa fa-calendar-o"></i> <span>10 hours ago</span></li>
// <li><i class="fa fa-eye"></i> <span>44K</span></li></ul>
function parseVideos(html) {
    const items = [];
    const seen = {};
    const chunks = html.split(/thumb-bl-video/i).slice(1);
    for (const chunk of chunks) {
        const href = firstMatch(chunk, /<a[^>]+href="(\/video\/\d+\/)"/i);
        if (!href) continue;
        const id = href.replace(/^\/|\/$/g, "");
        if (!id || seen[id]) continue;
        seen[id] = true;
        const title = cleanText(firstMatch(chunk, /<a[^>]+href="\/video\/\d+\/"[^>]*title="([^"]+)"/i));
        const cover = firstMatch(chunk, /data-original="(https:[^"]+)"/i)
            || firstMatch(chunk, /<img[^>]+src="(https:[^"]*contents\/videos_screenshots[^"]+)"/i);
        const duration = cleanText(firstMatch(chunk, /fa-clock-o[\s\S]{0,60}?<span>([^<]+)<\/span>/i));
        const views = cleanText(firstMatch(chunk, /fa-eye[\s\S]{0,60}?<span>([^<]+)<\/span>/i));
        const when = cleanText(firstMatch(chunk, /fa-calendar-o[\s\S]{0,60}?<span>([^<]+)<\/span>/i));
        const remarks = [duration, views ? views + "次观看" : "", when].filter(Boolean).join(" · ");
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

function listUrl(tid, page) {
    const pg = Math.max(1, parseInt(page, 10) || 1);
    let base = "";
    if (tid === "latest") base = SITE + "/";
    else if (tid === "hot") base = SITE + "/popular/";
    else if (tid === "trending") base = SITE + "/trending/";
    else return "";
    return pg === 1 ? base : base + pg + "/";
}

function allCategories() {
    return [
        {id: "latest", name: "最新"},
        {id: "hot", name: "热门"},
        {id: "trending", name: "趋势"},
    ];
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
    return {categories: allCategories(), items: items, hasMore: items.length >= PAGE_SIZE};
}

async function category(arg) {
    const page = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const tid = str(arg && arg.id);
    const url = listUrl(tid, page);
    if (!url) return {items: [], hasMore: false};
    let items = [];
    try {
        const html = await fetchText(url);
        items = parseVideos(html);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: items.length >= PAGE_SIZE};
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
    try {
        const html = await fetchText(url);
        items = parseVideos(html);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: items.length >= PAGE_SIZE};
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
    let title = cleanText(firstMatch(html, /<title>([^<]+)<\/title>/i));
    title = title.replace(/^Video\s*🌶️\s*/i, "").replace(/\s*-\s*OK\.XXX\s*$/i, "") || rawId;
    const description = cleanText(firstMatch(html, /<meta name="description" content="([^"]*)"/i));
    const duration = cleanText(firstMatch(html, /"duration":\s*"([^"]+)"/i));
    const cover = firstMatch(html, /<meta property="og:image" content="([^"]+)"/i);
    const models = [];
    const modelRegex = /href="\/models\/[^"]+"[^>]*>([^<]+)<\/a>/gi;
    let mm;
    while ((mm = modelRegex.exec(html)) !== null) {
        const name = cleanText(mm[1]);
        if (name) models.push(name);
    }
    const tags = unique(models);
    const desc = [description, models.length ? "演员：" + models.join("、") : "", duration ? "片长：" + duration : ""]
        .filter(Boolean).join("\n");
    return {
        id: rawId,
        title: title,
        cover: cover,
        desc: desc,
        duration: duration,
        tags: tags,
        lines: [{name: "OKXXX", episodes: [{id: rawId, name: "正片"}]}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    if (!raw) throw new Error("无效的播放地址");
    const url = SITE + "/" + raw.replace(/^\/+/, "") + "/";
    const html = await fetchText(url);
    const cands = [];
    const srcRegex = /<source[^>]+src="([^"]+)"[^>]*label="([^"]+)"/gi;
    let m;
    while ((m = srcRegex.exec(html)) !== null) {
        const q = parseInt(m[2].replace(/[^0-9]/g, ""), 10) || 0;
        cands.push({url: m[1], q: q});
    }
    if (!cands.length) throw new Error("未找到可用播放地址");
    cands.sort(function (a, b) { return b.q - a.q; });
    const best = cands[0];
    // 注意：get_file 地址以 .mp4/ 结尾，但 2026-11-24 实测回的是 m3u8 主清单
    //（content-type: application/vnd.apple.mpegurl，含 360/480 等多 variant），
    // 故 format 标 hls；若手机上播不通再改回 mp4。
    return {
        streams: [{
            url: best.url,
            format: "hls",
            headers: {
                "User-Agent": UA,
                "Referer": SITE + "/",
            },
            name: "OKXXX",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
