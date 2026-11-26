// ABJAV — idj1 插件（由内置 py 蜘蛛 abjav 改写）
// 站点：https://abjav.com；数据走站点自带 JSON 接口（/api/json/...），
// 播放先取 /api/videofile.php，再用站点自定义 Base64 变体（B164）解出
// /get_file/ 路径，拼 &f=video.m3u8 并跟随重定向拿最终 HLS 地址。

const BASE = "https://abjav.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 55000;
const PAGE_SIZE = 60;

const FALLBACK_CATS = [
    ["asian", "Asian"],
    ["japanese", "Japanese"],
    ["hd", "HD"],
    ["censored", "Censored"],
    ["uncensored", "Uncensored"],
    ["big-tits", "Big Tits"],
    ["amateur", "Amateur"],
    ["milf", "MILF"],
    ["pov", "POV"],
    ["creampie", "Creampie"],
    ["brunette", "Brunette"],
    ["hairy", "Hairy"],
    ["toys", "Toys"],
    ["deepthroat", "Deepthroat"],
    ["shaved", "Shaved"],
];

const FIXED_CATS = [
    ["latest-updates", "Latest"],
    ["most-popular", "Most Popular"],
    ["top-rated", "Top Rated"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function headers() {
    return {
        "User-Agent": UA,
        "Accept": "application/json, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": BASE + "/",
    };
}

async function getJson(url) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(), timeout: TIMEOUT});
            if (resp.status < 200 || resp.status >= 300) {
                throw new Error("HTTP " + resp.status);
            }
            return JSON.parse(resp.body);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("请求失败");
}

async function getJsonSoft(url) {
    try {
        return await getJson(url);
    } catch (error) {
        return null;
    }
}

// ---------- B164 解码（站点自定义 Base64 变体，填充位下标 64） ----------
const B164_ALPHABET = "АВСDЕFGHIJKLМNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,~";

function b164Decode(text) {
    if (!text) return "";
    const pos = {};
    for (let i = 0; i < B164_ALPHABET.length; i++) pos[B164_ALPHABET[i]] = i;
    const cleaned = [];
    for (const ch of String(text)) {
        if (ch in pos) cleaned.push(ch);
    }
    const bytes = [];
    for (let n = 0; n + 4 <= cleaned.length; n += 4) {
        const o = pos[cleaned[n]];
        const r = pos[cleaned[n + 1]];
        const a = pos[cleaned[n + 2]];
        const c = pos[cleaned[n + 3]];
        bytes.push(((o << 2) | (r >> 4)) & 0xff);
        if (a !== 64) bytes.push((((15 & r) << 4) | (a >> 2)) & 0xff);
        if (c !== 64) bytes.push((((3 & a) << 6) | c) & 0xff);
    }
    // 原 py 是 unquote_to_bytes：字节里可能有 %XX 转义，先还原。
    const raw = [];
    const isHex = (b) => (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102);
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 37 && i + 2 < bytes.length && isHex(bytes[i + 1]) && isHex(bytes[i + 2])) {
            raw.push(parseInt(String.fromCharCode(bytes[i + 1], bytes[i + 2]), 16));
            i += 2;
        } else {
            raw.push(bytes[i]);
        }
    }
    let latin1 = "";
    for (const b of raw) latin1 += String.fromCharCode(b);
    try {
        return host.codec.convert(latin1, "latin1", "utf8");
    } catch (error) {
        return latin1;
    }
}

// ---------- 分类 ----------

let catsCache = null;

async function fetchCategories() {
    if (catsCache) return catsCache;
    let cats = [];
    const data = await getJsonSoft(BASE + "/api/json/categories/14400/str.toptn.en.json");
    if (data && Array.isArray(data.categories)) {
        for (const c of data.categories) {
            if (!c || typeof c !== "object") continue;
            const d = str(c.dir);
            const t = str(c.title);
            if (d && t) cats.push(["category:" + d, t]);
        }
    }
    if (!cats.length) {
        cats = FALLBACK_CATS.map((item) => ["category:" + item[0], item[1]]);
    }
    catsCache = FIXED_CATS.concat(cats);
    return catsCache;
}

// ---------- 列表 ----------

function listUrl(section, obj, sort, pg) {
    return BASE + "/api/json/videos2/86400/str/" + sort + "/60/" +
        section + "." + obj + "." + pg + ".all...json";
}

function parseVideos(data) {
    const out = [];
    if (!data || !Array.isArray(data.videos)) return out;
    const seen = {};
    for (const v of data.videos) {
        if (!v || typeof v !== "object") continue;
        const vid = str(v.video_id);
        const d = str(v.dir);
        const title = str(v.title);
        if (!vid || !d || !title) continue;
        const pid = BASE + "/video/" + vid + "/" + d + "/";
        if (seen[pid]) continue;
        seen[pid] = true;
        let pic = str(v.scr);
        if (pic.startsWith("//")) pic = "https:" + pic;
        out.push({
            id: pid,
            title: title,
            cover: pic,
            remarks: str(v.duration),
            duration: str(v.duration),
            tags: [],
        });
    }
    return out;
}

function numericId(raw) {
    const s = str(raw);
    const p = s.indexOf("/video/");
    if (p >= 0) {
        const rest = s.slice(p + 7);
        let digits = "";
        for (const ch of rest) {
            if (ch >= "0" && ch <= "9") digits += ch;
            else break;
        }
        if (digits) return digits;
    }
    if (s.indexOf("abjav:") === 0) return s.slice(6).replace(/[^0-9]/g, "");
    return s.replace(/[^0-9]/g, "");
}

// ---------- idj1 契约 ----------

async function home() {
    let categories = FIXED_CATS.map((item) => ({id: item[0], name: item[1]}));
    try {
        const cats = await fetchCategories();
        categories = cats.map((item) => ({id: item[0], name: item[1]}));
    } catch (error) {
        // 用固定分类兜底
    }
    const data = await getJsonSoft(listUrl("", "", "latest-updates", 1));
    const items = parseVideos(data);
    return {categories: categories, items: items, hasMore: items.length >= PAGE_SIZE};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "latest-updates";
    let url;
    if (tid === "latest-updates" || tid === "most-popular" || tid === "top-rated") {
        url = listUrl("", "", tid, page);
    } else if (tid.indexOf("category:") === 0) {
        url = listUrl("categories", tid.slice("category:".length), "latest-updates", page);
    } else {
        url = listUrl("", "", "latest-updates", page);
    }
    const data = await getJsonSoft(url);
    const items = parseVideos(data);
    return {items: items, hasMore: items.length >= PAGE_SIZE};
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/api/videos2.php?params=86400/str/relevance/60/search.." +
        page + ".all...&s=" + encodeURIComponent(keyword);
    const data = await getJsonSoft(url);
    const items = parseVideos(data);
    return {items: items, hasMore: items.length >= PAGE_SIZE};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const nid = numericId(raw);
    if (!nid) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const n = parseInt(nid, 10);
    const million = Math.floor(n / 1000000) * 1000000;
    const thousand = Math.floor(n / 1000) * 1000;
    const url = BASE + "/api/json/video/86400/" + million + "/" + thousand + "/" + nid + ".json";
    const data = await getJsonSoft(url);
    const v = data && data.video && typeof data.video === "object" ? data.video : null;
    if (!v) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};

    const title = str(v.title) || raw;
    let thumb = str(v.thumb);
    if (thumb.startsWith("//")) thumb = "https:" + thumb;

    const actors = [];
    const md = v.models_data || v.models;
    const collectTitles = (entry) => {
        if (entry && typeof entry === "object") {
            const t = str(entry.title);
            if (t && actors.indexOf(t) < 0) actors.push(t);
        }
    };
    if (Array.isArray(md)) md.forEach(collectTitles);
    else if (md && typeof md === "object") Object.keys(md).forEach((k) => collectTitles(md[k]));

    const tags = [];
    const tg = v.tags;
    const collectTags = (entry) => {
        if (entry && typeof entry === "object") {
            const t = str(entry.title);
            if (t && tags.indexOf(t) < 0) tags.push(t);
        }
    };
    if (Array.isArray(tg)) tg.forEach(collectTags);
    else if (tg && typeof tg === "object") Object.keys(tg).forEach((k) => collectTags(tg[k]));

    let channel = "";
    if (v.channel && typeof v.channel === "object") channel = str(v.channel.title);

    const parts = [];
    const desc = str(v.description);
    if (desc) parts.push(desc);
    if (actors.length) parts.push("演员：" + actors.join(" / "));
    const dur = str(v.duration);
    if (dur) parts.push("时长：" + dur);
    if (channel) parts.push("频道：" + channel);
    if (tags.length) parts.push("标签：" + tags.join("、"));

    return {
        id: raw,
        title: title,
        cover: thumb,
        desc: parts.join("\n"),
        duration: dur,
        tags: tags,
        lines: [{
            name: "在线播放",
            episodes: [{id: "abjav:" + nid, name: "正片"}],
        }],
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    const nid = numericId(raw);
    if (!nid) throw new Error("无效的播放 ID");
    const url = BASE + "/api/videofile.php?video_id=" + nid + "&lifetime=8640000";
    const data = await getJson(url);
    if (!Array.isArray(data) || !data.length) throw new Error("未找到播放文件");
    let chosen = null;
    for (const item of data) {
        if (item && str(item.format) === ".mp4" && item.is_default) { chosen = item; break; }
    }
    if (!chosen) {
        for (const item of data) {
            if (item && str(item.format) === ".mp4") { chosen = item; break; }
        }
    }
    if (!chosen) {
        for (const item of data) {
            if (item && typeof item === "object") { chosen = item; break; }
        }
    }
    if (!chosen) throw new Error("未找到播放文件");
    const path = b164Decode(str(chosen.video_url));
    if (path.indexOf("/get_file/") !== 0) throw new Error("播放路径解码失败");
    const hls = BASE + path + "&f=video.m3u8";
    let playUrl = hls;
    try {
        const resp = await host.http.get(hls, {headers: headers(), timeout: TIMEOUT});
        if (resp && resp.url) playUrl = resp.url;
    } catch (error) {
        // 跟随重定向失败时用未解析地址，播放器侧仍可跟随
    }
    return {
        streams: [{
            url: playUrl,
            format: "hls",
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
            name: "ABJAV",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
