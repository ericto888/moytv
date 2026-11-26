// AI短剧网 — idj1 插件（由内置 py 蜘蛛 aiduanju 改写）
// 站点：ai.aiduanjuwang8.cc（主）/ wap.aiduanjuwang6.cc（备），MacCMS 风格 HTML 站，
// 入口在 /rukou/ 下：首页/分类/详情/搜索都是服务端渲染页，播放页里
// player_aaaa 的 "url" 字段就是 m3u8 直链（带 \/ 转义，解开即用）。
// 详情页只列出已出现的集数链接，其余集数靠播放页的 link_next 逐集往后跟
// （与原 py 相同，上限 30 集；本站响应慢，跟集请求单独限量，避免详情超时）。
// 分类与原 py 1:1：优先从首页 <dt> 导航现解析（按 id 去重，首页里
// 119 同时挂「推荐」和「斯卡资源」两个名字，原 py 按 id 去重只留第一个），
// 解析不到时用原 py 的兜底 6 分类。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// 本站经本机出口单请求常要 30~55 秒，超时给足 60 秒（宿主上限）；
// 备域名只给 30 秒，避免主域名超时后在备域名上再白等一分钟。
const TIMEOUT = 60000;
const FALLBACK_TIMEOUT = 30000;
const FOLLOW_TIMEOUT = 60000;
const MAX_EPISODES = 30;
const MAX_FOLLOW_REQUESTS = 12;
// 跟集总预算：详情页打开后最多再花约 90 秒跟集，防止慢站把详情拖死。
const FOLLOW_BUDGET_MS = 90000;

const BASES = [
    "https://ai.aiduanjuwang8.cc",
    "https://wap.aiduanjuwang6.cc",
];
let curBase = BASES[0];

const FALLBACK_CATS = [
    ["119", "推荐"],
    ["370", "黄瓜资源"],
    ["329", "仓房资源"],
    ["286", "玉兔资源"],
    ["358", "番茄资源"],
    ["244", "155资源"],
];

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
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\\\//g, "/");
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return curBase + u;
    return u;
}

// 与原 py 的 _fetch 等价：先试当前可用域名，再试另一个；
// 哪个先回 200 就记为当前域名。原 py 对单域名失败还会重试一次，这里靠双域名兜底。
async function fetchText(path, timeout) {
    const order = [curBase].concat(BASES.filter((b) => b !== curBase));
    for (let i = 0; i < order.length; i++) {
        const base = order[i];
        try {
            const resp = await host.http.get(base + path, {
                headers: {
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Referer": base + "/rukou/",
                },
                timeout: timeout || (i === 0 ? TIMEOUT : FALLBACK_TIMEOUT),
            });
            if (resp.status === 200 && resp.body) {
                curBase = base;
                return resp.body;
            }
        } catch (error) {
            // 换下一个域名
        }
    }
    return null;
}

// ---------- 解析 ----------

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const pat = /<div class="vod">[\s\S]*?<img[^>]+data-original="([^"]+)"[^>]*>[\s\S]*?<div class="vod-txt"[^>]*>\s*<a href="\/rukou\/index\.php\/vod\/detail\/id\/(\d+)\.html"[^>]*>([^<]+)<\/a>/g;
    const seen = {};
    let m;
    while ((m = pat.exec(html)) !== null) {
        const vid = m[2].trim();
        if (!vid || seen[vid]) continue;
        seen[vid] = true;
        const title = unescapeHtml(m[3].trim());
        if (!title) continue;
        out.push({
            id: vid,
            title: title,
            cover: fixUrl(m[1]),
            remarks: "",
            duration: "",
            tags: [],
        });
    }
    return out;
}

function parseCategories(html) {
    const cats = [];
    if (html) {
        const pat = /<dt><a href="\/rukou\/index\.php\/vod\/type\/id\/(\d+)\.html"><b>([^<]+)<\/b><\/a><\/dt>/g;
        const seen = {};
        let m;
        while ((m = pat.exec(html)) !== null) {
            const cid = m[1].trim();
            const name = unescapeHtml(m[2].trim());
            if (!name || seen[cid]) continue;
            seen[cid] = true;
            cats.push({id: cid, name: name});
        }
    }
    if (!cats.length) {
        return FALLBACK_CATS.map((item) => ({id: item[0], name: item[1]}));
    }
    return cats;
}

function parseCover(html, title) {
    const pat = /<img src="([^"]+)" title="([^"]*)"/g;
    let m;
    while ((m = pat.exec(html)) !== null) {
        if (m[2].trim() === title) return fixUrl(m[1]);
    }
    const m2 = /<img[^>]+src="(https?:\/\/[^"]+\/upload\/vod\/[^"]+)"/.exec(html);
    if (m2) return fixUrl(m2[1]);
    return "";
}

function parsePlayerUrl(html) {
    if (!html) return "";
    const m = /player_aaaa=[\s\S]*?"url":"([^"]+)"/.exec(html);
    if (!m) return "";
    return unescapeHtml(m[1].trim());
}

// 沿播放页 link_next 逐集往后跟，与原 py 的 _follow_episodes 等价（上限 30 集）。
async function followEpisodes(nid, startEps) {
    const eps = startEps.slice();
    const seen = {};
    for (const ep of eps) seen[ep] = true;
    if (!eps.length) return eps;
    let cur = eps[eps.length - 1];
    let requests = 0;
    const startedAt = Date.now();
    while (eps.length < MAX_EPISODES && requests < MAX_FOLLOW_REQUESTS
        && Date.now() - startedAt < FOLLOW_BUDGET_MS) {
        requests++;
        const html = await fetchText(
            "/rukou/index.php/vod/play/id/" + nid + "/sid/1/nid/" + cur + ".html",
            FOLLOW_TIMEOUT);
        if (!html) break;
        const m = /"link_next":"([^"]*)"/.exec(html);
        const nxt = m ? unescapeHtml(m[1]) : "";
        const nm = /\/nid\/(\d+)\.html/.exec(nxt);
        if (!nm) break;
        const nxtNid = nm[1];
        if (seen[nxtNid]) break;
        seen[nxtNid] = true;
        eps.push(nxtNid);
        cur = nxtNid;
    }
    return eps;
}

function quotePlus(s) {
    return encodeURIComponent(str(s))
        .replace(/%20/g, "+")
        .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// ---------- idj1 契约 ----------

async function home() {
    const html = await fetchText("/rukou/");
    const categories = parseCategories(html);
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: false};
}

async function category(arg) {
    const tid = str(arg && arg.id) || FALLBACK_CATS[0][0];
    let page = Math.max(1, intValue(arg && arg.page, 1));
    const path = page <= 1
        ? "/rukou/index.php/vod/type/id/" + tid + ".html"
        : "/rukou/index.php/vod/type/id/" + tid + "/page/" + page + ".html";
    const html = await fetchText(path);
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    // 原 py 的搜索 URL 不带分页参数，各页结果相同，这里只回第一页。
    const html = await fetchText("/rukou/index.php/vod/search/wd/" + quotePlus(keyword) + ".html");
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const nid = raw.replace(/\D/g, "");
    if (!nid) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const html = await fetchText("/rukou/index.php/vod/detail/id/" + nid + ".html");
    if (!html) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    const tm = /<div class="title"><h3>([^<]+)<\/h3><\/div>/.exec(html);
    const title = tm ? unescapeHtml(tm[1].trim()) : "";
    if (!title) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    const cover = parseCover(html, title);
    const dm = /<meta name="description"[^>]*content="([^"]+)"/.exec(html);
    const desc = dm ? unescapeHtml(dm[1].trim()) : "";
    const epSet = {};
    const pat = /\/rukou\/index\.php\/vod\/play\/id\/\d+\/sid\/1\/nid\/(\d+)\.html/g;
    let m;
    while ((m = pat.exec(html)) !== null) epSet[m[1]] = true;
    let eps = Object.keys(epSet).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    if (!eps.length) eps = ["1"];
    eps = await followEpisodes(nid, eps);
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: desc,
        tags: [],
        lines: [{
            name: "在线播放",
            episodes: eps.map((ep) => ({id: nid + "-1-" + ep, name: "第" + ep + "集"})),
        }],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || "";
    if (raw.startsWith("aiduanju:")) raw = raw.slice("aiduanju:".length).trim();
    if (/^https?:\/\//i.test(raw)) {
        const format = /\.m3u8($|\?)/i.test(raw) ? "hls" : (raw.split("?")[0].split(".").pop() || "");
        return {
            streams: [{url: raw, format: format, headers: {"User-Agent": UA}, name: "在线播放"}],
            expiresAt: Date.now() + 30 * 60 * 1000,
        };
    }
    const parts = raw.split("-");
    if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[2])) {
        throw new Error("无效的播放 ID");
    }
    const playPage = "/rukou/index.php/vod/play/id/" + parts[0] + "/sid/" + parts[1] + "/nid/" + parts[2] + ".html";
    const html = await fetchText(playPage);
    const m3u8 = parsePlayerUrl(html);
    if (!m3u8) throw new Error("未找到播放地址");
    const format = /\.m3u8($|\?)/i.test(m3u8) ? "hls" : (m3u8.split("?")[0].split(".").pop() || "");
    return {
        streams: [{
            url: m3u8,
            format: format,
            headers: {"User-Agent": UA, "Referer": curBase + "/"},
            name: "在线播放",
        }],
        expiresAt: Date.now() + 30 * 60 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
