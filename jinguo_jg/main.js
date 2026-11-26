// 禁果短剧 — idj1 插件（由内置 py 蜘蛛 jinguo.py 改写，与金果短剧共用同一 py）
// 站点：https://play.jinguoduanju.app（JSON 接口站，无签名/加密）
// 登记差异：主树 builtin_py_sites.dart 中 jinguo_jg 与 jinguo 共用同一 asset、
// 同一域名、无 ext 差异，仅站名不同（禁果短剧），故接口与分类与原 py 完全一致。
// 分类：/api/v1/filter-config 分组标签展平去重（与原 py _cats 一致），
// 接口拿不到时用原 py 写死兜底表 TAGS（13 个，顺序照原 py）。
// 列表/搜索/详情：接口公开可直取（实测无令牌 200），全量拉回本地分页 24/页（照原 py）。
// 播放：/episodes/<id>/play 必须带游客设备令牌（无令牌实测 401「需要登录」，
// ?token= 与 token 头均实测无效）；照原 py 在 play() 内先 POST /auth/device
// 以随机 deviceId 换 Bearer 令牌，再带 Authorization 头取流（魔蚁宿主按用户
// 2026-11-24 令放行 Authorization 头，见主检出 app_js_idj.go 禁发头 11 项不含它）。
// 令牌与 deviceId 存 host.storage 跨调用复用，401 时照原 py 清令牌重授权一次。
// allowance.allowed=false（付费/未放行）时明确报错，不编造地址。

const BASE = "https://play.jinguoduanju.app";
const API = BASE + "/api/v1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGE_SIZE = 24;
const TIMEOUT = 55000;

const TAGS = [
    ["1", "都市"],
    ["24", "灵异"],
    ["12", "职场"],
    ["14", "校园"],
    ["19", "奇幻"],
    ["20", "丧尸"],
    ["22", "古装"],
    ["21", "穿越"],
    ["15", "NTR"],
    ["16", "绿帽"],
    ["13", "同事"],
    ["23", "后宫"],
    ["25", "魔改"],
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function unescapeHtml(s) {
    return str(s)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/\\\//g, "/")
        .trim();
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return BASE + u;
    return u;
}

function normId(ids) {
    if (Array.isArray(ids)) ids = ids.length ? ids[0] : "";
    return str(ids).trim();
}

function normPg(pg) {
    const n = parseInt(pg, 10);
    return isFinite(n) && n >= 1 ? n : 1;
}

// 照原 py _salvage_list：正文是被截断的 JSON 数组时，逐段回退抢救
function salvageList(text) {
    const txt = str(text).trim();
    if (txt.charAt(0) !== "[") return null;
    let idx = txt.length;
    for (let i = 0; i < 8; i++) {
        idx = txt.lastIndexOf("},", idx - 1);
        if (idx < 0) break;
        try {
            const val = JSON.parse(txt.slice(0, idx + 1) + "]");
            if (Array.isArray(val) && val.length) return val;
        } catch (e) {
            // 继续回退
        }
    }
    return null;
}

function parseBody(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        return salvageList(text);
    }
}

// 一次接口请求：照原 py _http_json 的重试口径（最多 3 次），token 可选
async function httpJson(method, path, bodyObj, token) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        const headers = {
            "User-Agent": UA,
            "Accept": "application/json",
            "Referer": BASE + "/",
        };
        if (token) headers["Authorization"] = "Bearer " + token;
        let resp;
        try {
            if (method === "POST") {
                headers["Content-Type"] = "application/json";
                resp = await host.http.post(API + path, bodyObj == null ? "" : JSON.stringify(bodyObj), {
                    headers: headers,
                    timeout: TIMEOUT,
                });
            } else {
                resp = await host.http.get(API + path, {
                    headers: headers,
                    timeout: TIMEOUT,
                });
            }
        } catch (e) {
            lastErr = e;
            continue;
        }
        if (resp.status === 200 && resp.body) {
            const data = parseBody(resp.body);
            if (data !== null && data !== undefined) return {status: 200, data: data};
            lastErr = host.error("E_PARSE", "接口返回无法解析：" + path);
            continue;
        }
        if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
            return {status: resp.status, data: null};
        }
        lastErr = host.error("E_NETWORK", "接口 HTTP " + resp.status + "：" + path);
    }
    if (lastErr) throw lastErr;
    return {status: 0, data: null};
}

function newDeviceId() {
    let hex = "";
    try {
        hex = host.crypto.randomHex(16);
    } catch (e) {
        hex = "";
    }
    if (!hex || hex.length < 32) {
        hex = "";
        for (let i = 0; i < 32; i++) hex += "0123456789abcdef".charAt(Math.floor(Math.random() * 16));
    }
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) + "-" +
        "89ab".charAt(Math.floor(Math.random() * 4)) + hex.slice(17, 20) + "-" + hex.slice(20, 32);
}

// 照原 py _auth：POST /auth/device {deviceId: 'h5:'+uuid} 换令牌，最多 2 次
async function auth(deviceId) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.post(API + "/auth/device", JSON.stringify({deviceId: "h5:" + deviceId}), {
                headers: {
                    "User-Agent": UA,
                    "Accept": "application/json",
                    "Referer": BASE + "/",
                    "Content-Type": "application/json",
                },
                timeout: TIMEOUT,
            });
            if (resp.status === 200 && resp.body) {
                const d = parseBody(resp.body);
                if (d && d.token) return str(d.token);
            }
        } catch (e) {
            // 照原 py 吞掉单次失败继续重试
        }
    }
    return "";
}

async function ensureToken() {
    let deviceId = "";
    let token = "";
    try {
        deviceId = str(host.storage.get("jg_device") || "");
        token = str(host.storage.get("jg_token") || "");
    } catch (e) {
        deviceId = "";
        token = "";
    }
    if (!deviceId) {
        deviceId = newDeviceId();
        try { host.storage.set("jg_device", deviceId); } catch (e) {}
    }
    if (token) return {deviceId: deviceId, token: token};
    token = await auth(deviceId);
    if (token) {
        try { host.storage.set("jg_token", token); } catch (e) {}
    }
    return {deviceId: deviceId, token: token};
}

async function clearToken() {
    try { host.storage.remove("jg_token"); } catch (e) {}
}

// 照原 py _cats：filter-config 分组标签展平去重，拿不到用写死兜底表
async function fetchCats() {
    try {
        const r = await httpJson("GET", "/filter-config", null, "");
        const out = [];
        const seen = {};
        if (Array.isArray(r.data)) {
            for (const grp of r.data) {
                const tags = (grp && grp.tags) || [];
                for (const tag of tags) {
                    const tid = str(tag && tag.id);
                    const name = str(tag && tag.name).trim();
                    if (!name || seen[tid]) continue;
                    seen[tid] = true;
                    out.push([tid, name]);
                }
            }
        }
        if (out.length) return out;
    } catch (e) {
        // 落兜底表
    }
    return TAGS.slice();
}

const listCache = {};

async function fetchList(path) {
    if (listCache[path]) return listCache[path];
    const r = await httpJson("GET", path, null, "");
    if (r.status !== 200) {
        throw host.error("E_NETWORK", "列表接口 HTTP " + r.status + "：" + path);
    }
    const items = Array.isArray(r.data) ? r.data : [];
    listCache[path] = items;
    return items;
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
        let ep = parseInt(it.episodeCount, 10);
        if (!isFinite(ep)) ep = 0;
        const ftype = str(it.filmType || "").trim();
        let remarks = ep ? ep + "集" : "";
        if (ftype && ftype !== "FREE") remarks = remarks ? remarks + "·" + ftype : ftype;
        const item = {id: vid, title: title};
        const cover = fixUrl(it.coverUrl || "");
        if (cover) item.cover = cover;
        if (remarks) item.remarks = remarks;
        out.push(item);
    }
    return out;
}

function pageOf(items, pg) {
    const start = (pg - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
}

function pageResult(items, pg) {
    const cards = toCards(pageOf(items, pg));
    return {items: cards, hasMore: pg * PAGE_SIZE < items.length};
}

async function home() {
    const cats = await fetchCats();
    const categories = [{id: "all", name: "全部"}];
    for (const c of cats) categories.push({id: c[0], name: c[1]});
    const items = await fetchList("/dramas?displayArea=HOME_FEED");
    const r = pageResult(items, 1);
    return {categories: categories, items: r.items, hasMore: r.hasMore};
}

async function category(arg) {
    const pg = normPg(arg && arg.page);
    const tid = normId(arg && arg.id);
    let items;
    if (!tid || tid === "all") {
        items = await fetchList("/dramas");
    } else {
        items = await fetchList("/dramas?tags=" + encodeURIComponent(tid));
    }
    return pageResult(items, pg);
}

async function search(arg) {
    const pg = normPg(arg && arg.page);
    const key = str(arg && arg.keyword || "");
    const items = await fetchList("/dramas?q=" + encodeURIComponent(key) + "&sort=latest");
    return pageResult(items, pg);
}

async function detail(arg) {
    const nid = normId(arg && arg.id).replace(/^\//, "");
    if (!nid) throw host.error("E_PARSE", "详情 id 为空");
    const r = await httpJson("GET", "/dramas/" + encodeURIComponent(nid), null, "");
    if (r.status !== 200 || !r.data || typeof r.data !== "object") {
        throw host.error("E_NETWORK", "详情接口 HTTP " + r.status);
    }
    const data = r.data;
    const drama = data.drama || {};
    const title = unescapeHtml(drama.title || "");
    if (!title) throw host.error("E_PARSE", "详情标题为空");
    let ep = parseInt(drama.episodeCount, 10);
    if (!isFinite(ep)) ep = 0;
    const ftype = str(drama.filmType || "").trim();
    let remarks = ep ? ep + "集" : "";
    if (ftype && ftype !== "FREE") remarks = remarks ? remarks + "·" + ftype : ftype;
    const tags = [];
    for (const t of drama.tags || []) {
        if (t && typeof t === "object") {
            if (t.name) tags.push(str(t.name));
        } else if (str(t)) {
            tags.push(str(t));
        }
    }
    const episodes = [];
    const seen = {};
    for (const e of data.episodes || []) {
        const eid = str(e && e.id).trim();
        if (!eid || seen[eid]) continue;
        seen[eid] = true;
        let num = parseInt(e.number, 10);
        if (!isFinite(num)) num = episodes.length + 1;
        const label = str(e.title || "").trim() || ("第" + num + "集");
        episodes.push({id: "jinguo:" + eid, name: label});
    }
    if (!episodes.length) throw host.error("E_PARSE", "详情没有分集");
    const out = {
        id: nid,
        title: title,
        desc: unescapeHtml(data.description || ""),
        tags: tags,
        lines: [{name: "在线播放", episodes: episodes}],
    };
    const cover = fixUrl(drama.coverUrl || "");
    if (cover) out.cover = cover;
    if (remarks) out.remarks = remarks;
    return out;
}

async function play(arg) {
    let raw = normId(arg && (arg.episodeId || arg.id));
    if (raw.indexOf("jinguo:") === 0) raw = raw.slice("jinguo:".length);
    if (!raw) throw host.error("E_PARSE", "分集 id 为空");
    const path = "/episodes/" + encodeURIComponent(raw) + "/play";
    let sess = await ensureToken();
    if (!sess.token) throw host.error("E_NETWORK", "游客设备授权未拿到令牌，无法取流");
    let r = await httpJson("GET", path, null, sess.token);
    if (r.status === 401) {
        // 照原 py：清令牌重授权一次再取
        await clearToken();
        sess = await ensureToken();
        if (!sess.token) throw host.error("E_NETWORK", "重新授权未拿到令牌，无法取流");
        r = await httpJson("GET", path, null, sess.token);
    }
    if (r.status !== 200 || !r.data || typeof r.data !== "object") {
        throw host.error("E_NETWORK", "播放接口 HTTP " + r.status);
    }
    const allow = r.data.allowance || {};
    if (allow.allowed === false) {
        throw host.error("E_PERMISSION", "该集未放行播放（付费/未解锁），站方未给播放地址");
    }
    const m3u8 = unescapeHtml(r.data.videoUrl || "");
    if (!m3u8) throw host.error("E_PARSE", "播放接口未返回播放地址");
    return {
        streams: [{
            url: m3u8,
            format: "hls",
            name: "在线播放",
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
