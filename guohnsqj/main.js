// 欲望乐园 — idj1 插件（由内置 py 蜘蛛 guohnsqj 改写）
// 接口：https://zdap.gkquu.cn:4438/zd2/ ，请求带签名头
// sign = MD5(timestamp + GUID + nonce + SALT) 大写，token = GUID，url 头 = 站点 HOST。
// 响应 returnValue==1 时取 returnData：可能是对象、JSON 字符串，
// 或 Base64 的 AES-CBC 密文（key mh_aes=19@#$@%@# / iv 5e1y6w452uqw9jq8），与原 py 一致。
// 分类与原 py 完全一致：只有 1 个「全部视频」（原 py 自带：game 分类返回空，照搬保留判断）。
// 列表走 /sp/getHomeList，详情走 /sp/getVideoDetail，搜索走 /sp/getSearchList。
// 播放：详情现取 videoUrlOne（线路一）/ videoUrlTwo（线路二），直链 mp4/m3u8，parse=0。

const API = "https://zdap.gkquu.cn:4438/zd2/";
const HOST = "guohnsqj.hdyubao.cyou";
const SALT = "@1243asd31**21#";
const AES_KEY = "mh_aes=19@#$@%@#";
const AES_IV = "5e1y6w452uqw9jq8";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const TIMEOUT = 58000;
const HOME_SIZE = 30;
const SEARCH_SIZE = 25;
const NONCE_ALPH = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";

const CATEGORIES = [["video", "全部视频"]];

function makeGuid() {
    try {
        let hex = host.crypto.randomHex(16);
        hex = String(hex).replace(/[^0-9a-f]/gi, "").toLowerCase();
        if (hex.length >= 32) {
            hex = hex.slice(0, 32);
            const variant = "89ab"[parseInt(hex.charAt(16), 16) % 4];
            return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) + "-" + variant + hex.slice(17, 20) + "-" + hex.slice(20, 32);
        }
    } catch (error) {
        // 落到 Math.random 兜底
    }
    let s = "";
    const chars = "0123456789abcdef";
    for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * 16)];
    return s.slice(0, 8) + "-" + s.slice(8, 12) + "-4" + s.slice(13, 16) + "-8" + s.slice(17, 20) + "-" + s.slice(20, 32);
}

const GUID = makeGuid();

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function nonce(n) {
    let out = "";
    for (let i = 0; i < (n || 16); i++) out += NONCE_ALPH[Math.floor(Math.random() * NONCE_ALPH.length)];
    return out;
}

function signHeaders() {
    const ts = Date.now();
    const nn = nonce(16);
    let sign = "";
    try {
        sign = host.crypto.md5(String(ts) + GUID + nn + SALT, {in: "utf8", out: "hex"}).toUpperCase();
    } catch (error) {
        sign = "";
    }
    return {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded",
        "token": GUID,
        "sign": sign,
        "timestamp": String(ts),
        "nonce": nn,
        "url": HOST,
    };
}

function unwrapReturnData(raw) {
    if (raw && typeof raw === "object") return raw;
    if (typeof raw !== "string" || !raw.trim()) return {};
    try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") return obj;
    } catch (error) {
        // 继续走 AES 解密
    }
    try {
        const plain = host.crypto.aes({
            op: "decrypt", mode: "cbc",
            key: AES_KEY, keyEncoding: "utf8",
            iv: AES_IV, ivEncoding: "utf8",
            data: raw, in: "base64", out: "utf8",
        });
        const obj = JSON.parse(plain);
        if (obj && typeof obj === "object") return obj;
    } catch (error) {
        // 解不开按原 py 返回空
    }
    return {};
}

async function api(path, params) {
    const qs = host.url.encodeForm(params || {});
    let url = API + String(path).replace(/^\//, "");
    if (qs) url += "?" + qs;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: signHeaders(), timeout: TIMEOUT});
            if (!resp || !resp.body || !String(resp.body).trim()) {
                lastError = new Error("响应为空 HTTP " + (resp ? resp.status : "?"));
                continue;
            }
            let obj;
            try {
                obj = JSON.parse(resp.body);
            } catch (error) {
                return {};
            }
            if (!obj || typeof obj !== "object") return {};
            if (obj.returnValue !== 1) return {};
            return unwrapReturnData(obj.returnData);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return {};
}

async function apiSoft(path, params) {
    try {
        return await api(path, params);
    } catch (error) {
        return {};
    }
}

function fixUrl(u) {
    u = str(u);
    if (!u) return "";
    u = u.replace(/&amp;/g, "&");
    if (u.indexOf("//") === 0) return "https:" + u;
    return u;
}

function videoTitle(it) {
    const title = str(it.videoTitle).trim();
    if (title) return title;
    const user = str(it.userName).trim();
    if (user) return user;
    return "视频" + str(it.videoId);
}

function videoCards(lst) {
    const out = [];
    if (!Array.isArray(lst)) return out;
    for (const it of lst) {
        if (!it || typeof it !== "object") continue;
        const vid = str(it.videoId);
        if (!vid) continue;
        out.push({
            id: "v:" + vid,
            title: videoTitle(it),
            cover: fixUrl(it.videoCover || ""),
            remarks: str(it.userName || ""),
            tags: [],
        });
    }
    return out;
}

async function homeList(pg) {
    const body = await apiSoft("/sp/getHomeList", {page: pg, size: HOME_SIZE});
    const total = intValue(body && body.total, 0);
    return {items: videoCards(body && body.videoList), total: total};
}

async function fetchDetailInfo(vid) {
    const body = await apiSoft("/sp/getVideoDetail", {videoId: vid});
    const info = body && typeof body === "object" ? body.videoDetail : null;
    if (!info || typeof info !== "object") return null;
    if (!str(info.videoId)) return null;
    return info;
}

function normVid(raw) {
    let s = str(raw).trim();
    if (s.indexOf("guohnsqj:") === 0) s = s.slice("guohnsqj:".length);
    if (s.indexOf("v:") === 0) s = s.slice(2);
    // 播放集 id 形如 <vid>:1 / <vid>:2，去掉线路后缀
    const parts = s.split(":");
    return parts[0] || "";
}

function parsePlayId(raw) {
    let s = str(raw).trim();
    if (s.indexOf("guohnsqj:") === 0) s = s.slice("guohnsqj:".length);
    if (s.indexOf("http") === 0) return {direct: s, vid: "", line: "1"};
    if (s.indexOf("v:") === 0) s = s.slice(2);
    const parts = s.split(":");
    return {direct: "", vid: parts[0] || "", line: parts[1] || "1"};
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = CATEGORIES.map((item) => ({id: item[0], name: item[1]}));
    const r = await homeList(1);
    return {categories: categories, items: r.items, hasMore: r.items.length >= HOME_SIZE};
}

async function category(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "video";
    if (tid === "game") return {items: [], hasMore: false};
    const r = await homeList(pg);
    let hasMore;
    if (r.total > 0) hasMore = pg * HOME_SIZE < r.total;
    else hasMore = r.items.length >= HOME_SIZE;
    return {items: r.items, hasMore: hasMore};
}

async function search(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const body = await apiSoft("/sp/getSearchList", {searchName: keyword, searchType: "all", page: pg, size: SEARCH_SIZE});
    const total = intValue(body && body.total, 0);
    const items = videoCards(body && body.videoList);
    let hasMore;
    if (total > 0) hasMore = pg * SEARCH_SIZE < total;
    else hasMore = items.length >= SEARCH_SIZE;
    return {items: items, hasMore: hasMore};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const vid = normVid(raw);
    if (!vid) throw new Error("无效的影片 ID");
    const info = await fetchDetailInfo(vid);
    if (!info) throw new Error("详情接口未返回数据");
    const user = str(info.userName || "");
    const parts = [];
    if (user) parts.push("博主：" + user);
    const des = str(info.videoDes || "");
    if (des) parts.push(des);
    const lines = [];
    const urlOne = fixUrl(info.videoUrlOne || "");
    const urlTwo = fixUrl(info.videoUrlTwo || "");
    if (urlOne) lines.push({name: "线路一", episodes: [{id: "guohnsqj:v:" + vid + ":1", name: "播放"}]});
    if (urlTwo) lines.push({name: "线路二", episodes: [{id: "guohnsqj:v:" + vid + ":2", name: "播放"}]});
    return {
        id: "v:" + vid,
        title: videoTitle(info),
        cover: fixUrl(info.videoCover || ""),
        desc: parts.join("\n"),
        tags: [],
        lines: lines,
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    const parsed = parsePlayId(raw);
    let stream = parsed.direct || "";
    if (!stream && parsed.vid) {
        const info = await fetchDetailInfo(parsed.vid);
        if (info) {
            const urlOne = fixUrl(info.videoUrlOne || "");
            const urlTwo = fixUrl(info.videoUrlTwo || "");
            if (parsed.line === "2") {
                stream = urlTwo || urlOne;
            } else {
                stream = urlOne;
                // 线路一是 video.twimg.com 原链，与线路二是同一视频文件；
                // twimg 在多数网络下不可达/回 503，有镜像时优先镜像（实测 206 可播）。
                if (stream.indexOf(".twimg.com/") >= 0 && urlTwo && urlTwo.indexOf(".twimg.com/") < 0) {
                    stream = urlTwo;
                }
            }
        }
    }
    if (!stream) throw new Error("未找到可用的播放直链");
    let headers = {"User-Agent": UA, "Referer": "https://" + HOST + "/"};
    if (stream.indexOf("https://video.twimg.com/") === 0 || stream.indexOf(".twimg.com/") >= 0) {
        headers = {"User-Agent": UA, "Referer": "https://x.com/"};
    }
    const isHls = /\.m3u8($|\?)/i.test(stream);
    return {
        streams: [{
            url: stream,
            format: isHls ? "hls" : "mp4",
            headers: headers,
            name: "欲望乐园",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
