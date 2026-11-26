// AV研究院 — idj1 插件（由内置 py 蜘蛛 avyanjiuyuan 改写）
// 站点：https://avyan2026.lol（MacCMS 结构，HTML 直出，无加密/签名）
// 列表页卡片锚点带 title + data-original 封面；播放页内嵌 var player_aaaa={...}
// JSON，url 字段即 m3u8 直链，vod_data 带片名/分类/演员/导演。
// 与原 py 的差异：详情封面原 py 靠搜索页按 id 反查；播放页本身就含本片卡片，
// 先同页取封面、取不到再走原搜索反查，结果一致但少一次慢请求。

const BASE = "https://avyan2026.lol";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 55000;

// 与原 py CATS 1:1 对应（id 65 原 py 硬编码返回空、且不在分类表内，不列）。
const CATS = [
    ["52", "亚洲情色"],
    ["53", "国产主播"],
    ["54", "国产自拍"],
    ["55", "无码专区"],
    ["56", "欧美性爱"],
    ["58", "强奸乱伦"],
    ["59", "巨乳美乳"],
    ["60", "中文字幕"],
    ["61", "制服诱惑"],
    ["62", "女同性恋"],
    ["63", "卡通动画"],
    ["64", "视频伦理"],
    ["66", "重口色情"],
];

// 原 py 的旗标过滤规则，照搬：分类名命中任一词即不列出。
const FLAG_WORDS = [
    "loli", "lolita", "幼女", "幼齿", "初中生", "小学生", "未成年",
    "未满", "萝莉", "童颜", "幼态", "处女", "小萝莉",
];

function isFlagged(name) {
    const low = String(name || "").toLowerCase();
    return FLAG_WORDS.some((w) => low.indexOf(w.toLowerCase()) >= 0);
}

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function unescapeHtml(s) {
    return str(s)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\\\//g, "/")
        .trim();
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("/") === 0) return BASE + u;
    return BASE + "/" + u;
}

// ---------- HTTP ----------

async function fetchText(path) {
    const url = path.indexOf("http") === 0 ? path : BASE + path;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(url, {
                headers: {
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Referer": BASE + "/",
                },
                timeout: TIMEOUT,
            });
            if (resp.status === 200 && resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) host.log("fetch failed: " + url + " " + lastError.message);
    return "";
}

// ---------- 解析 ----------

const ANCHOR_RE = /<a[^>]*href="\/index\.php\/vod\/play\/id\/(\d+)\/sid\/1\/nid\/1\.html"[^>]*>/g;
const TITLE_RE = /title="([^"]+)"/;
const COVER_RE = /data-original="([^"]+)"/;

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    ANCHOR_RE.lastIndex = 0;
    let m;
    while ((m = ANCHOR_RE.exec(html)) !== null) {
        const vid = m[1];
        if (!vid || seen[vid]) continue;
        const tag = m[0];
        const tm = TITLE_RE.exec(tag);
        const cm = COVER_RE.exec(tag);
        const title = tm ? unescapeHtml(tm[1]) : "";
        const cover = cm ? fixUrl(cm[1]) : "";
        if (!title || !cover) continue;
        seen[vid] = true;
        out.push({id: vid, title: title, cover: cover, remarks: "", duration: "", tags: []});
    }
    return out;
}

function parsePlayer(html) {
    if (!html) return null;
    const m = /var player_aaaa=(\{[\s\S]*?\})\s*<\/script>/.exec(html);
    if (!m) return null;
    try {
        return JSON.parse(m[1]);
    } catch (error) {
        return null;
    }
}

function textOf(obj, keys) {
    if (!obj || typeof obj !== "object") return "";
    for (const k of keys) {
        const v = obj[k];
        if (typeof v === "string" && v) return v;
    }
    return "";
}

function quotePlus(s) {
    return encodeURIComponent(str(s)).replace(/%20/g, "+");
}

function playPagePath(nid) {
    return "/index.php/vod/play/id/" + nid + "/sid/1/nid/1.html";
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = CATS
        .filter((item) => !isFlagged(item[1]))
        .map((item) => ({id: item[0], name: item[1]}));
    const html = await fetchText("/");
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    let tid = str(arg && arg.id).trim();
    const page = Math.max(1, intValue(arg && arg.page, 1));
    for (const item of CATS) {
        if (item[0] === tid && isFlagged(item[1])) return {items: [], hasMore: false};
    }
    if (tid === "65") return {items: [], hasMore: false};
    if (!tid || tid === "all") tid = "52";
    const path = page <= 1
        ? "/index.php/vod/type/id/" + tid + ".html"
        : "/index.php/vod/type/id/" + tid + "/page/" + page + ".html";
    const html = await fetchText(path);
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const html = await fetchText("/index.php/vod/search.html?wd=" + quotePlus(keyword));
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const nid = str(arg && arg.id).replace(/[^\d]/g, "");
    if (!nid) return {title: "", desc: "", tags: [], lines: []};
    const html = await fetchText(playPagePath(nid));
    if (!html) return {title: "", desc: "", tags: [], lines: []};
    const player = parsePlayer(html);
    if (!player) return {title: "", desc: "", tags: [], lines: []};
    const vodData = (player.vod_data && typeof player.vod_data === "object") ? player.vod_data : {};
    const title = textOf(vodData, ["vod_name"]);
    const m3u8 = textOf(player, ["url"]);
    if (!title || !m3u8) return {title: "", desc: "", tags: [], lines: []};
    const genre = textOf(vodData, ["vod_class"]);
    let desc = "";
    const dm = /<meta name="description"[^>]*content="([^"]+)"/.exec(html);
    if (dm) desc = unescapeHtml(dm[1]);
    const extra = [
        textOf(vodData, ["vod_actor"]) ? "演员：" + textOf(vodData, ["vod_actor"]) : "",
        textOf(vodData, ["vod_director"]) ? "导演：" + textOf(vodData, ["vod_director"]) : "",
    ].filter(Boolean).join("\n");
    if (extra) desc = desc ? desc + "\n" + extra : extra;
    // 封面：先在播放页同页卡片里按 id 找（与原 py 搜索反查同一张图），找不到再走搜索反查。
    let cover = "";
    for (const item of parseCards(html)) {
        if (item.id === nid) { cover = item.cover; break; }
    }
    if (!cover) {
        let kw = title.split(/\s+/)[0] || title.slice(0, 12);
        if (kw.length > 20) kw = kw.slice(0, 20);
        if (kw) {
            const sh = await fetchText("/index.php/vod/search.html?wd=" + quotePlus(kw));
            for (const item of parseCards(sh)) {
                if (item.id === nid) { cover = item.cover; break; }
            }
        }
    }
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: desc,
        tags: genre ? [genre] : [],
        lines: [{name: "在线播放", episodes: [{id: nid, name: "播放"}]}],
    };
}

async function play(arg) {
    const nid = str((arg && arg.episodeId) || (arg && arg.id)).replace(/[^\d]/g, "");
    if (!nid) throw new Error("无效的播放 ID");
    const html = await fetchText(playPagePath(nid));
    const player = parsePlayer(html);
    const raw = player ? textOf(player, ["url"]) : "";
    if (!raw || raw.indexOf("http") !== 0 || raw.indexOf(".m3u8") < 0) {
        throw new Error("未找到可用的 m3u8 直链");
    }
    return {
        streams: [{
            url: raw,
            format: "hls",
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
            name: "在线播放",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
