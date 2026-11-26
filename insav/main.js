// INSAV — idj1 插件（由内置 py 蜘蛛 insav 改写）
// 接口：POST https://insav.tv/api<path>，请求体 {"post-data": base64}，
// 明文参数 JSON 先按 MD5(sorted k=v & SIGN_KEY) 签名（encode_sign），
// 再 AES-256-CBC 加密（key/iv 与原 py 相同，iv = RWf23muavY + 后缀 NWSdef）；
// 回包 {data: base64, suffix} 用 iv = RWf23muavY + 回包 suffix 解密得 JSON。
// 分类与原 py 1:1：只有 1 个写死分类「免费放送」(free)，走 /video/lists type=3；
// 详情标签过滤照搬原 py（tag id=11 与含 loli 的标签名剔除）；
// 搜索照搬原 py：只留 private==0 的条目。
// 播放：/video/getVideoUrl 现取 m3u8 直链，带 UA + Referer。
//
// 相对原 py 丢掉的能力：
// - localProxy 图片解码代理 idj 里没有对应物：图床 yik.yanyunhome.com 的
//   .txt?size=600x600 与原图地址回的都不是二进制图，而是
//   "data:image/jpeg;base64,..." 文本（原 py 靠本地代理解码/DES 解密后回图）。
//   插件封面改为直出原图地址（实测 200、Content-Type image/jpeg），
//   无法像原 py 那样在插件内解码成图字节。

const API = "https://insav.tv/api";
const WEB = "https://insav.tv";
const IMG = "https://yik.yanyunhome.com";
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const AES_KEY = "0XxdjmI55ZjjqQLO3nI7gGqrBP0Vz9jS";
const AES_IV_BASE = "RWf23muavY";
const SIGN_KEY = "NRkw0g3iJLDvw5tJ5PuVt5276z0SOuyL";
const SUFFIX = "NWSdef";
const PAGE = 20;
const TIMEOUT = 60000;
const BLOCKED_TAG_IDS = {11: true};
const BLOCKED_TAG_WORDS = ["loli"];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

// ---------- 接口（与原 py _sign/_api 一致） ----------

function sign(params) {
    const keys = Object.keys(params).sort();
    const parts = keys.map((k) => k + "=" + params[k]);
    return host.crypto.md5(parts.join("&") + "&" + SIGN_KEY, {in: "utf8", out: "hex"});
}

async function api(path, params) {
    const base = {site: 1, device: 1, timestamp: Date.now()};
    if (params) {
        for (const k of Object.keys(params)) base[k] = params[k];
    }
    base.encode_sign = sign(base);
    const cipher = host.crypto.aes({
        op: "encrypt", mode: "cbc",
        key: AES_KEY, keyEncoding: "utf8",
        iv: AES_IV_BASE + SUFFIX, ivEncoding: "utf8",
        data: JSON.stringify(base), in: "utf8", out: "base64",
    });
    const body = JSON.stringify({"post-data": cipher});
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.post(API + path, body, {
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": UA,
                    "Origin": WEB,
                    "Referer": WEB + "/",
                    "suffix": SUFFIX,
                    "lang": "en",
                },
                timeout: TIMEOUT,
            });
            if (!resp || resp.status !== 200) throw new Error("HTTP " + (resp ? resp.status : "无响应"));
            if (!resp.body) throw new Error("响应为空");
            const env = JSON.parse(resp.body);
            if (env && typeof env.data === "string" && typeof env.suffix === "string") {
                const plain = host.crypto.aes({
                    op: "decrypt", mode: "cbc",
                    key: AES_KEY, keyEncoding: "utf8",
                    iv: AES_IV_BASE + env.suffix, ivEncoding: "utf8",
                    data: env.data, in: "base64", out: "utf8",
                });
                return JSON.parse(plain);
            }
            return env;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("接口不可用");
}

// ---------- 卡片（与原 py _pic/_vod_item/_actor_name 一致） ----------

function pic(path) {
    let p = str(path).trim();
    if (!p) return "";
    if (p.indexOf("http://") === 0 || p.indexOf("https://") === 0) {
        try {
            p = new URL(p).pathname;
        } catch (error) {
            // 保持原样
        }
    }
    p = p.replace(/^\/+/, "");
    if (!p) return "";
    return IMG + "/" + p;
}

function actorName(v) {
    const a = v ? v.actor : null;
    if (a && typeof a === "object" && !Array.isArray(a)) return str(a.name || "");
    if (Array.isArray(a)) {
        const names = [];
        for (const x of a) {
            if (x && typeof x === "object" && x.name) names.push(str(x.name));
        }
        return names.join(", ");
    }
    return str(a || "");
}

function vodItem(v) {
    const actor = actorName(v);
    let remarks = str(v.play || "");
    if (actor) remarks = (remarks + " " + actor).trim();
    return {
        id: str(v.id),
        title: str(v.title || "").trim(),
        cover: pic(v.thumb || v.preview || ""),
        remarks: remarks,
        duration: "",
        tags: [],
    };
}

function fullName(mash, title) {
    const m = str(mash || "").trim();
    const t = str(title || "").trim();
    if (m && t.toLowerCase().indexOf(m.toLowerCase()) !== 0) return (m + " " + t).trim();
    return t;
}

function cleanTags(tags) {
    const out = [];
    for (const t of tags || []) {
        if (!t || typeof t !== "object") continue;
        const name = str(t.name || "").trim();
        if (!name) continue;
        const tid = parseInt(t.id, 10);
        if (isFinite(tid) && BLOCKED_TAG_IDS[tid]) continue;
        const low = name.toLowerCase();
        if (BLOCKED_TAG_WORDS.some((w) => low.indexOf(w) >= 0)) continue;
        out.push(name);
    }
    return out;
}

async function listPage(params) {
    const res = await api("/video/lists", params);
    const data = (res && typeof res.data === "object" && res.data) ? res.data : {};
    const rows = Array.isArray(data.data) ? data.data : [];
    return {rows: rows, total: intValue(data.total, 0), lastPage: intValue(data.last_page, 1)};
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = [{id: "free", name: "免费放送"}];
    let items = [];
    try {
        const r = await listPage({type: "3", page: 1, limit: PAGE});
        items = r.rows.map(vodItem);
    } catch (error) {
        items = [];
    }
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    if (tid !== "free") return {items: [], hasMore: false};
    let r = {rows: [], total: 0, lastPage: 1};
    try {
        r = await listPage({type: "3", page: pg, limit: PAGE});
    } catch (error) {
        r = {rows: [], total: 0, lastPage: 1};
    }
    return {items: r.rows.map(vodItem), hasMore: pg < r.lastPage};
}

async function search(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let rows = [];
    try {
        const r = await listPage({keyword: keyword, page: pg, limit: PAGE});
        rows = r.rows;
    } catch (error) {
        rows = [];
    }
    const items = [];
    for (const v of rows) {
        // 与原 py 一致：private 解析不出或不为 0 的条目跳过。
        const priv = parseInt(v ? v.private : 2, 10);
        if (!isFinite(priv) || priv !== 0) continue;
        items.push(vodItem(v));
    }
    return {items: items, hasMore: false};
}

async function detail(arg) {
    let vid = str(arg && arg.id).trim();
    vid = vid.split("$").pop().trim();
    if (!/^\d+$/.test(vid)) throw new Error("无效的影片 ID");
    const res = await api("/video/info", {vid: parseInt(vid, 10)});
    if (!res || typeof res !== "object" || res.code !== 1) {
        return {id: vid, title: vid, cover: "", desc: "", tags: [], lines: []};
    }
    const v = (res.data && typeof res.data === "object") ? res.data : {};
    const pub = (v.publisher && typeof v.publisher === "object") ? v.publisher : null;
    const pubName = pub ? str(pub.name || "") : str(v.publisher || "");
    const tags = cleanTags(v.tags);
    const bits = [];
    const desc = str(v.description || "").trim();
    if (desc) bits.push(desc);
    if (tags.length) bits.push("分类: " + tags.join(", "));
    if (pubName) bits.push("出品: " + pubName);
    if (v.publish_date) bits.push("发布: " + str(v.publish_date));
    return {
        id: str(v.id || vid),
        title: fullName(v.mash, v.title) || vid,
        cover: pic(v.thumb || v.preview || ""),
        desc: bits.join("\n"),
        tags: tags,
        actors: actorName(v) ? [actorName(v)] : [],
        lines: [{name: "INSAV", episodes: [{id: str(v.id || vid), name: "正片"}]}],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id) || "").trim();
    raw = raw.split("$").pop().trim();
    if (!/^\d+$/.test(raw)) throw new Error("无效的播放 ID");
    const res = await api("/video/getVideoUrl", {vid: parseInt(raw, 10)});
    if (!res || typeof res !== "object" || res.code !== 1) throw new Error("接口未返回播放地址");
    const url = str(res.data || "").trim();
    if (url.indexOf("http") !== 0) throw new Error("未找到可用的播放地址");
    const format = /\.m3u8($|\?)/i.test(url) ? "hls" : "mp4";
    return {
        streams: [{
            url: url,
            format: format,
            headers: {"User-Agent": UA, "Referer": WEB + "/"},
            name: "INSAV",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
