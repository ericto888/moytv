// HQPorner — idj1 插件（由 CatVod 蜘蛛 hqporner v1.0.1 改写）
// 站点：https://hqporner.com；纯 HTML 正则抓取，无加密；详情页嵌 mydaddy.cc
// 播放页，play() 抓该页取最高画质 mp4 直链。
//
// 相对原蜘蛛丢掉 / 降级的能力：
// - 女优分类原来是 CatVod 的 vod_tag:"folder" 文件夹语义，idj 契约里没有文件夹
//   原语——改成：分类里的女优点开后进详情页，详情页只有一条线路「该女优作品」
//   （分集就是该女优的作品，点分集直接播）；女优页只取第 1 页作品，不翻页。
// - link() 女优 / 分类跳转是 CatVod 语义，丢掉；女优名与分类名只留在详情简介
//   与标签里。
// - play() 多一层：女优作品分集的 id 是视频页 id（hdporn/xxx.html），先抓详情
//   页拿 mydaddy 嵌页地址，再抓嵌页取 mp4；正片分集的 id 本来就是 play/<嵌页地址>。

const SITE = "https://hqporner.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 20000;
const PAGE_SIZE = 50;

// 64 个分类，取自 https://hqporner.com/categories
const CATEGORIES = [
    ["1080p-porn", "1080p porn"], ["4k-porn", "4k porn"], ["60fps-porn", "60fps"],
    ["amateur", "amateur"], ["anal-sex-hd", "anal"], ["asian", "asian"],
    ["babe", "babe"], ["bdsm", "bdsm"], ["beach-porn", "beach"],
    ["big-ass", "big ass"], ["big-dick", "big dick"], ["big-tits", "big tits"],
    ["bisexual", "bisexual"], ["blonde", "blonde"], ["blowjob", "blowjob"],
    ["bondage", "bondage"], ["brunette", "brunette"], ["casting", "casting"],
    ["creampie", "creampie"], ["cumshot", "cumshot"], ["deepthroat", "deepthroat"],
    ["ebony", "ebony"], ["fetish", "fetish"], ["fingering", "fingering"],
    ["fisting", "fisting"], ["gangbang", "gangbang"], ["group-sex", "group sex"],
    ["hairy-pussy", "hairy pussy"], ["handjob", "handjob"], ["hentai", "hentai"],
    ["interracial", "interracial"], ["japanese-girls-porn", "japanese"], ["latina", "latina"],
    ["lesbian", "lesbian"], ["long-hair", "long hair"], ["masturbation", "masturbation"],
    ["mature", "mature"], ["milf", "milf"], ["moaning", "moaning"],
    ["old-and-young", "old and young"], ["orgasm", "orgasm"], ["orgy", "orgy"],
    ["outdoor", "outdoor"], ["pickup", "pickup"], ["pov", "pov"],
    ["public", "public"], ["pussy-licking", "pussy licking"], ["redhead", "redhead"],
    ["russian", "russian"], ["porn-massage", "sex massage"], ["sex-parties", "sex party"],
    ["shaved-pussy", "shaved pussy"], ["shemale", "shemale"], ["small-tits", "small tits"],
    ["squeezing-tits", "squeezing tits"], ["squirt", "squirt"], ["stockings", "stockings"],
    ["tattooed", "tattooed"], ["teen-porn", "teen porn"], ["threesome", "threesome"],
    ["undressing", "undressing"], ["uniforms", "uniforms"], ["vibrator", "vibrator"],
    ["vintage", "vintage"],
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

function pageCount(html, current) {
    const block = firstMatch(html, /<ul class="actions pagination">([\s\S]*?)<\/ul>/i);
    if (!block) return current;
    const numbers = [];
    const regex = /href="[^"]*?(?:[?&]p=|\/)(\d+)[^"]*"/gi;
    let match;
    while ((match = regex.exec(block)) !== null) numbers.push(parseInt(match[1], 10));
    if (!numbers.length) return current;
    const max = Math.max.apply(null, numbers);
    return Math.max(current, isFinite(max) ? max : current);
}

function parseVideos(html, site) {
    const items = [];
    const seen = {};
    const chunks = html.split(/<section class="box feature"/i).slice(1);
    for (const chunk of chunks) {
        const href = firstMatch(chunk, /href="(\/hdporn\/[^"'<> ]+\.html)"/i);
        if (!href) continue;
        const id = href.replace(/^\//, "");
        if (seen[id]) continue;
        seen[id] = true;

        const pic = firstMatch(chunk, /<img[^>]+id="cover_\d+"[^>]+src="([^"]+)"/i)
            || firstMatch(chunk, /<img[^>]+src="([^"]+)"/i);
        const title = cleanText(firstMatch(chunk, /<h3 class="meta-data-title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i));
        const remarks = cleanText(firstMatch(chunk, /<span class="icon fa-clock-o meta-data">([\s\S]*?)<\/span>/i));
        items.push({
            id: id,
            title: title || id,
            cover: absUrl(pic, site),
            remarks: remarks,
            duration: remarks,
            tags: [],
        });
    }
    return items;
}

function parseActresses(html) {
    const items = [];
    const seen = {};
    const regex = /href="(\/actress\/[^"'<> ]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const slug = match[1].replace(/^\/actress\//, "").replace(/\/$/, "");
        const name = cleanText(match[2]);
        if (!slug || seen[slug]) continue;
        seen[slug] = true;
        items.push({
            id: "actress/" + slug,
            title: name || slug.replace(/-/g, " "),
            cover: "",
            remarks: "女优",
            duration: "",
            tags: ["女优"],
        });
    }
    return items;
}

function parseQualities(html) {
    const urls = [];
    const regex = /(?:(?:https?:)?\/\/[a-z0-9.-]+)?\/pubs\/[^"'<>\s]+?\.(?:mp4)/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        let url = match[0];
        if (/^\/\//.test(url)) url = "https:" + url;
        else if (/^\//.test(url)) url = "https://bigcdn.cc" + url;
        else if (!/^https?:/i.test(url)) url = "https://" + url;
        urls.push(url.split("&amp;")[0]);
    }
    return unique(urls);
}

function qualityScore(url) {
    if (/(2160|4k)/i.test(url)) return 2160;
    if (/1080/i.test(url)) return 1080;
    if (/720/i.test(url)) return 720;
    if (/480/i.test(url)) return 480;
    if (/360/i.test(url)) return 360;
    return 0;
}

function pickBestUrl(html) {
    const urls = parseQualities(html);
    if (!urls.length) return "";
    let best = urls[0];
    let score = qualityScore(best);
    for (const url of urls) {
        const value = qualityScore(url);
        if (value > score) {
            best = url;
            score = value;
        }
    }
    return best;
}

async function fetchText(url, referer) {
    const resp = await host.http.request({
        url: url,
        method: "GET",
        headers: {
            "User-Agent": UA,
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": referer || SITE + "/",
        },
        timeout: TIMEOUT,
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
    return resp.body == null ? "" : String(resp.body);
}

function videoUrl(tid, pg) {
    const page = Math.max(1, parseInt(pg, 10) || 1);
    const base = SITE;
    if (tid === "latest") return page === 1 ? base + "/" : base + "/hdporn/" + page;
    if (tid === "hot") return page === 1 ? base + "/top" : base + "/top/" + page;
    if (tid === "hot-month") return page === 1 ? base + "/top/month" : base + "/top/month/" + page;
    if (tid === "hot-week") return page === 1 ? base + "/top/week" : base + "/top/week/" + page;
    if (tid.indexOf("cat/") === 0) {
        const slug = tid.slice(4);
        return page === 1 ? base + "/category/" + slug : base + "/category/" + slug + "/" + page;
    }
    if (tid.indexOf("actress/") === 0) {
        const slug = tid.slice(8);
        return page === 1 ? base + "/actress/" + slug : base + "/actress/" + slug + "/" + page;
    }
    return "";
}

function allCategories() {
    const list = [
        {id: "latest", name: "最新"},
        {id: "hot", name: "热门"},
        {id: "hot-month", name: "热门-月榜"},
        {id: "hot-week", name: "热门-周榜"},
        {id: "actress", name: "女优"},
    ];
    for (const item of CATEGORIES) {
        list.push({id: "cat/" + item[0], name: item[1]});
    }
    return list;
}

// ---------- idj1 契约 ----------

async function home() {
    let items = [];
    let hasMore = false;
    try {
        const html = await fetchText(SITE + "/");
        items = parseVideos(html, SITE);
        hasMore = pageCount(html, 1) > 1;
    } catch (error) {
        items = [];
    }
    return {categories: allCategories(), items: items, hasMore: hasMore};
}

async function category(arg) {
    const page = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const tid = str(arg && arg.id);
    if (tid === "actress") {
        let list = [];
        try {
            const html = await fetchText(SITE + "/");
            list = parseActresses(html);
        } catch (error) {
            list = [];
        }
        return {items: list, hasMore: false};
    }
    const url = videoUrl(tid, page);
    if (!url) return {items: [], hasMore: false};
    let items = [];
    let hasMore = false;
    try {
        const html = await fetchText(url);
        items = parseVideos(html, SITE);
        hasMore = pageCount(html, page) > page;
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
        ? SITE + "/?q=" + query
        : SITE + "/?q=" + query + "&p=" + page;
    let items = [];
    let hasMore = false;
    try {
        const html = await fetchText(url);
        items = parseVideos(html, SITE);
        hasMore = pageCount(html, page) > page;
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: hasMore};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    if (!rawId) throw new Error("无效的影片 ID");

    // 女优文件夹：详情页只有一条线路「该女优作品」，分集即该女优的作品（第 1 页）。
    if (rawId.indexOf("actress/") === 0) {
        const slug = rawId.slice(8);
        let videos = [];
        try {
            const html = await fetchText(SITE + "/actress/" + slug);
            videos = parseVideos(html, SITE);
        } catch (error) {
            videos = [];
        }
        return {
            id: rawId,
            title: slug.replace(/-/g, " "),
            cover: "",
            desc: "",
            tags: ["女优"],
            lines: [{
                name: "该女优作品",
                episodes: videos.map((video) => ({id: video.id, name: video.title})),
            }],
        };
    }

    const id = rawId.replace(/^\/?hdporn\//, "");
    let html = "";
    try {
        html = await fetchText(SITE + "/hdporn/" + id);
    } catch (error) {
        html = "";
    }
    const title = cleanText(firstMatch(html, /<h1 class="main-h1"[^>]*>([\s\S]*?)<\/h1>/i));
    if (!title) {
        return {id: rawId, title: rawId, cover: "", desc: "", tags: [], lines: []};
    }
    const description = cleanText(firstMatch(html, /<meta name="description" content="([^"]*)"/i));
    const date = cleanText(firstMatch(html, /<li class="icon fa-calendar">([\s\S]*?)<\/li>/i));
    const duration = cleanText(firstMatch(html, /<li class="icon fa-clock-o">([\s\S]*?)<\/li>/i));

    const categories = [];
    const catRegex = /href="(\/category\/[^"'<> ]+)"[^>]*class="[^"]*tag-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let catMatch;
    while ((catMatch = catRegex.exec(html)) !== null) {
        categories.push(cleanText(catMatch[2]));
    }

    const actors = [];
    const actorRegex = /href="(\/actress\/[^"'<> ]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let actorMatch;
    while ((actorMatch = actorRegex.exec(html)) !== null) {
        const slug = actorMatch[1].replace(/^\/actress\//, "").replace(/\/$/, "");
        const name = cleanText(actorMatch[2]);
        if (slug && name) actors.push(name);
    }

    const embedRaw = firstMatch(html, /((?:https?:)?\/\/mydaddy\.cc\/video\/[a-z0-9]+\/)/i);
    const embed = embedRaw ? absUrl(embedRaw, "https://mydaddy.cc") : "";
    const playId = embed ? "play/" + encodeURIComponent(embed) : "";
    const desc = [description, duration, date, actors.length ? "女优：" + unique(actors).join("、") : ""]
        .filter(Boolean).join("\n");
    return {
        id: rawId,
        title: title,
        cover: "",
        desc: desc,
        duration: duration,
        tags: unique(categories),
        lines: playId ? [{name: "HQPorner", episodes: [{id: playId, name: "正片"}]}] : [],
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    if (!raw) throw new Error("无效的播放地址");
    let embed = "";
    if (raw.indexOf("play/") === 0) {
        try {
            embed = decodeURIComponent(raw.slice(5));
        } catch (error) {
            throw new Error("无效的播放地址");
        }
    } else {
        // 女优作品分集：id 是视频页 id，先抓详情页拿 mydaddy 嵌页地址。
        const vid = raw.replace(/^\/?hdporn\//, "");
        const html = await fetchText(SITE + "/hdporn/" + vid);
        embed = firstMatch(html, /((?:https?:)?\/\/mydaddy\.cc\/video\/[a-z0-9]+\/)/i);
        if (!embed) throw new Error("未找到可用播放地址");
    }
    embed = absUrl(embed, "https://mydaddy.cc");
    if (!/^https?:\/\/mydaddy\.cc\//i.test(embed)) throw new Error("无效的播放地址");
    const html = await fetchText(embed, SITE + "/");
    const url = pickBestUrl(html);
    if (!url) throw new Error("未找到可用播放地址");
    return {
        streams: [{
            url: url,
            format: "mp4",
            headers: {
                "User-Agent": UA,
                "Referer": "https://mydaddy.cc/",
            },
            name: "HQPorner",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
