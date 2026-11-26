// HBook — idj1 插件（由内置 py 蜘蛛 hbook 改写，1:1）
// 站点：https://hbook.tv；HTML 站，列表/详情页正则提取，
// 详情页内嵌 `const source = "..."` 即播放地址（HLS），
// play 时现取详情页解析。第二线路靠 Cookie video_cdn_preference=bunny
// 切换 CDN 偏好——宿主禁发 Cookie 头，该头会被剥离，故第二线路在本
// 宿主下通常与第一线路同源、会被去重，逻辑仍按原 py 保留。

const BASE = "https://hbook.tv";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BUNNY_COOKIE = "video_cdn_preference=bunny";
const TIMEOUT = 60000;

const CATS = [
    ["latest", "最新视频", "/video"],
    ["free", "免费试看", "/free"],
    ["genre9", "中文字幕", "/genre/9"],
    ["actress", "女优", "/actress"],
    ["genre1", "痴女", "/genre/1"],
    ["genre2", "恋足", "/genre/2"],
    ["genre7", "高清", "/genre/7"],
    ["genre8", "独家", "/genre/8"],
    ["genre14", "后宫", "/genre/14"],
    ["genre17", "4K", "/genre/17"],
    ["genre37", "人妻", "/genre/37"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function unescapeHtml(s) {
    if (!s) return "";
    return String(s)
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)));
}

function unescape(s) {
    if (!s) return "";
    return unescapeHtml(s).replace(/\\\//g, "/").replace(/&nbsp;/g, " ").trim();
}

function stripTags(s) {
    if (!s) return "";
    return unescape(String(s).replace(/<[^>]+>/g, ""));
}

function fixUrl(raw) {
    const u = unescape(raw);
    if (!u) return "";
    if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("data:")) return u;
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASE + u;
    return u;
}

function headers(cookie) {
    const h = {
        "User-Agent": UA,
        "Referer": BASE + "/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    // 原 py 靠此 Cookie 切 CDN 偏好；宿主禁发 Cookie 会被剥离，保留以对齐原逻辑。
    if (cookie) h["Cookie"] = cookie;
    return h;
}

async function httpGet(url, cookie) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(cookie), timeout: TIMEOUT});
            if (resp && resp.body) return resp.body;
        } catch (error) {
            // 重试
        }
    }
    return "";
}

// ---------- 列表解析（与原 py 正则 1:1） ----------

function parseCards(html) {
    const out = [];
    const seen = {};
    const parts = String(html || "").split('href="https://hbook.tv/v/');
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        const slug = part.split('"', 1)[0].trim();
        if (!slug || seen[slug]) continue;
        seen[slug] = true;
        const block = part.slice(0, 4000);
        const pm = /data-src="([^"]+)"/.exec(block);
        const pic = pm ? fixUrl(pm[1]) : "";
        const am = /alt="([^"]*)"/.exec(block);
        let name = am ? stripTags(am[1]) : "";
        if (!name) name = slug;
        const dm = /bottom-1 right-1[^>]*>\s*([\d:]+)\s*</.exec(block);
        out.push({
            id: slug,
            title: name,
            cover: pic,
            remarks: dm ? dm[1] : "",
            duration: dm ? dm[1] : "",
            tags: [],
        });
    }
    return out;
}

function parseActresses(html) {
    const out = [];
    const seen = {};
    const re = /href="https:\/\/hbook\.tv\/actress\/(\d+)" title="([^"]+)"/g;
    let m;
    const text = String(html || "");
    while ((m = re.exec(text)) !== null) {
        const aid = m[1];
        if (seen[aid]) continue;
        seen[aid] = true;
        const block = text.slice(m.index, m.index + 2500);
        const pm = /<img[^>]+src="([^"]+)"/.exec(block);
        const pic = pm ? fixUrl(pm[1]) : "";
        const cm = /(\d+)部影片/.exec(block);
        out.push({
            id: "actress:" + aid,
            title: stripTags(m[2]),
            cover: pic,
            remarks: cm ? cm[1] + "部影片" : "",
            tags: [],
        });
    }
    return out;
}

function detailSource(html) {
    const m = /const source = "([^"]+)"/.exec(String(html || ""));
    return m ? unescape(m[1]) : "";
}

async function detailSourceLive(slug, cookie) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const html = await httpGet(BASE + "/v/" + slug, cookie);
        if (html) {
            const src = detailSource(html);
            if (src) return src;
        }
    }
    return "";
}

function catPath(tid) {
    for (const c of CATS) if (c[0] === tid) return c[2];
    return "/video";
}

async function catalog(tid, pg) {
    if (tid === "actress") {
        const html = await httpGet(BASE + "/actress?page=" + pg);
        return parseActresses(html);
    }
    if (tid === "free") {
        if (pg > 1) return [];
        const html = await httpGet(BASE + "/free");
        return parseCards(html);
    }
    const html = await httpGet(BASE + catPath(tid) + "?page=" + pg);
    return parseCards(html);
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    const items = await catalog("latest", 1);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "latest";
    const items = await catalog(tid, page);
    return {items: items, hasMore: tid !== "free" && items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const html = await httpGet(BASE + "/search?q=" + encodeURIComponent(keyword));
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const raw = arg && arg.id;
    const nid = str(Array.isArray(raw) ? raw[0] : raw);
    if (!nid) return {id: "", title: "", cover: "", desc: "", tags: [], lines: []};

    if (nid.startsWith("actress:")) {
        const aid = nid.slice("actress:".length);
        const html = await httpGet(BASE + "/actress/" + aid);
        if (!html) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
        const tm = /<title>(.*?)<\/title>/.exec(html);
        let name = tm ? stripTags(tm[1]) : "";
        name = name.replace("日本av女优 - 小黄书 hbook.tv", "").trim();
        if (!name) name = "女优 " + aid;
        const works = parseCards(html);
        const pic = works.length ? works[0].cover : "";
        const episodes = works.map((w) => ({id: "hbook:" + w.id, name: w.title}));
        return {
            id: nid,
            title: name,
            cover: pic,
            desc: "",
            tags: ["女优"],
            lines: episodes.length ? [{name: "在线播放", episodes: episodes}] : [],
        };
    }

    const slug = nid;
    const html = await httpGet(BASE + "/v/" + slug);
    if (!html) return {id: slug, title: slug, cover: "", desc: "", tags: [], lines: []};
    const hm = /<h1[^>]*>(.*?)<\/h1>/.exec(html);
    const title = hm ? stripTags(hm[1]) : "";
    const pm = /data-poster="([^"]+)"/.exec(html);
    const poster = pm ? fixUrl(pm[1]) : "";
    let synopsis = "";
    const h2re = /<h2[^>]*>(.*?)<\/h2>/g;
    let h2m;
    while ((h2m = h2re.exec(html)) !== null) {
        const t = stripTags(h2m[1]);
        if (t.length >= 20) { synopsis = t; break; }
    }
    const actors = [];
    const are = /href="https:\/\/hbook\.tv\/actress\/(\d+)"[^>]*>([^<]+)</g;
    let am;
    while ((am = are.exec(html)) !== null) {
        const an = stripTags(am[2]);
        if (an && actors.indexOf(an) < 0) actors.push(an);
        if (actors.length >= 5) break;
    }
    let remarks = "";
    const dm = /title="视频时长".*?<\/svg>\s*([\d:]+)/.exec(html);
    if (dm) remarks = dm[1];
    const vm = /title="观看次数".*?<\/svg>\s*([\d,]+)/.exec(html);
    if (vm) remarks = (remarks + " | " + vm[1]).replace(/^ \| | \| $/g, "").trim();

    const source = detailSource(html);
    const episodes = [];
    if (source) {
        const label = source.indexOf("preview_manifest") >= 0 ? "预览" : "在线播放";
        episodes.push({id: "hbook:" + slug, name: label});
    }
    const src2 = await detailSourceLive(slug, BUNNY_COOKIE);
    if (src2 && src2 !== source) {
        episodes.push({id: "hbook:bunny:" + slug, name: "线路2"});
    }

    const parts = [];
    if (synopsis) parts.push(synopsis);
    else if (title) parts.push(title);
    if (actors.length) parts.push("演员：" + actors.join(" / "));
    if (remarks) parts.push("时长/观看：" + remarks);
    if (poster) parts.push("本片剧照：\n" + poster);

    return {
        id: slug,
        title: title || slug,
        cover: poster,
        desc: parts.join("\n"),
        duration: dm ? dm[1] : "",
        tags: [],
        lines: episodes.length ? [{name: "在线播放", episodes: episodes}] : [],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.startsWith("hbook:")) raw = raw.slice("hbook:".length);
    let slug = raw;
    let cookie = null;
    if (raw.startsWith("bunny:")) {
        slug = raw.slice("bunny:".length);
        cookie = BUNNY_COOKIE;
    }
    if (!slug) throw new Error("无效的播放 ID");
    const source = await detailSourceLive(slug, cookie);
    if (!source) throw new Error("未取到播放地址");
    const isHls = /\.m3u8($|\?)/i.test(source);
    return {
        streams: [{
            url: source,
            format: isHls ? "hls" : "mp4",
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
            name: "HBook",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
