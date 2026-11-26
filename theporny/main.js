// thePorny — idj1 plugin (rewritten 1:1 from the built-in py spider theporny)
// Site: theporny.com; API POST <host>/js, response is CryptoJS AES-CBC (password xxx)
// in OpenSSL format ("Salted__" + salt, EVP_BytesToKey MD5 derives 32-byte key + 16-byte iv).
// Mapping to the original py:
// - app=theporny.com, theLink=https://rs.xiaoxx.com, version=260901, uuid built as
//   U+UTC timestamp+4 random digits; detail carries url_search=?server=hd1 (line hd1).
// - The py sends Authorization: Bearer undefined as a placeholder header; the API
//   does not rely on it, so the plugin does not send it.
// - Decryption goes through host.crypto (MD5 + AES-256-CBC).
// - The m3u8 lives in the detail payload; play() re-fetches the detail every time.
//   If the returned playlist is a master playlist, play() resolves it to the
//   first variant (child) playlist before returning.
// - Categories match the py CATS table 1:1 (30 entries), nothing dropped or merged.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 55000;
const BASE = "https://theporny.com";
const APP = "theporny.com";
const VERSION = "260901";
const THELINK = "https://rs.xiaoxx.com";
const LINE = "hd1";

const HOSTS = [
    "https://v2.cdn199.com",
    "https://v2.kekecdn.net",
    "https://v2.luchu.org",
    "https://v2.madou.ws",
    "https://v2.papapa.biz",
    "https://v2.tianmtv.com",
    "https://v2.xiaoshuo.info",
    "https://v2.xiaoshuo.la",
];

const CATEGORIES = [
    ["hot", "当前最热"],
    ["recent", "最近更新"],
    ["high", "站长推荐"],
    ["hd", "会员专享视频"],
    ["recent_hot", "最近加精"],
    ["10mins", "10分钟以上"],
    ["20mins", "20分钟以上"],
    ["month_discuss", "本月讨论"],
    ["month_favs", "本月收藏"],
    ["favs", "收藏最多"],
    ["month_hot", "本月最热"],
    ["last_month_hot", "上月最热"],
    ["c0", "国产传媒全集"],
    ["c1", "麻豆视频"],
    ["c2", "91制片厂"],
    ["c3", "玩偶姐姐"],
    ["c4", "小鸟酱专题"],
    ["c5", "糖心Vlog"],
    ["c6", "天美传媒"],
    ["c7", "蜜桃传媒"],
    ["c8", "皇家华人"],
    ["c9", "星空传媒"],
    ["ca", "精东影业"],
    ["cc", "成人头条"],
    ["cd", "乌鸦传媒"],
    ["cl", "开心鬼传媒"],
    ["japan", "日本高清AV"],
    ["banana", "汝工作室"],
    ["swag", "台湾Swag全集"],
    ["torture_all", "重口系列"],
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function makeUuid() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = String(now.getUTCFullYear()) + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate())
        + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds());
    const rand = String(Math.floor(1000 + Math.random() * 9000));
    return "U" + stamp + rand;
}

function evpBytesToKey(password, salt) {
    let prev = "";
    let derived = "";
    while (derived.length < 48) {
        prev = host.crypto.md5(prev + password + salt, {in: "latin1", out: "latin1"});
        derived += prev;
    }
    return {key: derived.slice(0, 32), iv: derived.slice(32, 48)};
}

function decryptResponse(cipherText) {
    const raw = host.codec.base64Decode(cipherText, {to: "latin1"});
    if (raw.length < 32) throw new Error("ciphertext too short");
    if (raw.slice(0, 8) !== "Salted__") throw new Error("bad response format");
    const salt = raw.slice(8, 16);
    const payloadB64 = host.codec.base64Encode(raw.slice(16), {from: "latin1"});
    const derived = evpBytesToKey("xxx", salt);
    const plain = host.crypto.aes({
        op: "decrypt", mode: "cbc",
        key: derived.key, keyEncoding: "latin1",
        iv: derived.iv, ivEncoding: "latin1",
        data: payloadB64, in: "base64", out: "utf8",
    });
    return JSON.parse(plain);
}

async function request(hostBase, route, extra) {
    const body = {
        app: APP,
        isStandalone: false,
        theLink: THELINK,
        uuid: makeUuid(),
        url: route,
        version: VERSION,
        deviceInfo: {},
    };
    if (extra) {
        for (const key of Object.keys(extra)) body[key] = extra[key];
    }
    const resp = await host.http.request({
        url: hostBase + "/js",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Origin": BASE,
            "Referer": BASE + "/",
        },
        body: JSON.stringify(body),
        timeout: TIMEOUT,
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
    let json;
    try {
        json = JSON.parse(resp.body);
    } catch (error) {
        throw new Error("response is not JSON");
    }
    if (json && json.blocked) throw new Error("blocked");
    if (json && json.r) return decryptResponse(json.r);
    return json;
}

async function api(route, extra) {
    let lastError = null;
    let blockedCount = 0;
    for (const hostBase of HOSTS) {
        try {
            return await request(hostBase, route, extra);
        } catch (error) {
            lastError = error;
            if (error && error.message === "blocked") {
                blockedCount++;
                if (blockedCount >= 3) break;
            }
        }
    }
    throw lastError || new Error("api unavailable");
}

function coverOf(item) {
    const thumbs = item.thumbnails || item.thumbNails || [];
    if (Array.isArray(thumbs) && thumbs.length) return str(thumbs[0]);
    return "";
}

function normalizeVideo(item) {
    if (!item || typeof item !== "object") return null;
    const id = str(item.id || item.vId);
    const title = str(item.title);
    if (!id || !title) return null;
    const tagsText = str(item.keywords_gem || item.tags || "");
    const tags = tagsText.split(/[,，、\s]+/).map((tag) => tag.trim()).filter(Boolean);
    return {
        id: id,
        title: title,
        cover: coverOf(item),
        remarks: str(item.durationStr || ""),
        duration: str(item.durationStr || ""),
        tags: tags,
    };
}

function videoCards(items) {
    const cards = [];
    const seen = {};
    if (!Array.isArray(items)) return cards;
    for (const item of items) {
        const card = normalizeVideo(item);
        if (!card || seen[card.id]) continue;
        seen[card.id] = true;
        cards.push(card);
    }
    return cards;
}

async function home() {
    const categories = CATEGORIES.map((item) => ({id: item[0], name: item[1]}));
    let items = [];
    try {
        const rows = await api("/sevenVideos?page=1&type=hot");
        items = videoCards(rows);
    } catch (error) {
        items = [];
    }
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    let type = str(arg && arg.id).trim();
    if (!type || type === "all") type = "hot";
    let items = [];
    try {
        const rows = await api("/sevenVideos?page=" + page + "&type=" + encodeURIComponent(type));
        items = videoCards(rows);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let items = [];
    try {
        const rows = await api("/searchSevenVideos", {
            page: page,
            keywords: keyword,
            filterCategory: "all",
            filterTimeInDays: "all",
            filterViews: "all",
            filterDurationInMins: "all",
            sortBy: "time",
            keywordLogic: "or",
        });
        items = videoCards(rows);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: items.length > 0};
}

async function fetchDetailData(vid) {
    const data = await api("/sevenVideos/" + encodeURIComponent(vid), {url_search: "?server=" + LINE});
    if (!data || typeof data !== "object") return null;
    return data;
}

function m3u8Of(data) {
    const m3u8s = data.m3u8s;
    if (Array.isArray(m3u8s) && m3u8s.length && m3u8s[0]) return str(m3u8s[0]);
    return str(data.m3u8 || "");
}

async function detail(arg) {
    const id = str(arg && arg.id).trim();
    if (!id) throw host.error("E_PARSE", "invalid video id");
    let data = null;
    try {
        data = await fetchDetailData(id);
    } catch (error) {
        data = null;
    }
    if (!data) return {id: id, title: id, cover: "", desc: "", tags: [], lines: []};
    const title = str(data.title);
    const m3u8 = m3u8Of(data);
    if (!title || !m3u8) return {id: id, title: title || id, cover: coverOf(data), desc: "", tags: [], lines: []};
    const keywords = str(data.keywords_gem || "");
    const tagsText = str(data.tags || "");
    const user = str(data.user || "");
    const desc = [keywords, tagsText, user ? "作者：" + user : ""].filter(Boolean).join("\n");
    const tags = (keywords + "," + tagsText).split(/[,，、\s]+/).map((tag) => tag.trim()).filter(Boolean);
    return {
        id: id,
        title: title,
        cover: coverOf(data),
        desc: desc,
        duration: str(data.durationStr || ""),
        tags: tags,
        lines: [{
            name: "在线播放",
            episodes: [{id: id, name: "高速线路1"}],
        }],
    };
}

async function resolveMaster(url, headers) {
    try {
        const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
        if (!resp || resp.status < 200 || resp.status >= 300 || !resp.body) return url;
        const text = resp.body;
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/).map((s) => s.trim());
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j] && lines[j].charAt(0) !== "#") {
                        return host.url.resolve(url, lines[j]);
                    }
                }
            }
        }
        return url;
    } catch (error) {
        return url;
    }
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    if (!raw) throw host.error("E_PARSE", "invalid play id");
    const headers = {"User-Agent": UA, "Referer": BASE + "/"};
    let m3u8 = "";
    if (/^https?:\/\//i.test(raw) && raw.indexOf(".m3u8") >= 0) {
        m3u8 = raw;
    } else {
        let data;
        try {
            data = await fetchDetailData(raw);
        } catch (error) {
            throw host.error("E_NETWORK", "failed to fetch play address");
        }
        if (!data) throw host.error("E_NETWORK", "failed to fetch play address");
        m3u8 = m3u8Of(data);
        if (!m3u8 || !/^https?:\/\//i.test(m3u8)) throw host.error("E_PARSE", "no usable m3u8 in detail");
    }
    const finalUrl = await resolveMaster(m3u8, headers);
    return {
        streams: [{
            url: finalUrl,
            format: "hls",
            headers: headers,
            name: "高速线路1",
        }],
        expiresAt: Date.now() + 2 * 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
