// 91视频 — idj1 插件（由内置 py 蜘蛛 sp91 改写）
// 站点：https://91spx.com；列表/详情走页面里的 JSON-LD（ItemList / VideoObject），
// 播放走 POST /videos/<id>/playback {} 取 data.streams.main，与原 py 完全一致。
// 分类为原 py 写死的 23 个；标题旗标词过滤照搬原 py BLOCK_WORDS。
// 本站单请求常 20-55 秒，超时放宽到 60 秒、失败重试。

const BASE = "https://91spx.com";
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const TIMEOUT = 60000;
const PAGE = 24;

const CATS = [
    ["gczp", "国产自拍"],
    ["gccm", "国产传媒"],
    ["gtsj", "经典三级"],
    ["kbtj", "捆绑调教"],
    ["awlq", "暗网猎奇"],
    ["zjmw", "醉酒迷玩"],
    ["hwyz", "户外野战"],
    ["thjx", "按摩探花"],
    ["cos", "Cosplay"],
    ["jdjk", "酒店监控"],
    ["zscp", "真实厕拍"],
    ["jtcd", "街头抄底"],
    ["aihl", "AI换脸"],
    ["aimj", "AI漫剧"],
    ["aicrdj", "AI成人短剧"],
    ["rbav", "日本AV"],
    ["fklw", "疯狂老外"],
    ["91yc", "91原创"],
    ["hjll", "海角乱伦"],
    ["whhl", "网红黑料"],
    ["fcb", "反差婊"],
    ["gyds", "街头搭讪"],
    ["hdm", "H动漫"],
];
const CAT_IDS = {};
for (const c of CATS) CAT_IDS[c[0]] = true;

// 原 py BLOCK_WORDS 原样照搬：命中任一词的标题不进列表/详情。
const BLOCK_WORDS = ["loli", "lolicon", "幼女", "小学生", "初中生", "未成年", "儿童", "幼齿", "萝莉"];

function blocked(text) {
    const t = String(text || "").toLowerCase();
    for (const w of BLOCK_WORDS) if (t.indexOf(w) >= 0) return true;
    return false;
}

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function cover(vid) { return BASE + "/videos/webp/" + vid + ".webp"; }

function durText(iso) {
    if (!iso) return "";
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(String(iso));
    if (!m) return String(iso);
    const h = intValue(m[1], 0), mi = intValue(m[2], 0), s = intValue(m[3], 0);
    const p2 = (n) => (n < 10 ? "0" : "") + n;
    if (h) return h + ":" + p2(mi) + ":" + p2(s);
    return p2(mi) + ":" + p2(s);
}

// ---------- HTTP（重试 3 次，与原 py 一致） ----------

async function httpGet(url) {
    let last = null;
    for (let i = 0; i < 3; i++) {
        try {
            const resp = await host.http.get(url, {
                headers: {
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                },
                timeout: TIMEOUT,
            });
            if (resp.status === 200 && resp.body) return resp.body;
            // 原 py：HTTPError 也读正文返回（页面可能带内容）
            if (resp.body) return resp.body;
            last = new Error("HTTP " + resp.status);
        } catch (e) { last = e; }
    }
    throw last || new Error("请求失败");
}

async function httpPostJson(url, referer) {
    let last = null;
    for (let i = 0; i < 3; i++) {
        try {
            const resp = await host.http.post(url, "{}", {
                headers: {
                    "User-Agent": UA,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Origin": BASE,
                    "Referer": referer,
                },
                timeout: TIMEOUT,
            });
            if (resp.body) {
                try { return JSON.parse(resp.body); } catch (e) { last = e; continue; }
            }
            last = new Error("HTTP " + resp.status);
        } catch (e) { last = e; }
    }
    throw last || new Error("请求失败");
}

// ---------- JSON-LD 解析（与原 py 一致） ----------

function jsonLdNodes(html) {
    const nodes = [];
    const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        let data;
        try { data = JSON.parse(m[1]); } catch (e) { continue; }
        if (Array.isArray(data)) { for (const n of data) nodes.push(n); }
        else if (data && typeof data === "object") {
            if (Array.isArray(data["@graph"])) { for (const n of data["@graph"]) nodes.push(n); }
            else nodes.push(data);
        }
    }
    return nodes;
}

function vidFromUrl(u) {
    const m = /\/videos\/(\d+)\//.exec(str(u));
    return m ? m[1] : "";
}

function itemFromVideoObject(vo) {
    const vid = vidFromUrl(vo["@id"] || vo.url || "");
    if (!vid) return null;
    const name = str(vo.name || "").trim();
    if (!name || blocked(name)) return null;
    let actor = "";
    const author = vo.author;
    if (author && typeof author === "object") actor = str(author.name || "").trim();
    else if (typeof author === "string") actor = author.trim();
    const tags = str(vo.keywords || "").trim();
    return {
        id: vid,
        title: name,
        cover: cover(vid),
        remarks: durText(vo.duration),
        duration: durText(vo.duration),
        desc: str(vo.description || "").trim(),
        tags: tags ? tags.split(/[,，、]/).map((t) => t.trim()).filter(Boolean) : [],
        _actor: actor,
        _year: str(vo.uploadDate || "").slice(0, 4),
    };
}

function parseJsonLdList(html) {
    let total = 0;
    const items = [];
    for (const node of jsonLdNodes(html)) {
        if (!node || typeof node !== "object") continue;
        const me = node.mainEntity;
        if (me && typeof me === "object" && me["@type"] === "ItemList") {
            total = intValue(me.numberOfItems, 0);
            for (const el of me.itemListElement || []) {
                const vo = el && el.item;
                if (vo && typeof vo === "object") {
                    const it = itemFromVideoObject(vo);
                    if (it) items.push(it);
                }
            }
        }
    }
    return {items: items, total: total};
}

function parseHtmlCards(html) {
    const items = [];
    const seen = {};
    const re = /href="\/videos\/(\d+)\/"[\s\S]{0,900}?alt="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const vid = m[1], name = m[2].trim();
        if (seen[vid] || !name || blocked(name)) continue;
        seen[vid] = true;
        items.push({id: vid, title: name, cover: cover(vid), remarks: "", duration: "", tags: []});
    }
    return items;
}

function cleanItem(it) {
    return {id: it.id, title: it.title, cover: it.cover, remarks: it.remarks || "", duration: it.duration || "", tags: it.tags || []};
}

// ---------- idj1 契约 ----------

async function home() {
    const cats = CATS.map((c) => ({id: c[0], name: c[1]}));
    let items = [];
    try {
        const html = await httpGet(BASE + "/");
        items = parseHtmlCards(html).slice(0, PAGE).map(cleanItem);
    } catch (e) { items = []; }
    return {categories: cats, items: items, hasMore: false};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    if (!CAT_IDS[tid]) return {items: [], hasMore: false};
    let items = [], total = 0;
    try {
        const html = await httpGet(BASE + "/videos/category/" + tid + "/?page=" + page);
        const r = parseJsonLdList(html);
        items = r.items; total = r.total;
        if (!items.length) items = parseHtmlCards(html);
    } catch (e) { items = []; total = 0; }
    const hasMore = total ? page * PAGE < total : items.length > 0;
    return {items: items.map(cleanItem), hasMore: hasMore};
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let items = [], total = 0;
    try {
        const html = await httpGet(BASE + "/videos/search/" + encodeURIComponent(keyword) + "/" + page + "/");
        if (html.indexOf("没有找到") < 0) {
            const r = parseJsonLdList(html);
            items = r.items; total = r.total;
            if (!items.length) items = parseHtmlCards(html);
        }
    } catch (e) { items = []; total = 0; }
    const hasMore = total ? page * PAGE < total : false;
    return {items: items.map(cleanItem), hasMore: hasMore};
}

async function detail(arg) {
    const vid = str(arg && arg.id).trim();
    if (!vid) throw new Error("无效的影片 ID");
    const html = await httpGet(BASE + "/videos/" + vid + "/");
    const tm = /<title[^>]*>([^<]*)<\/title>/.exec(html);
    if (tm && blocked(tm[1])) return {id: vid, title: vid, cover: "", desc: "", tags: [], lines: []};
    let vo = null, catName = "";
    for (const node of jsonLdNodes(html)) {
        if (!node || typeof node !== "object") continue;
        if (node["@type"] === "VideoObject" && !vo) vo = node;
        if (node["@type"] === "BreadcrumbList") {
            const crumbs = node.itemListElement || [];
            if (crumbs.length >= 2) catName = str((crumbs[1] || {}).name || "").trim();
        }
    }
    let name = "", desc = "", dur = "", keywords = "", actor = "", year = "";
    if (vo) {
        name = str(vo.name || "").trim();
        desc = str(vo.description || "").trim();
        dur = durText(vo.duration);
        keywords = str(vo.keywords || "").trim();
        year = str(vo.uploadDate || "").slice(0, 4);
        const author = vo.author;
        if (author && typeof author === "object") actor = str(author.name || "").trim();
        else if (typeof author === "string") actor = author.trim();
    }
    if (!name && tm) name = tm[1].replace(/\s*\|.*$/, "").trim();
    if (!catName) {
        const cm = /当前所属分类[：:]\s*([^<\s]+)/.exec(html);
        if (cm) catName = cm[1].trim();
    }
    const parts = [];
    if (desc) parts.push(desc);
    if (actor) parts.push("演员：" + actor);
    if (year) parts.push("年份：" + year);
    if (catName) parts.push("分类：" + catName);
    if (dur) parts.push("时长：" + dur);
    return {
        id: vid,
        title: name || vid,
        cover: cover(vid),
        desc: parts.join("\n"),
        tags: keywords ? keywords.split(/[,，、]/).map((t) => t.trim()).filter(Boolean) : (catName ? [catName] : []),
        lines: [{name: "正片", episodes: [{id: vid, name: "正片"}]}],
    };
}

async function play(arg) {
    const vid = str((arg && arg.episodeId) || (arg && arg.id) || "").trim();
    if (!vid) throw new Error("无效的播放 ID");
    const data = await httpPostJson(BASE + "/videos/" + vid + "/playback", BASE + "/videos/" + vid + "/");
    const streams = (data && data.data && data.data.streams) || {};
    let url = str(streams.main || "").trim();
    if (!url) throw new Error("未找到可用的播放地址");
    const headers = {"User-Agent": UA, "Referer": BASE + "/videos/" + vid + "/"};
    // master 播放列表预解析一层到子列表，避免播放器多跳超时（与探针同口径）。
    if (/\.m3u8($|\?)/i.test(url)) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            const text = resp.body || "";
            if (resp.status === 200 && text.indexOf("#EXTM3U") >= 0 && text.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s.charAt(0) !== "#");
                if (lines.length) url = new URL(lines[0], url).href;
            }
        } catch (e) { /* 预解析失败就回 master 原地址 */ }
    }
    const format = /\.m3u8($|\?)/i.test(url) ? "hls" : "mp4";
    return {
        streams: [{url: url, format: format, headers: headers, name: "正片"}],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
