// AiJav — idj1 plugin (rewritten 1:1 from the built-in py spider aijav)
// Site: https://www.a-ijav.com ; data comes from the encrypted JSON API
// https://newavapi.9xyrp3kg4b86.com . Each request body is the params JSON
// (timestamp + params + encode_sign md5) AES-256-CBC encrypted (PKCS7),
// base64, sent as {"post-data": cipher}; the response envelope
// {data: <base64 cipher>, suffix} is decrypted with IV = base + suffix.

const API = "https://newavapi.9xyrp3kg4b86.com";
const WEB = "https://www.a-ijav.com";
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const AES_KEY = "0XxdjmI55ZjjqQLO3nI7gGqrBP0Vz9jS";
const AES_IV_BASE = "RWf23muavY";
const SIGN_KEY = "NRkw0g3iJLDvw5tJ5PuVt5276z0SOuyL";
const SUFFIX = "NWSdef";
const PAGE = 20;
const TIMEOUT = 60000;
const BLOCKED_TAG_IDS = {619: true};
const BLOCKED_TAG_WORDS = ["loli"];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function sign(params) {
    const keys = Object.keys(params).sort();
    const parts = [];
    for (const k of keys) parts.push(k + "=" + String(params[k]));
    return host.crypto.md5(parts.join("&") + "&" + SIGN_KEY, {in: "utf8", out: "hex"});
}

function aesEncrypt(plain) {
    return host.crypto.aes({
        op: "encrypt", data: plain, in: "utf8", out: "base64",
        key: AES_KEY, keyEncoding: "utf8",
        iv: AES_IV_BASE + SUFFIX, ivEncoding: "utf8", mode: "cbc",
    });
}

function aesDecrypt(cipherB64, suffix) {
    return host.crypto.aes({
        op: "decrypt", data: cipherB64, in: "base64", out: "utf8",
        key: AES_KEY, keyEncoding: "utf8",
        iv: AES_IV_BASE + suffix, ivEncoding: "utf8", mode: "cbc",
    });
}

async function api(path, params) {
    const base = {timestamp: Date.now()};
    const src = params || {};
    for (const k of Object.keys(src)) base[k] = src[k];
    base.encode_sign = sign(base);
    const plain = JSON.stringify(base);
    const cipher = aesEncrypt(plain);
    const payload = JSON.stringify({"post-data": cipher});
    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": UA,
        "Origin": WEB,
        "Referer": WEB + "/en/",
        "suffix": SUFFIX,
        "lang": "en",
    };
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.post(API + path, payload, {headers: headers, timeout: TIMEOUT});
            if (resp.status !== 200) {
                throw host.error("E_NETWORK", "AiJav 接口 HTTP " + resp.status);
            }
            let env;
            try {
                env = JSON.parse(resp.body);
            } catch (e) {
                throw host.error("E_PARSE", "AiJav 接口返回不是 JSON");
            }
            if (env && typeof env.data === "string" && typeof env.suffix === "string") {
                const raw = aesDecrypt(env.data, env.suffix);
                try {
                    return JSON.parse(raw);
                } catch (e) {
                    throw host.error("E_PARSE", "AiJav 接口解密结果不是 JSON");
                }
            }
            return env;
        } catch (error) {
            lastError = error;
            if (error && error.code === "E_PARSE") throw error;
        }
    }
    if (lastError && lastError.code) throw lastError;
    throw host.error("E_NETWORK", "AiJav 接口请求失败：" + (lastError ? String(lastError.message || lastError) : "unknown"));
}

function cleanTags(tags) {
    const out = [];
    for (const t of tags || []) {
        if (!t || typeof t !== "object") continue;
        const name = str(t.name);
        if (!name) continue;
        const tid = parseInt(t.id, 10);
        if (isFinite(tid) && BLOCKED_TAG_IDS[tid]) continue;
        const low = name.toLowerCase();
        let blocked = false;
        for (const w of BLOCKED_TAG_WORDS) {
            if (low.indexOf(w) >= 0) { blocked = true; break; }
        }
        if (blocked) continue;
        out.push(name);
    }
    return out;
}

function fullName(mash, title) {
    const m = str(mash);
    const t = str(title);
    if (m && t.toLowerCase().indexOf(m.toLowerCase()) !== 0) return (m + " " + t).trim();
    return t;
}

function actorNames(v) {
    const actors = [];
    for (const a of (v && v.actor) || []) {
        if (a && typeof a === "object" && a.name) actors.push(String(a.name));
    }
    return actors;
}

function vodItem(v) {
    const actors = actorNames(v);
    let remarks = str(v.duration);
    if (actors.length) remarks = (remarks + " " + actors.slice(0, 2).join(", ")).trim();
    return {
        id: String(v.id),
        title: fullName(v.mash, v.title),
        cover: str(v.thumb) || str(v.preview),
        remarks: remarks,
        duration: str(v.duration),
        tags: [],
    };
}

async function listPage(page) {
    const res = await api("/video/lists", {type: "3", page: page, limit: PAGE});
    const data = (res && res.data) || {};
    const rows = Array.isArray(data.data) ? data.data : [];
    const items = [];
    for (const v of rows) {
        if (v && typeof v === "object" && v.id != null) items.push(vodItem(v));
    }
    let total = parseInt(data.total, 10);
    if (!isFinite(total)) total = 0;
    let pagecount = parseInt(data.last_page, 10);
    if (!isFinite(pagecount) || pagecount < 1) pagecount = 1;
    return {items: items, total: total, pagecount: pagecount};
}

function numericVid(raw) {
    let s = str(raw);
    const dollar = s.lastIndexOf("$");
    if (dollar >= 0) s = s.slice(dollar + 1).trim();
    if (!/^\d+$/.test(s)) return "";
    return s;
}

async function home() {
    const categories = [{id: "free", name: "免费视频"}];
    const first = await listPage(1);
    return {categories: categories, items: first.items, hasMore: first.pagecount > 1};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    if (tid !== "free") return {items: [], hasMore: false};
    const r = await listPage(page);
    return {items: r.items, hasMore: page < r.pagecount};
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword);
    if (!keyword || page !== 1) return {items: [], hasMore: false};
    const res = await api("/video/lists", {type: "3", page: 1, limit: PAGE});
    const data = (res && res.data) || {};
    const rows = Array.isArray(data.data) ? data.data : [];
    const kw = keyword.toLowerCase();
    const kwFlat = kw.replace(/-/g, "");
    const items = [];
    for (const v of rows) {
        if (!v || typeof v !== "object") continue;
        let hay = [str(v.mash), str(v.title), str(v.mash_title)].join(" ");
        for (const name of actorNames(v)) hay += " " + name;
        const low = hay.toLowerCase();
        const flat = low.replace(/-/g, "").replace(/ /g, "");
        if (low.indexOf(kw) >= 0 || flat.indexOf(kwFlat) >= 0) {
            if (v.id != null) items.push(vodItem(v));
        }
    }
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const vid = numericVid(arg && arg.id);
    if (!vid) throw host.error("E_PARSE", "AiJav 详情 id 不是数字：" + str(arg && arg.id));
    const res = await api("/video/info", {vid: parseInt(vid, 10)});
    if (!res || typeof res !== "object" || res.code !== 1) {
        throw host.error("E_PARSE", "AiJav 详情接口未返回 code=1");
    }
    const v = res.data || {};
    const actors = actorNames(v);
    const pub = v.publisher;
    const pubName = pub && typeof pub === "object" ? str(pub.name) : str(pub);
    const tags = cleanTags(v.tags);
    let desc = str(v.description);
    if (desc.indexOf("[") === 0) {
        const close = desc.indexOf("]");
        if (close >= 0) desc = desc.slice(close + 1).trim();
    }
    const bits = [];
    if (desc && desc !== "AV video") bits.push(desc);
    if (tags.length) bits.push("分类: " + tags.join(", "));
    if (pubName) bits.push("出品: " + pubName);
    if (v.duration) bits.push("时长: " + String(v.duration));
    if (v.publish_date) bits.push("发布: " + String(v.publish_date));
    const idOut = String(v.id || vid);
    return {
        id: idOut,
        title: fullName(v.mash, v.title),
        cover: str(v.thumb) || str(v.preview),
        desc: bits.join("\n"),
        tags: tags,
        lines: [{
            name: "AiJav",
            episodes: [{id: idOut, name: "正片"}],
        }],
    };
}

async function play(arg) {
    const raw = (arg && arg.episodeId) || (arg && arg.id) || "";
    const vid = numericVid(raw);
    if (!vid) throw host.error("E_PARSE", "AiJav 播放 id 不是数字：" + str(raw));
    const res = await api("/video/getVideoUrl", {vid: parseInt(vid, 10)});
    if (!res || typeof res !== "object" || res.code !== 1) {
        throw host.error("E_PARSE", "AiJav 取流接口未返回 code=1");
    }
    const url = str(res.data);
    if (url.indexOf("http") !== 0) {
        throw host.error("E_PARSE", "AiJav 取流接口未返回播放地址");
    }
    const isHls = /\.m3u8($|\?)/i.test(url);
    return {
        streams: [{
            url: url,
            format: isHls ? "hls" : "mp4",
            headers: {"User-Agent": UA, "Referer": WEB + "/"},
            name: "AiJav",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
