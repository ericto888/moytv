// 顶级AI色库 — idj1 插件（由内置 py 蜘蛛 dingjiaseku 改写）
// 站点：yxql-imh-nh4d.taoquan26s111.cc，MacCMS（stui 模板）整站 HTML，无接口无加密。
// 根路径现在是引导页（无分类链接），分类按原 py 逻辑：先解析主页、解析不到就用写死的 4 个分类兜底。
// 播放：详情页取播放按钮 → 播放页 player_aaaa 里的 url 即 m3u8 直链，现取现用。
// 本机出口很慢（单请求 20–55 秒），超时放宽到 60 秒、重试 2 次。

const BASE = "https://yxql-imh-nh4d.taoquan26s111.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const RETRIES = 2;
const PAGE_SIZE = 12;

// 与原 py 的 CATS 兜底表 1:1（主页解析不到分类时使用）。
const CATS = [
    ["200", "特色仓库"],
    ["300", "黑料精品"],
    ["400", "热播片库"],
    ["500", "精品资源"],
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

// 对应原 py 的 _decode：HTML 实体解码 + \/ 还原。
function decodeText(s) {
    let out = str(s);
    if (!out) return "";
    out = out.replace(/&#x([0-9a-fA-F]+);/g, function (m, hex) {
        try { return String.fromCodePoint(parseInt(hex, 16)); } catch (e) { return m; }
    });
    out = out.replace(/&#(\d+);/g, function (m, dec) {
        try { return String.fromCodePoint(parseInt(dec, 10)); } catch (e) { return m; }
    });
    out = out.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
    return out.replace(/\\\//g, "/").trim();
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return BASE + u;
    return u;
}

async function getHtml(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) headers["Referer"] = referer;
    let lastError = null;
    for (let i = 0; i < RETRIES; i++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) host.log("dingjiaseku getHtml failed: " + url + " " + (lastError && lastError.message));
    return "";
}

// 与原 py 的 CARD_RE / _parse_cards 一致（同 id 去重、空标题丢弃）。
function parseCards(html) {
    const out = [];
    const seen = {};
    const re = /<a class="stui-vodlist__thumb[^"]*" href="\/vodplay\/(\d+)-1-1\/" title="([^"]*)" data-original="([^"]*)"/g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        const vid = m[1].trim();
        if (!vid || seen[vid]) continue;
        const title = decodeText(m[2]);
        if (!title) continue;
        seen[vid] = true;
        out.push({id: vid, title: title, cover: fixUrl(m[3]), remarks: "", duration: "", tags: []});
    }
    return out;
}

// 与原 py 的 _parse_categories 一致：只收以 00 结尾的分类 id、跳过「更多」。
function parseCategories(html) {
    const out = [];
    const seen = {};
    const re = /<a[^>]*href="\/vodtype\/(\d+)\/"[^>]*>([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        const cid = m[1];
        if (!/00$/.test(cid)) continue;
        const name = decodeText(m[2]);
        if (!name || name === "更多" || seen[cid]) continue;
        seen[cid] = true;
        out.push({id: cid, name: name});
    }
    return out;
}

async function fetchCats() {
    const html = await getHtml(BASE + "/", BASE + "/");
    const cats = parseCategories(html);
    if (cats.length) return cats;
    return CATS.map(function (item) { return {id: item[0], name: item[1]}; });
}

async function catalog(tid, pg) {
    const html = await getHtml(BASE + "/vodtype/" + tid + "-" + pg + "/", BASE + "/");
    return parseCards(html);
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = await fetchCats();
    let items = [];
    if (categories.length) {
        try { items = await catalog(categories[0].id, 1); } catch (e) { items = []; }
    }
    return {categories: categories, items: items, hasMore: items.length >= PAGE_SIZE};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || CATS[0][0];
    const items = await catalog(tid, page);
    return {items: items, hasMore: items.length >= PAGE_SIZE};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const html = await getHtml(BASE + "/vodsearch/" + encodeURIComponent(keyword) + "-------------/", BASE + "/");
    return {items: parseCards(html), hasMore: false};
}

async function detail(arg) {
    const id = str(arg && arg.id).trim();
    if (!id) throw new Error("无效的影片 ID");
    const html = await getHtml(BASE + "/voddetail/" + id + "/", BASE + "/");
    if (!html) throw new Error("详情页获取失败");
    const tm = /<h1 class="title">([^<]+)<\/h1>/.exec(html);
    const title = tm ? decodeText(tm[1]) : "";
    if (!title) throw new Error("详情页解析失败");
    const cm = /<div class="stui-content__thumb">[\s\S]*?<img[^>]+data-original="([^"]+)"/.exec(html);
    const cover = cm ? fixUrl(cm[1]) : "";
    const sm = /<p class="desc detail">[\s\S]*?<span class="left">简介：([\s\S]*?)<\/span>/.exec(html);
    const desc = sm ? decodeText(sm[1].replace(/<[^>]+>/g, "")) : "";
    const pm = /<div class="play-btn">\s*<a href="(\/vodplay\/\d+-1-1\/)">/.exec(html);
    const playUrl = fixUrl(pm ? pm[1] : "/vodplay/" + id + "-1-1/");
    return {
        id: id,
        title: title,
        cover: cover,
        desc: desc,
        tags: [],
        lines: [{name: "在线播放", episodes: [{id: playUrl, name: "第1集"}]}],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    if (raw.indexOf("dingjiaseku:") === 0) raw = raw.slice("dingjiaseku:".length);
    const url = fixUrl(raw);
    if (!url) throw new Error("无效的播放 ID");
    const headers = {"User-Agent": UA, "Referer": url};
    if (url.indexOf(".m3u8") >= 0) {
        return {streams: [{url: url, format: "hls", headers: headers, name: "在线播放"}], expiresAt: Date.now() + 3600 * 1000};
    }
    const html = await getHtml(url, BASE + "/");
    let m3u8 = "";
    if (html) {
        const m = /player_aaaa=[\s\S]*?"url":"([^"]+)"/.exec(html);
        if (m) m3u8 = decodeText(m[1]);
    }
    if (!m3u8) throw new Error("未找到可用的播放地址");
    const format = /\.m3u8($|\?)/i.test(m3u8) ? "hls" : "";
    return {streams: [{url: m3u8, format: format, headers: headers, name: "在线播放"}], expiresAt: Date.now() + 3600 * 1000};
}

export default {home: home, category: category, search: search, detail: detail, play: play};
