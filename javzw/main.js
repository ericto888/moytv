// JavZW - idj1 plugin (rewritten from the builtin py spider javzw)
// Data comes from the site JSON API on random subdomains of javzw.cyou;
// responses are AES-128-CBC encrypted (cipher field) or plain JSON.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const API_KEY = "a9yX32LpQvUt7wBc";
const API_IV = "N7cPk2Bv38hWqFzM";
const TIMEOUT = 58000;
const ATTEMPTS = 3;

const FALLBACK_CATS = [
    [1997, "Ai短剧"],
    [1661, "SM重味"],
    [1660, "AV明星"],
    [1659, "强奸乱伦"],
    [1658, "制服诱惑"],
    [1657, "人妻系列"],
    [1656, "中文字幕"],
    [1655, "伦理影片"],
    [1654, "自拍偷拍"],
    [1653, "成人动漫"],
    [1652, "欧美劲爆"],
    [1651, "国产主播"],
    [1650, "日韩无码"],
    [1649, "香港伦理"],
    [1648, "韩国伦理"],
    [1647, "邻家人妻"],
    [1646, "长腿丝袜"],
    [1645, "国模私拍"],
    [1644, "欧美情色"],
    [1643, "成人动漫"],
    [1642, "网红主播"],
    [1641, "AV明星"],
    [1640, "日本无码"],
    [1639, "国产情色"],
    [1634, "中文字幕"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function apiHost() {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let sub = "";
    for (let i = 0; i < 6; i++) {
        sub += chars[Math.floor(Math.random() * chars.length)];
    }
    return "https://" + sub + ".javzw.cyou";
}

function headers() {
    return {
        "User-Agent": UA,
        "Accept": "application/json",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
}

function decryptCipher(cipherB64) {
    const plain = host.crypto.aes({
        op: "decrypt",
        mode: "cbc",
        key: API_KEY,
        keyEncoding: "utf8",
        iv: API_IV,
        ivEncoding: "utf8",
        data: cipherB64,
        in: "base64",
        out: "utf8",
    });
    return JSON.parse(plain);
}

async function apiGet(path) {
    const url = apiHost() + path;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        let resp;
        try {
            resp = await host.http.get(url, {headers: headers(), timeout: TIMEOUT});
        } catch (error) {
            continue;
        }
        if (!resp || resp.status !== 200 || !resp.body) continue;
        let body;
        try {
            body = JSON.parse(resp.body);
        } catch (error) {
            continue;
        }
        if (body && typeof body === "object" && !Array.isArray(body)) {
            if (body.cipher) {
                let v;
                try {
                    v = decryptCipher(String(body.cipher));
                } catch (error) {
                    continue;
                }
                if (v && typeof v === "object" && "data" in v) return v.data;
                return v;
            }
            if (body.code != null && body.code !== 0) continue;
            if ("data" in body) return body.data;
            return body;
        }
        return body;
    }
    return {};
}

async function fetchCategories() {
    const data = await apiGet("/api/categories");
    const out = [];
    const lst = data && Array.isArray(data.list) ? data.list : null;
    if (lst) {
        for (const c of lst) {
            if (!c || typeof c !== "object") continue;
            if (c.module !== "video") continue;
            if (c.id == null) continue;
            const name = str(c.name);
            if (!name) continue;
            out.push([String(c.id), name]);
        }
    }
    if (out.length) return out;
    return FALLBACK_CATS.map((item) => [String(item[0]), item[1]]);
}

function parseVideos(data) {
    const items = [];
    let hasMore = false;
    if (data && typeof data === "object" && Array.isArray(data.list)) {
        for (const v of data.list) {
            if (!v || typeof v !== "object") continue;
            if (v.id == null) continue;
            const title = str(v.title);
            if (!title) continue;
            items.push({
                id: String(v.id),
                title: title,
                cover: str(v.cover_url),
                remarks: str(v.category),
                tags: [],
            });
        }
        const pg = intValue(data.page, 1);
        const pages = intValue(data.pages, 1);
        hasMore = pg < pages;
    }
    return {items: items, hasMore: hasMore};
}

async function catalog(tid, pg) {
    const data = await apiGet("/api/videos?category_id=" + encodeURIComponent(tid) + "&page=" + pg);
    return parseVideos(data);
}

function parsePlayList(playUrl) {
    const out = [];
    for (const rawPart of String(playUrl || "").split("#")) {
        const part = rawPart.trim();
        if (!part) continue;
        const dollar = part.indexOf("$");
        if (dollar >= 0) {
            let label = part.slice(0, dollar);
            const url = part.slice(dollar + 1).trim();
            if (url.startsWith("http")) {
                const slash = label.lastIndexOf("/");
                if (slash >= 0) label = label.slice(slash + 1);
                out.push({name: label.trim(), url: url});
            }
        } else if (part.startsWith("http")) {
            const n = out.length + 1;
            out.push({name: "第" + (n < 10 ? "0" + n : "" + n) + "集", url: part});
        }
    }
    return out;
}

async function home() {
    const cats = await fetchCategories();
    let items = [];
    let hasMore = false;
    if (cats.length) {
        const first = await catalog(cats[0][0], 1);
        items = first.items;
        hasMore = first.hasMore;
    }
    return {
        categories: cats.map((item) => ({id: item[0], name: item[1]})),
        items: items,
        hasMore: hasMore,
    };
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    const result = await catalog(tid, page);
    return {items: result.items, hasMore: result.hasMore};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const data = await apiGet("/api/videos?kw=" + encodeURIComponent(keyword) + "&page=1");
    const result = parseVideos(data);
    return {items: result.items, hasMore: false};
}

async function detail(arg) {
    const nid = str(arg && arg.id).replace(/^\/+|\/+$/g, "");
    const empty = {id: nid, title: "", cover: "", desc: "", tags: [], lines: []};
    if (!nid) return empty;
    const data = await apiGet("/api/movie?id=" + encodeURIComponent(nid));
    let info = null;
    if (data && typeof data === "object") {
        if (data.info && typeof data.info === "object") info = data.info;
        else info = data;
    }
    if (!info) return empty;
    const title = str(info.title);
    if (!title) return empty;
    const genre = str(info.category);
    const eps = parsePlayList(info.play_url || "");
    if (!eps.length) return empty;
    return {
        id: nid,
        title: title,
        cover: str(info.cover_url),
        desc: "",
        remarks: genre,
        tags: genre ? [genre] : [],
        lines: [{
            name: "在线播放",
            episodes: eps.map((ep) => ({id: ep.url, name: ep.name})),
        }],
    };
}

async function resolveMaster(url) {
    let resp;
    try {
        resp = await host.http.get(url, {headers: {"User-Agent": UA}, timeout: TIMEOUT});
    } catch (error) {
        return url;
    }
    if (!resp || resp.status !== 200 || !resp.body) return url;
    const text = String(resp.body);
    if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
            for (let j = i + 1; j < lines.length; j++) {
                const line = lines[j].trim();
                if (line && line.charAt(0) !== "#") {
                    try {
                        return host.url.resolve(resp.url || url, line);
                    } catch (error) {
                        return url;
                    }
                }
            }
        }
    }
    return url;
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (!raw.startsWith("http")) throw new Error("无效的播放地址");
    let url = raw;
    const isHls = /\.m3u8($|\?)/i.test(url);
    if (isHls) url = await resolveMaster(url);
    const stream = {
        url: url,
        headers: {"User-Agent": UA},
        name: "Jav中文",
    };
    if (isHls) stream.format = "hls";
    return {streams: [stream], expiresAt: Date.now() + 3600 * 1000};
}

export default {home: home, category: category, search: search, detail: detail, play: play};
