// 金果短剧 — idj1 插件（由内置 py 蜘蛛 jinguo 改写）
// 站点：play.jinguoduanju.app，JSON 接口 /api/v1：
//   GET /filter-config        分类（分组 tags 现解析，去重；失败用原 py 兜底 13 类）
//   GET /dramas?displayArea=HOME_FEED  首页列表（全量拉回本地分页，每页 24，同原 py）
//   GET /dramas / /dramas?tags=<id> / /dramas?q=<kw>&sort=latest  分类/搜索
//   GET /dramas/<id>          详情（drama + description + episodes）
//   GET /episodes/<eid>/play  取流（要 Bearer 令牌，回 videoUrl m3u8 直链）
// 鉴权与原 py 相同：POST /auth/device {deviceId:"h5:<uuid>"} 游客换令牌，
// 之后带 Authorization: Bearer <token>。令牌是插件自己游客登录拿到的，
// 宿主放行 Authorization 头（魔蚁 app_js_idj.go 禁发头 11 项不含 authorization，
// 用户 2026-11-24 令放行）；deviceId 与令牌存 host.storage 跨调用复用，
// 遇 401 清令牌重授权一次（同原 py）。列表/详情/搜索接口实测无令牌也可读，
// 播放接口无令牌回 401「需要登录」，故 play 前必先备好令牌（同一次调用内完成）。
// 本站经本机出口单请求常 40~55 秒，超时给足 60 秒（宿主上限），失败重试同原 py。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASE = "https://play.jinguoduanju.app";
const API = BASE + "/api/v1";
const TIMEOUT = 60000;
const PAGE_SIZE = 24;

// 原 py 兜底分类（filter-config 解析不到时用，顺序同原 py TAGS）
const TAGS = [
    ["1", "都市"], ["24", "灵异"], ["12", "职场"], ["14", "校园"],
    ["19", "奇幻"], ["20", "丧尸"], ["22", "古装"], ["21", "穿越"],
    ["15", "NTR"], ["16", "绿帽"], ["13", "同事"], ["23", "后宫"],
    ["25", "魔改"],
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
    if (u.startsWith("/")) return BASE + u;
    return u;
}

// 与原 py 的 _salvage_list 等价：数组 JSON 被截断时，退到最后一个完整元素抢救。
function salvageList(text) {
    const txt = str(text).trim();
    if (!txt.startsWith("[")) return null;
    let idx = txt.length;
    for (let i = 0; i < 8; i++) {
        idx = txt.lastIndexOf("},", idx - 1);
        if (idx < 0) break;
        try {
            const val = JSON.parse(txt.slice(0, idx + 1) + "]");
            if (Array.isArray(val) && val.length) return val;
        } catch (error) {
            // 继续往前退
        }
    }
    return null;
}

function parseBody(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (error) {
        return salvageList(text);
    }
}

// ---------- 鉴权（同原 py _auth / _http_json） ----------

function deviceId() {
    let id = "";
    try { id = host.storage.get("deviceId") || ""; } catch (error) { id = ""; }
    if (!id) {
        const h = host.crypto.randomHex(16);
        id = h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16)
            + "-a" + h.slice(17, 20) + "-" + h.slice(20, 32);
        try { host.storage.set("deviceId", id); } catch (error) { /* 存不下就每次现生成 */ }
    }
    return id;
}

function cachedToken() {
    try { return host.storage.get("token") || ""; } catch (error) { return ""; }
}

function saveToken(token) {
    try {
        if (token) host.storage.set("token", token);
        else host.storage.remove("token");
    } catch (error) { /* 忽略 */ }
}

async function auth() {
    saveToken("");
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.post(API + "/auth/device",
                JSON.stringify({deviceId: "h5:" + deviceId()}), {
                    headers: {
                        "User-Agent": UA,
                        "Accept": "application/json",
                        "Referer": BASE + "/",
                        "Content-Type": "application/json",
                    },
                    timeout: TIMEOUT,
                });
            if (resp.status === 200) {
                const data = parseBody(resp.body);
                if (data && data.token) {
                    saveToken(str(data.token));
                    return true;
                }
            }
        } catch (error) {
            // 重试一次（同原 py）
        }
    }
    return false;
}

async function ensureToken() {
    if (cachedToken()) return true;
    return auth();
}

// 与原 py _http_json 等价：先备令牌、带 Bearer 头请求，401 清令牌重授权重试一次，
// 其余失败最多 3 次尝试；401/403/404 直接回 null。
async function httpJson(method, path, body) {
    return httpJsonInner(method, path, body, true);
}

async function httpJsonInner(method, path, body, retryAuth) {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (!cachedToken()) await auth();
        const headers = {
            "User-Agent": UA,
            "Accept": "application/json",
            "Referer": BASE + "/",
        };
        const token = cachedToken();
        if (token) headers["Authorization"] = "Bearer " + token;
        let status = 0;
        let text = "";
        try {
            let resp;
            if (method === "POST") {
                headers["Content-Type"] = "application/json";
                resp = await host.http.post(API + path,
                    body == null ? "" : JSON.stringify(body),
                    {headers: headers, timeout: TIMEOUT});
            } else {
                resp = await host.http.get(API + path,
                    {headers: headers, timeout: TIMEOUT});
            }
            status = resp.status;
            text = resp.body || "";
        } catch (error) {
            status = 0;
            text = "";
        }
        if (status === 401 && retryAuth) {
            saveToken("");
            await auth();
            return httpJsonInner(method, path, body, false);
        }
        if (status === 200 && text) {
            const data = parseBody(text);
            if (data != null) return data;
        }
        if (status === 401 || status === 403 || status === 404) return null;
    }
    return null;
}

// ---------- 数据整形（同原 py _cats / _cards / _page） ----------

async function fetchCats() {
    const data = await httpJson("GET", "/filter-config");
    const out = [];
    const seen = {};
    if (Array.isArray(data)) {
        for (const grp of data) {
            const tags = (grp && grp.tags) || [];
            for (const tag of tags) {
                const tid = str(tag && tag.id);
                const name = str(tag && tag.name).trim();
                if (!name || seen[tid]) continue;
                seen[tid] = true;
                out.push({id: tid, name: name});
            }
        }
    }
    if (!out.length) {
        return TAGS.map((item) => ({id: item[0], name: item[1]}));
    }
    return out;
}

function toCards(items) {
    const out = [];
    const seen = {};
    for (const it of items || []) {
        const vid = str(it && it.id).trim();
        if (!vid || seen[vid]) continue;
        const title = unescapeHtml(it.title || "");
        if (!title) continue;
        seen[vid] = true;
        const ep = intValue(it.episodeCount, 0);
        const ftype = str(it.filmType || "").trim();
        let remarks = ep ? ep + "集" : "";
        if (ftype && ftype !== "FREE") {
            remarks = remarks ? remarks + "·" + ftype : ftype;
        }
        const card = {id: vid, title: title, remarks: remarks, duration: "", tags: []};
        const cover = fixUrl(it.coverUrl || "");
        if (cover) card.cover = cover;
        out.push(card);
    }
    return out;
}

async function fetchList(path) {
    const data = await httpJson("GET", path);
    return Array.isArray(data) ? data : null;
}

function pageOf(items, pg) {
    const start = (pg - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
}

function pageResult(items, pg) {
    if (items == null) {
        throw host.error("E_NETWORK", "金果短剧列表接口无响应（本站响应慢或出口受限）");
    }
    return {
        items: toCards(pageOf(items, pg)),
        hasMore: pg * PAGE_SIZE < items.length,
    };
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = await fetchCats();
    const items = await fetchList("/dramas?displayArea=HOME_FEED");
    const result = pageResult(items, 1);
    return {categories: categories, items: result.items, hasMore: result.hasMore};
}

async function category(arg) {
    const tid = str(arg && arg.id).trim();
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    let items;
    if (!tid || tid === "all") {
        items = await fetchList("/dramas");
    } else {
        items = await fetchList("/dramas?tags=" + encodeURIComponent(tid));
    }
    return pageResult(items, pg);
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const items = await fetchList("/dramas?q=" + encodeURIComponent(keyword) + "&sort=latest");
    return pageResult(items, pg);
}

async function detail(arg) {
    const nid = str(arg && arg.id).trim().replace(/^\//, "");
    if (!nid) throw host.error("E_PARSE", "详情 id 为空");
    const data = await httpJson("GET", "/dramas/" + encodeURIComponent(nid));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw host.error("E_NETWORK", "金果短剧详情接口无响应");
    }
    const drama = data.drama || {};
    const title = unescapeHtml(drama.title || "");
    if (!title) throw host.error("E_PARSE", "详情缺少标题");
    const epCount = intValue(drama.episodeCount, 0);
    const ftype = str(drama.filmType || "").trim();
    let remarks = epCount ? epCount + "集" : "";
    if (ftype && ftype !== "FREE") {
        remarks = remarks ? remarks + "·" + ftype : ftype;
    }
    const eps = [];
    const seen = {};
    for (const e of data.episodes || []) {
        const eid = str(e && e.id).trim();
        if (!eid || seen[eid]) continue;
        seen[eid] = true;
        const num = intValue(e.number, eps.length + 1);
        const label = str(e.title || "").trim() || ("第" + num + "集");
        eps.push({id: eid, name: label});
    }
    if (!eps.length) throw host.error("E_PARSE", "详情没有分集");
    const tagNames = [];
    for (const t of (drama.tags || []).slice(0, 3)) {
        if (t && typeof t === "object") tagNames.push(str(t.name || ""));
        else tagNames.push(str(t));
    }
    const result = {
        id: nid,
        title: title,
        desc: unescapeHtml(data.description || ""),
        tags: tagNames.filter((t) => t),
        lines: [{name: "在线播放", episodes: eps}],
    };
    const cover = fixUrl(drama.coverUrl || "");
    if (cover) result.cover = cover;
    if (remarks) result.remarks = remarks;
    return result;
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    if (raw.indexOf("$") >= 0) raw = raw.split("$").pop() || "";
    if (raw.startsWith("jinguo:")) raw = raw.slice("jinguo:".length).trim();
    if (!raw) throw host.error("E_PARSE", "播放 id 为空");
    if (!(await ensureToken())) {
        throw host.error("E_NETWORK", "金果短剧游客授权失败，暂时取不到播放地址");
    }
    const data = await httpJson("GET", "/episodes/" + encodeURIComponent(raw) + "/play");
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw host.error("E_NETWORK", "金果短剧播放接口无响应");
    }
    const allow = data.allowance || {};
    const m3u8 = unescapeHtml(data.videoUrl || "");
    if (allow.allowed === false) {
        throw host.error("E_PARSE", "该集未解锁（需金币/VIP），免费集可正常播放");
    }
    if (!m3u8) {
        throw host.error("E_PARSE", "播放接口未返回播放地址");
    }
    return {
        streams: [{
            url: m3u8,
            format: "hls",
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
            name: "在线播放",
        }],
        expiresAt: Date.now() + 30 * 60 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
