// 黄果漫剧 — idj1 plugin (rewritten 1:1 from the builtin py spider huangguomanju)
// JSON API app: device-token auth (POST /app/auth/device), then
// /app/categories, /app/home, /app/filter, /app/search, /app/dramas/<id>,
// /app/dramas/<id>/episodes, /app/play/<episodeId>.
// Three API bases are tried in the py order; a 401 refreshes the token once.
// The py minor-flag filter and the classical-word desensitize map are copied
// verbatim: items/categories/details whose title hits the minor map are
// dropped, and titles/descriptions pass through the replacement map.
// MARK_VIP stays on: VIP episodes get a suffix in their episode name.
// The py category filters (badge/status/sort) have no slot in the idj
// contract (category only receives id+page), so they are not carried over.
// Timeouts are widened to 58s with up to 3 attempts per base: this site is
// slow through the local egress.

const UA = "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const REFERER = "https://google.huge1-7wnjsk.com/";
const TIMEOUT = 58000;
const ATTEMPTS = 3;
const MARK_VIP = true;

const API_BASES = [
    "https://hgxml.00api-agy5u.com/api",
    "https://rules.googlexml.com/api",
    "https://awsapi.ipa001-7hzktt.com/api",
];
const IMG_BASE = "https://haguapi.huangguo.top";

const CLASSICAL_MAP = {
    "成人": "风月", "淫乱": "荒淫", "婊": "贱", "强奸": "强占",
    "无码": "素纱", "有码": "遮面", "熟女": "徐娘", "人妻": "罗敷",
    "护士": "药女", "教师": "先生", "丝袜": "丝履", "巨乳": "丰盈",
    "偷拍": "窥帘", "乱伦": "禁脔", "激情": "云雨", "色情": "春宫",
    "淫秽": "秽乱", "赌博": "孤注", "广告": "告示", "荡妇": "淫娃",
    "出轨": "逾墙", "偷情": "私会", "绿帽": "翠冠", "娇妻": "美眷",
    "嫩": "稚", "骚": "浪", "欲": "念", "肉": "身", "穴": "谷",
};
const MINOR_KEYS = ["萝莉", "幼女", "少女", "学生", "童", "未成年", "teen", "loli", "schoolgirl"];

const FALLBACK_CATS = [
    {id: "1", name: "精选短剧"},
    {id: "2", name: "热播漫剧"},
    {id: "3", name: "擦边风月"},
];

let tokenCache = null;
const respCache = {};

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function isMinor(text) {
    if (!text) return false;
    const low = str(text).toLowerCase();
    for (const k of MINOR_KEYS) {
        if (low.indexOf(k.toLowerCase()) >= 0) return true;
    }
    return false;
}

function desensitize(text) {
    if (!text) return text;
    let hit = false;
    for (const k in CLASSICAL_MAP) {
        if (str(text).indexOf(k) >= 0) { hit = true; break; }
    }
    if (!hit) return text;
    let out = str(text);
    for (const k in CLASSICAL_MAP) out = out.split(k).join(CLASSICAL_MAP[k]);
    return out;
}

function fixCover(cover) {
    const c = str(cover);
    if (!c) return "";
    if (c.startsWith("http")) return c;
    if (c.startsWith("//")) return "https:" + c;
    return IMG_BASE + "/" + c.replace(/^\/+/, "");
}

function vodFromItem(item) {
    if (!item) return null;
    const title = str(item.title || "");
    if (isMinor(title)) return null;
    const out = {
        id: str(item.id || ""),
        title: desensitize(title),
        remarks: str(item.episode_count == null ? "1" : item.episode_count) + "集",
        tags: [],
    };
    const cover = fixCover(item.cover || "");
    if (cover) out.cover = cover;
    return out;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rawRequest(base, path, method, body, tok) {
    const headers = {
        "User-Agent": UA,
        "Accept": "application/json",
        "Referer": REFERER,
    };
    if (tok) headers["Authorization"] = "Bearer " + tok;
    if (body != null) headers["Content-Type"] = "application/json";
    const resp = await host.http.request({
        url: base + path,
        method: method,
        headers: headers,
        body: body == null ? "" : JSON.stringify(body),
        timeout: TIMEOUT,
    });
    return resp;
}

async function ensureToken(force) {
    if (!force && tokenCache && Date.now() < tokenCache.expire) return tokenCache.value;
    try {
        const saved = host.storage.get("hg_token");
        if (!force && saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.value && Date.now() < parsed.expire) {
                tokenCache = parsed;
                return parsed.value;
            }
        }
    } catch (e) { /* storage miss: fall through to a fresh device auth */ }
    const deviceId = "web_tvbox_" + host.crypto.md5(str(Date.now())).slice(0, 16);
    let lastErr = null;
    for (const base of API_BASES) {
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            try {
                const resp = await rawRequest(base, "/app/auth/device", "POST", {device_id: deviceId}, null);
                if (resp.status === 200 && resp.body) {
                    const data = JSON.parse(resp.body);
                    if (data && data.token) {
                        tokenCache = {value: data.token, expire: Date.now() + 86400 * 1000};
                        try { host.storage.set("hg_token", JSON.stringify(tokenCache)); } catch (e) {}
                        return data.token;
                    }
                }
                lastErr = new Error("auth status " + resp.status);
                if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) break;
            } catch (e) {
                lastErr = e;
            }
            if (attempt < ATTEMPTS - 1) await sleep(800);
        }
    }
    throw host.error("E_NETWORK", "设备鉴权失败：" + (lastErr ? lastErr.message : "无响应"));
}

async function apiGet(path) {
    const cacheKey = "GET|" + path;
    const hit = respCache[cacheKey];
    if (hit && Date.now() - hit.ts < 300 * 1000) return hit.data;
    let tok = await ensureToken(false);
    let lastErr = null;
    let refreshed = false;
    for (const base of API_BASES) {
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            try {
                const resp = await rawRequest(base, path, "GET", null, tok);
                if (resp.status === 401 && !refreshed) {
                    refreshed = true;
                    tok = await ensureToken(true);
                    continue;
                }
                if (resp.status === 200 && resp.body) {
                    const data = JSON.parse(resp.body);
                    respCache[cacheKey] = {ts: Date.now(), data: data};
                    return data;
                }
                lastErr = new Error("status " + resp.status);
                if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) break;
            } catch (e) {
                lastErr = e;
            }
            if (attempt < ATTEMPTS - 1) await sleep(800);
        }
    }
    throw host.error("E_NETWORK", "接口请求失败 " + path + "：" + (lastErr ? lastErr.message : "无响应"));
}

async function fetchCategories() {
    try {
        const data = await apiGet("/app/categories");
        const list = (data && data.list) || [];
        const cats = [];
        for (const c of list) {
            const name = desensitize(str(c.name || ""));
            if (isMinor(name)) continue;
            cats.push({id: str(c.id), name: name});
        }
        if (cats.length) return cats;
    } catch (e) { /* fall through to the py fallback classes */ }
    return FALLBACK_CATS.slice();
}

async function home() {
    const categories = await fetchCategories();
    let items = [];
    try {
        const data = await apiGet("/app/home?page=1&pageSize=20");
        for (const item of (data && data.latest) || []) {
            const v = vodFromItem(item);
            if (v) items.push(v);
        }
    } catch (e) { /* categories alone still make a usable home */ }
    return {categories: categories, items: items, hasMore: false};
}

async function category(arg) {
    const tid = str(arg && arg.id) || "1";
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const qs = host.url.encodeForm({category_id: tid, page: str(page), pageSize: "20"});
    const data = await apiGet("/app/filter?" + qs);
    const items = [];
    for (const item of (data && data.list) || []) {
        const v = vodFromItem(item);
        if (v) items.push(v);
    }
    let hasMore;
    if (typeof (data && data.hasMore) === "boolean") hasMore = data.hasMore;
    else if (data && data.total) hasMore = page * 20 < intValue(data.total, 0);
    else hasMore = items.length >= 20;
    return {items: items, hasMore: hasMore};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const qs = host.url.encodeForm({q: keyword, page: str(page), pageSize: "20"});
    const data = await apiGet("/app/search?" + qs);
    const items = [];
    for (const item of (data && data.list) || []) {
        const v = vodFromItem(item);
        if (v) items.push(v);
    }
    return {items: items, hasMore: !!(data && data.hasMore)};
}

async function detail(arg) {
    const vid = str(arg && arg.id);
    const data = await apiGet("/app/dramas/" + encodeURIComponent(vid));
    if (!data) throw host.error("E_PARSE", "详情为空");
    const title = desensitize(str(data.title || ""));
    if (isMinor(title)) throw host.error("E_PARSE", "条目被旗标过滤");
    const epsData = await apiGet("/app/dramas/" + encodeURIComponent(vid) + "/episodes");
    const episodes = [];
    for (const ep of (epsData && epsData.list) || []) {
        const epNo = ep.ep;
        let name = desensitize(str(ep.title || ("第" + str(epNo) + "集")));
        if (MARK_VIP && ep.need_vip) name += "·VIP";
        episodes.push({id: str(ep.id), name: name});
    }
    const out = {
        id: str(data.id || vid),
        title: title,
        desc: desensitize(str(data.description || "") || title),
        tags: [],
        lines: [{name: "黄果漫剧", episodes: episodes}],
    };
    const cover = fixCover(data.cover || "");
    if (cover) out.cover = cover;
    return out;
}

// If the play URL is a master playlist, resolve it to its first variant
// media playlist inside play (the host player then starts one level down).
async function resolveMaster(url, headers) {
    try {
        const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
        if (resp.status !== 200 || !resp.body) return url;
        const text = resp.body;
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
                for (let j = i + 1; j < lines.length; j++) {
                    const line = lines[j].trim();
                    if (line && line.charAt(0) !== "#") return host.url.resolve(url, line);
                }
            }
        }
        return url;
    } catch (e) {
        return url;
    }
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("#") >= 0) raw = raw.split("#")[0].trim();
    if (!raw) throw host.error("E_PARSE", "缺少分集 ID");
    const data = await apiGet("/app/play/" + encodeURIComponent(raw));
    if (!data || !data.can_play || !data.play_url) {
        throw host.error("E_PARSE", "该集不可播放（可能需要 VIP）");
    }
    const headers = {"User-Agent": UA, "Referer": REFERER};
    const url = await resolveMaster(str(data.play_url), headers);
    const format = /\.m3u8($|\?)/i.test(url) ? "hls" : "";
    return {
        streams: [{url: url, format: format, headers: headers, name: "黄果漫剧"}],
        expiresAt: Date.now() + 30 * 60 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
