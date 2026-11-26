// 黄瓜AI短剧 — idj1 plugin (ported 1:1 from the builtin py spider hgai)
// Entry https://hgai8.cc/?from=yng hands out a random-subdomain base on a
// *.cyou suffix (parsed from the entry page's randomSub script, fallback
// hgai8.cyou). All data comes from <base>/api/... JSON; responses may be
// wrapped as {"cipher": "<base64 AES-CBC>"} with the py's fixed key/iv.
// Categories: /api/categories filtered to module=="video", falling back to
// the py's built-in CATS list (30 entries, unabridged). Detail episodes
// come from info.play_url split on '#', each "name$url" (name = last path
// segment), exactly like the py. Play: direct .m3u8 passthrough, otherwise
// fetch the play page and reuse the py chain — direct m3u8 regex first,
// then player_data with from=="huangguo" resolved through
// <origin>/huangguo.php?ac=play -> /hgmedia.php?e=... Master playlists are
// pre-resolved to the first variant sub-playlist inside play().

const ENTRY = "https://hgai8.cc/?from=yng";
const SUFFIX_FALLBACK = "hgai8.cyou";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const AES_KEY = "a9yX32LpQvUt7wBc";
const AES_IV = "N7cPk2Bv38hWqFzM";
const TIMEOUT = 60000;

const CATS = [
    ["1846", "AI短剧"],
    ["1837", "国产传媒"],
    ["1836", "人兽乱交"],
    ["1835", "熟女少妇"],
    ["1834", "颜值正义"],
    ["1833", "反差母狗"],
    ["1832", "精品网红"],
    ["1831", "精品探花"],
    ["1830", "黑料网曝"],
    ["1829", "AV解说"],
    ["1828", "明星换脸"],
    ["1827", "大秀视频"],
    ["1826", "教师学生"],
    ["1825", "自慰系列"],
    ["1824", "口交视频"],
    ["1823", "颜射系列"],
    ["1822", "巨乳系列"],
    ["1821", "SM重味"],
    ["1820", "AV明星"],
    ["1819", "强奸乱伦"],
    ["1818", "制服诱惑"],
    ["1817", "人妻系列"],
    ["1816", "中文字幕"],
    ["1815", "伦理影片"],
    ["1814", "自拍偷拍"],
    ["1813", "动漫精品"],
    ["1812", "欧美精品"],
    ["1811", "日韩精品"],
    ["1810", "国产精品"],
    ["1809", "日韩无码"],
];

const SUFFIX_RE = /randomSub \+ "\.([A-Za-z0-9.\-]+\.cyou)\/"/;
const PLAYER_DATA_RE = /player_data=\{"[^}]*"url":"([^"]+)"[^}]*"from":"([^"]+)"/;
const DIRECT_M3U8_RE = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/;

let baseCache = "";
let baseCacheTs = 0;

function str(value) {
    if (value == null) return "";
    return String(value);
}

function headers(referer) {
    const h = {
        "User-Agent": UA,
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) h["Referer"] = referer;
    return h;
}

async function getText(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(referer), timeout: TIMEOUT});
            if ((resp.status === 200 || resp.status === 206) && resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) host.log("hgai getText failed", url, String(lastError && lastError.message));
    return "";
}

function randSub() {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}

async function resolveBase() {
    const now = Date.now();
    if (baseCache && now - baseCacheTs < 600000) return baseCache;
    let suffix = SUFFIX_FALLBACK;
    try {
        const html = await getText(ENTRY);
        const m = SUFFIX_RE.exec(html || "");
        if (m) suffix = m[1];
    } catch (error) {
        host.log("hgai resolveBase entry failed", String(error && error.message));
    }
    baseCache = "https://" + randSub() + "." + suffix;
    baseCacheTs = now;
    return baseCache;
}

async function api(path) {
    const base = await resolveBase();
    const txt = await getText(base + "/api" + path, base + "/");
    if (!txt) return {};
    let obj = null;
    try { obj = JSON.parse(txt); } catch (error) { return {}; }
    if (obj && typeof obj === "object" && obj.cipher) {
        try {
            const pt = host.crypto.aes({op: "decrypt", key: AES_KEY, iv: AES_IV, data: String(obj.cipher)});
            obj = JSON.parse(pt);
        } catch (error) {
            host.log("hgai cipher decrypt failed", String(error && error.message));
            return {};
        }
    }
    if (!obj || typeof obj !== "object") return {};
    if (obj.code !== 0 && obj.code != null) return {};
    return obj;
}

function fixUrl(raw, base) {
    let u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return base + u;
    const idx = u.indexOf("://");
    if (idx >= 0) {
        const scheme = u.slice(0, idx);
        const rest = u.slice(idx + 3);
        const slash = rest.indexOf("/");
        if (slash >= 0) {
            const hostPart = rest.slice(0, slash);
            const path = rest.slice(slash).replace(/\/{2,}/g, "/");
            return scheme + "://" + hostPart + path;
        }
    }
    return u;
}

function parseItems(body, base) {
    const out = [];
    const data = body && typeof body === "object" ? body.data : null;
    const lst = data && typeof data === "object" ? data.list : null;
    for (const it of lst || []) {
        if (!it || typeof it !== "object") continue;
        const vid = str(it.id);
        const title = it.title || "";
        if (!vid || !title) continue;
        const item = {id: vid, title: String(title), remarks: "", tags: []};
        const pic = fixUrl(it.cover_url || "", base);
        if (pic) item.cover = pic;
        out.push(item);
    }
    return out;
}

async function fetchCats() {
    const body = await api("/categories");
    const data = body && typeof body === "object" ? body.data : null;
    const lst = data && typeof data === "object" ? data.list : null;
    const out = [];
    for (const it of lst || []) {
        if (!it || typeof it !== "object") continue;
        if (it.module !== "video") continue;
        const cid = str(it.id);
        const name = it.name || "";
        if (cid && name) out.push([cid, String(name)]);
    }
    return out.length ? out : CATS.slice();
}

async function catalog(tid, pg) {
    const path = "/categories/videos?ids=" + encodeURIComponent(tid) + "&page=" + pg;
    const body = await api(path);
    const base = await resolveBase();
    const items = parseItems(body, base);
    const data = body && typeof body === "object" ? body.data : null;
    let count = 0;
    if (data && typeof data === "object") {
        const n = parseInt(data.count || data.total || 0, 10);
        if (isFinite(n)) count = n;
    }
    return {items: items, count: count};
}

function normPg(pg) {
    const n = parseInt(pg, 10);
    return isFinite(n) && n >= 1 ? n : 1;
}

// ---------- master playlist pre-resolve ----------

async function resolveMaster(url, streamHeaders) {
    try {
        const resp = await host.http.get(url, {headers: streamHeaders, timeout: TIMEOUT});
        if (resp.status !== 200 && resp.status !== 206) return url;
        const text = resp.body || "";
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/).map(s => s.trim());
        for (const line of lines) {
            if (line && line.charAt(0) !== "#") {
                return host.url.resolve(url, line);
            }
        }
        return url;
    } catch (error) {
        host.log("hgai resolveMaster failed", url, String(error && error.message));
        return url;
    }
}

// ---------- idj1 contract ----------

async function home() {
    const cats = await fetchCats();
    let items = [];
    if (cats.length) {
        const r = await catalog(cats[0][0], 1);
        items = r.items;
    }
    return {
        categories: cats.map(pair => ({id: pair[0], name: pair[1]})),
        items: items,
        hasMore: false,
    };
}

async function category(arg) {
    const tid = str(arg && arg.id);
    const pg = normPg(arg && arg.page);
    const r = await catalog(tid, pg);
    let hasMore = false;
    if (r.items.length) {
        hasMore = r.count > 0 ? (pg * r.items.length < r.count) : false;
    }
    return {items: r.items, hasMore: hasMore};
}

async function search(arg) {
    const pg = normPg(arg && arg.page);
    const keyword = str(arg && arg.keyword);
    // py: the search request always asks the API for page 1.
    const body = await api("/videos?kw=" + encodeURIComponent(keyword) + "&page=1");
    const base = await resolveBase();
    return {items: parseItems(body, base), hasMore: false};
}

async function detail(arg) {
    let nid = str(arg && arg.id);
    if (Array.isArray(arg && arg.id)) nid = str(arg.id[0]);
    nid = nid.trim();
    if (!nid) throw host.error("E_PARSE", "missing id");
    const body = await api("/movie?id=" + encodeURIComponent(nid));
    const base = await resolveBase();
    const data = body && typeof body === "object" ? body.data : null;
    const info = data && typeof data === "object" ? data.info : null;
    if (!info || typeof info !== "object") throw host.error("E_PARSE", "detail has no info");
    const title = info.title || "";
    const playUrl = info.play_url || "";
    if (!title || !playUrl) throw host.error("E_PARSE", "detail missing title/play_url");
    const episodes = [];
    for (const segRaw of String(playUrl).split("#")) {
        const seg = segRaw.trim();
        if (!seg) continue;
        const dollar = seg.indexOf("$");
        if (dollar < 0) continue;
        const name = seg.slice(0, dollar).trim().split("/").pop();
        const url = seg.slice(dollar + 1).trim();
        if (url.indexOf("http") !== 0) continue;
        episodes.push({id: url, name: name});
    }
    if (!episodes.length) throw host.error("E_PARSE", "detail has no episodes");
    const cat = info.category || "";
    const hits = info.hits;
    const parts = [];
    if (cat) parts.push("分类：" + cat);
    if (hits) parts.push("播放：" + String(hits));
    const out = {
        id: nid,
        title: String(title),
        desc: parts.join("\n"),
        tags: cat ? [String(cat)] : [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
    const cover = fixUrl(info.cover_url || "", base);
    if (cover) out.cover = cover;
    if (hits) out.remarks = String(hits);
    return out;
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    if (!raw) throw host.error("E_PARSE", "missing episode id");
    if (raw.indexOf("$") >= 0) raw = raw.split("$", 2)[1] || raw;
    if (raw.indexOf("hgai:") === 0) raw = raw.slice(5);
    const base = await resolveBase();
    const streamHeaders = {"User-Agent": UA, "Referer": base + "/"};
    let m3u8 = "";
    if (raw.indexOf(".m3u8") >= 0) {
        m3u8 = raw;
    } else if (raw.indexOf("http") === 0) {
        const html = await getText(raw, base + "/");
        if (html) {
            const m = DIRECT_M3U8_RE.exec(html);
            if (m) m3u8 = m[0].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
            if (!m3u8) {
                const dm = PLAYER_DATA_RE.exec(html);
                if (dm && dm[2] === "huangguo") {
                    const code = dm[1];
                    if (code.indexOf("|") >= 0) {
                        const parts = code.split("|");
                        const eid = parts[0];
                        const ep = parts.slice(1).join("|");
                        const originM = /^(https?:\/\/[^/]+)/.exec(raw);
                        const originUrl = originM ? originM[1] : "";
                        if (originUrl) {
                            const playApi = originUrl + "/huangguo.php?ac=play&id=" +
                                encodeURIComponent(eid) + "&ep=" + encodeURIComponent(ep) +
                                "&_=" + Date.now();
                            const txt = await getText(playApi, raw);
                            let obj = {};
                            try { obj = JSON.parse(txt || "{}"); } catch (error) { obj = {}; }
                            if (obj && obj.code === 1 && str(obj.url).indexOf("/hgmedia.php?e=") === 0) {
                                m3u8 = originUrl + obj.url;
                                streamHeaders["Referer"] = raw;
                            }
                        }
                    }
                }
            }
        }
    }
    if (!m3u8) throw host.error("E_PARSE", "no m3u8 found for episode");
    if (m3u8.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https: " + m3u8.slice(0, 80));
    const finalUrl = await resolveMaster(m3u8, streamHeaders);
    return {
        streams: [{
            url: finalUrl,
            format: "hls",
            headers: streamHeaders,
            name: "黄瓜AI短剧",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
