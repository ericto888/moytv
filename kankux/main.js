// 看裤X — idj1 插件（由内置 py 蜘蛛 kankux 改写）
// 站点：kankux.com，纯 HTML 正则提取（与原 py 同一套规则），无登录、无付费墙。
// 分类与原 py 1:1：优先解析 /list.php 导航（不到 50 个再合并首页导航、
// 再回退原 py 写死的 75 个分类），照搬原 py 的屏蔽集 {14, 76} 过滤后按编号排序，
// home 首位另加「全部」（原 py homeContent 的固定项）。
// 详情页给出三条线路（全球/亚洲/中国大陆加速节点），播放页直取 m3u8。
// 本机出口慢：单请求超时 60 秒、失败重试 3 次（与原 py 一致）。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const BASE = "https://kankux.com";

const CATS = [
    ["1", "国产厂牌"], ["2", "SM调教"], ["3", "强奸迷奸"], ["4", "乱伦"],
    ["5", "丝袜制服"], ["6", "网曝黑料"], ["7", "主播网红"], ["8", "自拍偷拍"],
    ["9", "素人特摄"], ["10", "无码高清"], ["11", "经典有码"], ["12", "性感网红"],
    ["13", "激情H漫"], ["15", "伦理三级"], ["16", "日韩精选"], ["17", "国产精选"],
    ["18", "欧美精选"], ["19", "VR专区"], ["20", "中文字幕"], ["21", "口交自慰"],
    ["22", "3D"], ["23", "群交多P"], ["24", "重口调教"], ["25", "AI换脸"],
    ["60", "91视频"], ["61", "麻豆视频"], ["62", "成人头条"], ["63", "蜜桃传媒"],
    ["64", "皇家华人"], ["65", "星空传媒"], ["66", "精东影业"], ["67", "海角社区"],
    ["68", "91制片厂"], ["69", "乌鸦传媒"], ["70", "兔子先生"], ["71", "杏吧原创"],
    ["72", "玩偶姐姐"], ["73", "mini传媒"], ["74", "天美传媒"], ["75", "大象传媒"],
    ["77", "PsychoPorn"], ["78", "糖心Vlog"], ["79", "性视界"], ["80", "日韩精品"],
    ["81", "国产主播"], ["82", "强奸乱伦"], ["83", "人妻系列"], ["85", "巨乳尤物"],
    ["86", "自慰系列"], ["88", "群P换妻"], ["89", "教师学生"], ["90", "制服诱惑"],
    ["91", "日韩无码"], ["92", "口交视频"], ["93", "AV明星"], ["94", "成人动漫"],
    ["95", "颜值正义"], ["96", "颜射系列"], ["97", "吃瓜黑料"], ["98", "SM重味"],
    ["99", "直播裸聊"], ["100", "酒店探花"], ["101", "国产传媒"], ["102", "欧美劲爆"],
    ["103", "反差母狗"], ["104", "AV解说"], ["105", "熟女少妇"], ["107", "伦理影片"],
    ["108", "撸管必看"], ["109", "学生空姐"], ["111", "野战车震"], ["112", "家庭乱伦"],
    ["113", "偷情少妇"], ["114", "百合女同"], ["116", "AI短剧"],
];

const BLOCKED_CATS = {"14": true, "76": true};

const NODES = [
    ["global", "全球加速节点"],
    ["asia", "亚洲加速节点"],
    ["china", "中国大陆加速节点"],
];

const CARD_RE = /<a\s+href="\/video\/(\d+)\.html">\s*<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/gs;
const CAT_RE = /<a[^>]*href="\/list\/(\d+)\.html"[^>]*>\s*([^<]+?)\s*<\/a>/gs;
const TITLE_RE = /<title[^>]*>(.*?)<\/title>/s;
const OGIMG_RE = /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/s;
const PLAYLINK_RE = /<a[^>]*href="\/play\/(\d+)\.html\?node=([a-z]+)"[^>]*>(.*?)<\/a>/gs;
const M3U8_DQ_RE = /"(https?:\/\/[^"\s]+\.m3u8(?:\?[^"\s]*)?)"/;
const M3U8_SQ_RE = /'(https?:\/\/[^'\s]+\.m3u8(?:\?[^'\s]*)?)'/;
const SRC_RE = /<(?:source|video)[^>]+src="([^"]+)"/gs;
const URLVAR_RE = /(?:videoUrl|playUrl|m3u8|source|url)\s*[:=]\s*"([^"]+)"/gs;
const VIEWS_RE = /([\d,]+)\s*次观看/;
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function unescapeHtml(s) {
    let out = str(s);
    if (!out) return "";
    out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)));
    out = out.replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)));
    out = out.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
    return out.trim();
}

function stripTags(s) {
    return str(s).replace(/<[^>]+>/g, "");
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASE + u;
    return u;
}

// ---------- HTTP ----------

async function getText(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) headers["Referer"] = referer;
    let best = "";
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp.body) {
                if (resp.body.length > best.length) best = resp.body;
                if (resp.status === 200 && resp.body.indexOf("</html>") >= 0) return resp.body;
            }
        } catch (error) {
            // 超时 / 网络错误：换连接重试
        }
    }
    return best;
}

// ---------- 解析 ----------

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const spans = [];
    CARD_RE.lastIndex = 0;
    let m;
    while ((m = CARD_RE.exec(html)) !== null) {
        spans.push({vid: m[1], cover: m[2], alt: m[3], start: m.index, end: CARD_RE.lastIndex});
    }
    const seen = {};
    for (let i = 0; i < spans.length; i++) {
        const sp = spans[i];
        if (seen[sp.vid]) continue;
        const title = unescapeHtml(sp.alt);
        if (!title) continue;
        seen[sp.vid] = true;
        const segEnd = i + 1 < spans.length ? spans[i + 1].start : html.length;
        const seg = html.slice(sp.end, Math.min(segEnd, sp.end + 900));
        let remarks = "";
        const vm = VIEWS_RE.exec(seg);
        if (vm) {
            remarks = vm[1] + "次观看";
        } else {
            const dm = DATE_RE.exec(seg);
            if (dm) remarks = dm[1];
        }
        out.push({
            id: sp.vid,
            title: title,
            cover: fixUrl(sp.cover),
            remarks: remarks,
            duration: "",
            tags: [],
        });
    }
    return out;
}

function parseCategories(html) {
    const out = [];
    const seen = {};
    if (!html) return out;
    CAT_RE.lastIndex = 0;
    let m;
    while ((m = CAT_RE.exec(html)) !== null) {
        const cid = m[1];
        const name = unescapeHtml(m[2]);
        if (!name || seen[cid]) continue;
        seen[cid] = true;
        out.push([cid, name]);
    }
    return out;
}

async function fetchCats() {
    let cats = parseCategories(await getText(BASE + "/list.php", BASE + "/"));
    if (cats.length < 50) {
        const more = parseCategories(await getText(BASE + "/", BASE + "/"));
        const have = {};
        cats.forEach((c) => { have[c[0]] = true; });
        more.forEach((c) => {
            if (!have[c[0]]) {
                have[c[0]] = true;
                cats.push(c);
            }
        });
    }
    if (cats.length < 50) {
        const have = {};
        cats.forEach((c) => { have[c[0] + "|" + c[1]] = true; });
        CATS.forEach((c) => {
            if (!have[c[0] + "|" + c[1]]) cats.push(c);
        });
    }
    cats = cats.filter((c) => !BLOCKED_CATS[c[0]]);
    cats.sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
    return cats;
}

async function catalog(tid, pg) {
    let url;
    if (!tid || tid === "all" || tid === "0") {
        url = pg <= 1 ? BASE + "/list.php?sort=hot" : BASE + "/list.php?sort=hot&page=" + pg;
    } else if (pg <= 1) {
        url = BASE + "/list/" + tid + ".html";
    } else {
        url = BASE + "/list/" + tid + ".html?sort=new&page=" + pg;
    }
    return parseCards(await getText(url, BASE + "/"));
}

function field(html, label, pattern) {
    const re = new RegExp(label + "[:：]\\s*(?:</[^>]+>\\s*)?(" + pattern + ")");
    const m = re.exec(html || "");
    return m ? unescapeHtml(m[1]) : "";
}

// ---------- idj1 契约 ----------

async function home() {
    const cats = await fetchCats();
    const categories = [{id: "all", name: "全部"}]
        .concat(cats.map((c) => ({id: c[0], name: c[1]})));
    const items = await catalog("all", 1);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "all";
    const items = await catalog(tid, page);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let url = BASE + "/search/" + encodeURIComponent(keyword) + ".html";
    if (page > 1) url += "?page=" + page;
    const items = parseCards(await getText(url, BASE + "/"));
    return {items: items, hasMore: items.length > 0};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    const nid = rawId.replace(/\D/g, "");
    if (!nid) throw new Error("无效的影片 ID");
    const html = await getText(BASE + "/video/" + nid + ".html", BASE + "/");
    if (!html) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    const tm = TITLE_RE.exec(html);
    let title = tm ? unescapeHtml(tm[1]) : "";
    [" - 看裤X", " - 看裤", " - 在线播放"].forEach((suf) => {
        if (title.endsWith(suf)) title = title.slice(0, title.length - suf.length);
    });
    title = title.trim();
    if (!title) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    let pic = "";
    const om = OGIMG_RE.exec(html);
    if (om) pic = fixUrl(om[1]);
    if (!pic) {
        const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const im = new RegExp('<img[^>]*src="([^"]+)"[^>]*alt="' + esc + '"', "s").exec(html);
        if (im) pic = fixUrl(im[1]);
    }
    if (!pic) {
        const im = /<img[^>]*src="([^"]+)"/s.exec(html);
        if (im) pic = fixUrl(im[1]);
    }
    const cat = field(html, "分类", "[^<\\s]+");
    const views = field(html, "播放", "[\\d,]+");
    const duration = field(html, "时长", "[\\d:]+");
    const year = field(html, "年份", "\\d{4}");
    const tags = [];
    const ti = html.indexOf("标签");
    if (ti >= 0) {
        const tj = html.indexOf("视频简介", ti);
        const seg = tj > ti ? html.slice(ti, tj) : html.slice(ti, Math.min(html.length, ti + 2000));
        const are = /<a[^>]*>(.*?)<\/a>/gs;
        let am;
        while ((am = are.exec(seg)) !== null) {
            const t = unescapeHtml(am[1].replace(/\s+/g, " ")).trim();
            if (!t || t.length > 12 || t.indexOf("更多") >= 0) continue;
            tags.push(t);
        }
    }
    let synopsis = title;
    const sm = /视频简介\s*<\/h2>\s*<div[^>]*>\s*([^<]+?)\s*<\/div>/s.exec(html);
    if (sm) {
        const seg = unescapeHtml(sm[1].replace(/\s+/g, " ")).trim();
        if (seg.length > 4) synopsis = seg.slice(0, 500);
    }
    const episodes = [];
    const seenNodes = {};
    PLAYLINK_RE.lastIndex = 0;
    let pm;
    while ((pm = PLAYLINK_RE.exec(html)) !== null) {
        if (pm[1] !== nid) continue;
        const node = pm[2];
        if (seenNodes[node]) continue;
        seenNodes[node] = true;
        let label = unescapeHtml(stripTags(pm[3])).replace(/▶/g, "").trim();
        if (!label) {
            const found = NODES.filter((n) => n[0] === node)[0];
            label = found ? found[1] : node;
        }
        episodes.push({id: "kankux:" + nid + ":" + node, name: label});
    }
    if (!episodes.length) {
        NODES.forEach((n) => {
            episodes.push({id: "kankux:" + nid + ":" + n[0], name: n[1]});
        });
    }
    const remarks = duration || (views ? views + "次观看" : "");
    return {
        id: nid,
        title: title,
        cover: pic,
        desc: synopsis,
        year: year,
        area: "",
        remarks: remarks,
        typeName: cat,
        tags: tags,
        lines: [{name: "在线播放", episodes: episodes}],
    };
}

function extractPlay(html) {
    if (!html) return "";
    let m = M3U8_DQ_RE.exec(html);
    if (m) return unescapeHtml(m[1]);
    m = M3U8_SQ_RE.exec(html);
    if (m) return unescapeHtml(m[1]);
    SRC_RE.lastIndex = 0;
    while ((m = SRC_RE.exec(html)) !== null) {
        const u = unescapeHtml(m[1]);
        if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
    }
    URLVAR_RE.lastIndex = 0;
    while ((m = URLVAR_RE.exec(html)) !== null) {
        const u = unescapeHtml(m[1]);
        if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
    }
    return "";
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
    if (raw.startsWith("kankux:")) raw = raw.slice("kankux:".length);
    const parts = raw.split(":");
    const vid = (parts[0] || "").replace(/\D/g, "");
    if (!vid) throw new Error("无效的播放 ID");
    let node = parts[1] || "global";
    const known = NODES.map((n) => n[0]);
    if (known.indexOf(node) < 0) node = "global";
    const order = [node].concat(known.filter((n) => n !== node));
    let playUrl = "";
    for (let i = 0; i < order.length; i++) {
        const html = await getText(
            BASE + "/play/" + vid + ".html?node=" + order[i],
            BASE + "/video/" + vid + ".html");
        playUrl = extractPlay(html);
        if (playUrl) break;
    }
    if (!playUrl) throw new Error("未找到可用的播放地址（已依次尝试全球/亚洲/中国大陆三条节点）");
    const isHls = /\.m3u8($|\?)/i.test(playUrl);
    if (isHls) {
        // 主列表先解析到第一条子列表再返回，播放器少跳一层；
        // 解析失败就原样返回主列表，不影响播放。
        try {
            const pl = await getText(playUrl, BASE + "/video/" + vid + ".html");
            if (pl && pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const lines = pl.split(/\r?\n/).map((s) => s.trim())
                    .filter((s) => s && s.charAt(0) !== "#");
                if (lines.length) playUrl = host.url.resolve(playUrl, lines[0]);
            }
        } catch (error) {
            // 保留主列表
        }
    }
    return {
        streams: [{
            url: playUrl,
            format: isHls ? "hls" : "video",
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
            name: "看裤X",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
