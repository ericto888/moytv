// 妻友社 — idj1 插件（由 CatVod 蜘蛛 qiyoushe v1.0.0 改写）
// 站点：https://d1kmvkv4iwtiup.cloudfront.net；响应是 salt(12) + AES-256-CBC 密文，
// key/iv 由 SHA256 派生（见 deriveKeyIv）；请求要带 HMAC-SHA1 签名（x-api-key 头）。
//
// 相对原蜘蛛丢掉 / 降级的能力：
// - 海报：站方图片前 100 字节异或加密（密钥 2019ysapp7527），原蜘蛛靠 shell 的
//   proxy() 二进制代理解密后交给播放器显示；idj 没有图片代理入口，
//   host.http.request 的 body 是字符串，二进制图字节过 JS 字符串会丢，
//   封面无法在插件内解密——poster() 返回空，列表显示占位图，不直接回原图地址
//   （原图前 100 字节是密文，解码器认不出 JPEG，会显示破图）。
// - CatVod 的 sort 筛选 idj 契约里没有对应物，分类一律走默认排序（sorts[0]）。
// - link() 作者跳转是 CatVod 语义，丢掉；作者名只留在详情简介里。
// - Authorization 头：2026-11-24 转换时 host 会剥掉禁发头，插件当时没发它，
//   只靠 x-api-key 签名里的 token 做身份绑定；实测证明服务端坚持要这个头
//   （不带回 code 1000、空列表，带回 code 200）。用户 2026-11-24 18:40 令
//   宿主放行 Authorization 头后，插件在有 token 时随请求发 Authorization。
// - 游客 token 原来只存在内存里；idj 每次调用都是全新运行时，内存留不住，
//   改走 host.storage 跨调用缓存（带过期时间，过期前 60 秒提前续登）。
// - 加密改走 host.crypto（SHA256 / HMAC-SHA1 / AES-256-CBC），不再带纯 JS 实现。

const HOST = "https://d1kmvkv4iwtiup.cloudfront.net";
const IMAGE_HOST = "https://qiyouimage.arpuum.cn/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TIMEOUT = 20000;
const RESPONSE_KEY = "vEukA&w15z4VAD3kAY#fkL#rBnU!WDhN";
const REQUEST_KEY = "gH3nA7fR9tV1jY6z";
const SALT_LENGTH = 12;
const PAGE_SIZE = 20;
const DEV_ID = "fongmi-qiyou";
const TOKEN_KEY = "qy_token";

// 13 个分类；sorts 依次对应：热门推荐、最新上架、最多观看、最多收藏。
const CATEGORIES = [
    {id: "376401", name: "最新", sorts: ["1", "2", "3", "4"]},
    {id: "342081", name: "推荐", sorts: ["1", "2", "3", "4"]},
    {id: "342083", name: "国产", sorts: ["1", "2", "6", "4"]},
    {id: "696021", name: "换妻原创", sorts: ["1", "2", "3", "4"]},
    {id: "342082", name: "乱伦", sorts: ["1", "2", "3", "4"]},
    {id: "342088", name: "AV", sorts: ["1", "2", "3", "4"]},
    {id: "717241", name: "AI漫剧", sorts: ["1", "2", "3", "4"]},
    {id: "342089", name: "传媒", sorts: ["1", "2", "3", "6"]},
    {id: "342085", name: "网黄", sorts: ["1", "2", "6", "4"]},
    {id: "19201", name: "动漫", sorts: ["1", "2", "3", "4"]},
    {id: "159061", name: "欧美", sorts: ["1", "2", "3", "6"]},
    {id: "696261", name: "重口", sorts: ["1", "2", "3", "6"]},
    {id: "696281", name: "禁片", sorts: ["1", "2", "3", "5"]},
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function clean(text) {
    return str(text)
        .replace(/[\r\n]+/g, " ")
        .replace(/\$/g, " ")
        .replace(/#/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function episodeName(text) {
    return clean(text) || "正片";
}

function durationText(seconds) {
    const total = intValue(seconds, 0);
    if (total <= 0) return "";
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours) return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
    return String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
}

function countText(value) {
    const number = intValue(value, 0);
    if (number >= 100000000) return (number / 100000000).toFixed(1).replace(/\.0$/, "") + "亿";
    if (number >= 10000) return (number / 10000).toFixed(1).replace(/\.0$/, "") + "万";
    return String(number);
}

function payText(value) {
    const type = intValue(value, 0);
    if (type === 1) return "VIP";
    if (type === 2) return "付费";
    return "免费";
}

function yearOf(value) {
    const match = str(value).match(/(19|20)\d{2}/);
    return match ? match[0] : "";
}

function topicText(value) {
    if (!Array.isArray(value)) return "";
    const names = [];
    for (const item of value) {
        if (typeof item === "string") names.push(item);
        else if (item && typeof item === "object") names.push(str(item.name || item.title || item.tagName || ""));
    }
    return names.filter(Boolean).join(",");
}

// ---------- host.crypto：SHA256 / HMAC-SHA1 / AES-256-CBC ----------
// 二进制在 latin1 字符串里中转（每个字符恰好一个字节），与 Go 侧编解码一致。
function sha256Latin1(text) {
    return host.crypto.sha256(text, {in: "latin1", out: "latin1"});
}

function hmacSha1Hex(key, data) {
    return host.crypto.hmac("sha1", key, data, {keyEncoding: "utf8", in: "utf8", out: "hex"});
}

function deriveKeyIv(salt) {
    const seed = RESPONSE_KEY + salt;
    const half = Math.floor(seed.length / 2);
    const middle = sha256Latin1(seed).slice(8, 24);
    const left = sha256Latin1(middle + seed.slice(0, half));
    const right = sha256Latin1(seed.slice(half) + middle);
    return {
        key: left.slice(0, 8) + right.slice(8, 24) + left.slice(24, 32),
        iv: right.slice(0, 4) + left.slice(12, 20) + right.slice(28, 32),
    };
}

function decryptResponse(cipherText) {
    const all = host.codec.base64Decode(cipherText, {to: "latin1"});
    if (all.length <= SALT_LENGTH) throw new Error("响应密文过短");
    const salt = all.slice(0, SALT_LENGTH);
    const bodyB64 = host.codec.base64Encode(all.slice(SALT_LENGTH), {from: "latin1"});
    const derived = deriveKeyIv(salt);
    return host.crypto.aes({
        op: "decrypt", mode: "cbc",
        key: derived.key, keyEncoding: "latin1",
        iv: derived.iv, ivEncoding: "latin1",
        data: bodyB64, in: "base64", out: "utf8",
    });
}

function uuid() {
    const hex = "0123456789abcdef";
    const bytes = [];
    for (let index = 0; index < 36; index++) bytes[index] = hex.charAt(Math.floor(Math.random() * 16));
    bytes[14] = "4";
    bytes[19] = hex.charAt((parseInt(bytes[19], 16) & 3) | 8);
    bytes[8] = bytes[13] = bytes[18] = bytes[23] = "-";
    return bytes.join("");
}

function jwtExpiration(token) {
    const parts = str(token).split(".");
    if (parts.length < 2) return 0;
    try {
        const json = JSON.parse(host.codec.base64Decode(parts[1], {to: "utf8"}));
        return intValue(json.exp, 0) * 1000;
    } catch (error) {
        return 0;
    }
}

function signedM3u8Url(token, videoUrl) {
    const path = "/api/app/media/h5/m3u8/" + str(videoUrl).replace(/^\/+/, "");
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = uuid();
    const sign = hmacSha1Hex(REQUEST_KEY, token + "&" + path + "&&" + timestamp + "&" + nonce);
    return HOST + path + "?token=" + token + "&timestamp=" + timestamp + "&sign=" + sign + "&nonce=" + nonce;
}

// ---------- token：本调用内内存缓存 + host.storage 跨调用缓存 ----------

let cachedToken = "";
let cachedTokenExp = 0;

function loadToken() {
    if (cachedToken && cachedTokenExp > Date.now() + 60000) return cachedToken;
    try {
        const raw = host.storage.get(TOKEN_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj && obj.token && obj.exp > Date.now() + 60000) {
                cachedToken = obj.token;
                cachedTokenExp = obj.exp;
                return cachedToken;
            }
        }
    } catch (error) {}
    return "";
}

function saveToken(token) {
    cachedToken = token;
    const expiration = jwtExpiration(token);
    cachedTokenExp = expiration > Date.now() ? expiration : Date.now() + 12 * 3600 * 1000;
    try {
        host.storage.set(TOKEN_KEY, JSON.stringify({token: token, exp: cachedTokenExp}));
    } catch (error) {}
}

function clearToken() {
    cachedToken = "";
    cachedTokenExp = 0;
    try {
        host.storage.remove(TOKEN_KEY);
    } catch (error) {}
}

// ---------- 接口 ----------

async function rawRequest(apiPath, body, token) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = uuid();
    const signData = token + "&" + apiPath + "&" + UA + "&" + timestamp + "&" + nonce;
    const apiKey = "timestamp=" + timestamp + ";sign=" + hmacSha1Hex(REQUEST_KEY, signData) + ";nonce=" + nonce;
    const resp = await host.http.request({
        url: HOST + apiPath,
        method: "POST",
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "User-Agent": UA,
            "X-User-Agent": UA,
            "x-api-key": apiKey,
            // 宿主 2026-11-24 18:40 起放行 Authorization 头；有 token 才发，
            // 游客登录那次 token 为空不发。
            ...(token ? {"Authorization": token} : {}),
            "qiyou.authSessionEpoch": "",
            "qiyou.authRequestCredentialScope": "",
            "Origin": HOST,
            "Referer": HOST + "/",
            "Accept": "application/json, text/plain, */*",
        },
        body: JSON.stringify(body == null ? {} : body),
        timeout: TIMEOUT,
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
    let outer;
    try {
        outer = JSON.parse(resp.body);
    } catch (error) {
        throw new Error("接口返回不是 JSON");
    }
    const result = {
        code: intValue(outer.code, 0),
        msg: str(outer.msg || ""),
        data: outer.data == null ? null : outer.data,
    };
    if (typeof result.data === "string") {
        result.data = JSON.parse(decryptResponse(result.data));
    }
    return result;
}

async function ensureToken() {
    const hit = loadToken();
    if (hit) return hit;
    const result = await rawRequest("/api/app/login/guest", {
        devID: DEV_ID,
        affCode: "{}",
    }, "");
    if (result.code !== 200 || !result.data || !result.data.token) {
        throw new Error("游客登录失败: " + (result.msg || result.code));
    }
    const token = str(result.data.token);
    saveToken(token);
    return token;
}

async function request(apiPath, body, retry) {
    const shouldRetry = retry !== false;
    let token;
    try {
        token = await ensureToken();
    } catch (error) {
        if (!shouldRetry) throw error;
        clearToken();
        token = await ensureToken();
    }
    let result;
    try {
        result = await rawRequest(apiPath, body, token);
    } catch (error) {
        if (!shouldRetry) throw error;
        clearToken();
        return request(apiPath, body, false);
    }
    const invalid = result.code === 1000 || result.code === 401 || result.code === 6015 ||
        /非法请求|登录|token|签名/i.test(result.msg);
    if (invalid && shouldRetry) {
        clearToken();
        return request(apiPath, body, false);
    }
    return result;
}

// ---------- 卡片 ----------
// 封面见文件头说明：异或加密的海报在 idj 里解不了，返回空（占位图）。
function poster(cover) {
    return "";
}

function card(item) {
    if (!item || typeof item !== "object") return null;
    const id = str(item.id || item.vId || item.videoId);
    if (!id) return null;
    const publisher = item.publisher && typeof item.publisher === "object" ? item.publisher : {};
    const author = clean(publisher.name || item.author || "");
    const duration = durationText(item.playTime || item.duration);
    const views = countText(item.watchTimes || item.watchNum || item.views);
    const remarks = [duration ? duration : "", views ? views + "次观看" : "", payText(item.payType)].filter(Boolean).join(" · ");
    const tags = topicText(item.tagInfoList || item.topics || item.tags)
        .split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean);
    return {
        id: id,
        title: clean(item.title || item.name || id),
        cover: poster(item.coverImg || item.cover || item.img || ""),
        remarks: remarks,
        duration: duration,
        tags: tags,
        _author: author,
        _year: yearOf(item.addedTime || item.createdAt || ""),
        _content: clean(item.desc || item.title || ""),
    };
}

function cards(items) {
    if (!Array.isArray(items)) return [];
    const result = [];
    for (const item of items) {
        const one = card(item);
        if (one) result.push(one);
    }
    return result;
}

function publicCard(one) {
    return {
        id: one.id,
        title: one.title,
        cover: one.cover,
        remarks: one.remarks,
        duration: one.duration,
        tags: one.tags,
    };
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = CATEGORIES.map((item) => ({id: item.id, name: item.name}));
    let items = [];
    try {
        const result = await request("/api/app/media/home", {
            id: intValue(CATEGORIES[0].id, 0),
            sort: intValue(CATEGORIES[0].sorts[0], 1),
            pageNum: 1,
            pageSize: PAGE_SIZE,
        });
        const data = result.data && typeof result.data === "object" ? result.data : {};
        items = cards(data.mediaList || []);
    } catch (error) {
        items = [];
    }
    return {
        categories: categories,
        items: items.map(publicCard),
        hasMore: items.length >= PAGE_SIZE,
    };
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const found = CATEGORIES.find((item) => item.id === str(arg && arg.id));
    const one = found || CATEGORIES[0];
    let items = [];
    try {
        const result = await request("/api/app/media/home", {
            id: intValue(one.id, 0),
            sort: intValue(one.sorts[0], 1),
            pageNum: page,
            pageSize: PAGE_SIZE,
        });
        const data = result.data && typeof result.data === "object" ? result.data : {};
        items = cards(data.mediaList || []);
    } catch (error) {
        items = [];
    }
    return {items: items.map(publicCard), hasMore: items.length >= PAGE_SIZE};
}

async function relatedItems(media, data) {
    const attempts = [];
    const gather = data && data.recommendGather;
    let gatherItems = [];
    if (Array.isArray(gather)) gatherItems = gather;
    else if (gather && typeof gather === "object") gatherItems = gather.mediaList || gather.list || [];
    if (Array.isArray(gatherItems) && gatherItems.length) attempts.push({items: gatherItems});

    const tags = [];
    if (Array.isArray(media.tagInfoList)) tags.push.apply(tags, media.tagInfoList);
    if (Array.isArray(media.topics)) tags.push.apply(tags, media.topics);
    for (const tag of tags) {
        const tagId = tag && typeof tag === "object" ? str(tag.id || tag.tagId || "") : "";
        if (!tagId) continue;
        attempts.push({
            path: "/api/app/media/tag/details",
            body: {
                contentType: intValue(media.contentType, 1) || 1,
                sort: 1,
                id: intValue(tagId, 0),
                pageNum: 1,
                pageSize: 18,
            },
        });
        break;
    }
    const categoryId = intValue(media.categoryId, 0);
    if (categoryId) {
        attempts.push({
            path: "/api/app/media/home",
            body: {id: categoryId, sort: 1, pageNum: 1, pageSize: 18},
        });
    }
    attempts.push({path: "/api/app/media/short/recommend", body: {pageNum: 1, pageSize: 18, type: null}});

    const currentId = str(media.id || "");
    const seen = {};
    const result = [];
    for (const attempt of attempts) {
        let items = attempt.items || [];
        if (!items.length && attempt.path) {
            try {
                const response = await request(attempt.path, attempt.body);
                const payload = response.data && typeof response.data === "object" ? response.data : {};
                items = payload.mediaList || [];
            } catch (error) {
                items = [];
            }
        }
        for (const one of cards(items)) {
            if (one.id === currentId || seen[one.id]) continue;
            seen[one.id] = true;
            result.push(one);
            if (result.length >= 18) return result;
        }
        if (result.length) return result;
    }
    return result;
}

async function detail(arg) {
    const id = str(arg && arg.id);
    if (!id) throw new Error("无效的影片 ID");
    let payload = null;
    try {
        payload = await request("/api/app/media/play", {
            id: /^\d+$/.test(id) ? intValue(id, 0) : id,
            isCollet: false,
        });
    } catch (error) {
        payload = null;
    }
    const data = payload && payload.data && typeof payload.data === "object" ? payload.data : {};
    const media = data.mediaInfo && typeof data.mediaInfo === "object" ? data.mediaInfo : null;
    if (!media || !media.videoUrl) {
        return {id: id, title: id, cover: "", desc: "", tags: [], lines: []};
    }
    const one = card(media);
    if (!one) return {id: id, title: id, cover: "", desc: "", tags: [], lines: []};
    const videoId = str(media.id || id);
    const desc = clean(media.desc || media.title || "") || one.title;

    const related = await relatedItems(media, data);
    const lines = [{
        name: "正片",
        episodes: [{id: videoId, name: "正片"}],
    }];
    if (related.length) {
        lines.push({
            name: "相关推荐",
            episodes: related.map((item) => ({id: item.id, name: item.title})),
        });
    }
    return {
        id: videoId,
        title: one.title,
        cover: one.cover,
        desc: desc,
        duration: one.duration,
        tags: one.tags,
        lines: lines,
    };
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = clean(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const bodies = [
        {content: keyword, mediaType: 1, sort: 0, pageNum: page, pageSize: PAGE_SIZE},
        {content: keyword, mediaType: 2, sort: 0, pageNum: page, pageSize: PAGE_SIZE},
    ];
    const all = [];
    let hasMore = false;
    for (const body of bodies) {
        try {
            const result = await request("/api/app/search/details", body);
            const data = result.data && typeof result.data === "object" ? result.data : {};
            const items = data.mediaList || [];
            if (items.length >= PAGE_SIZE) hasMore = true;
            for (const item of items) all.push(item);
        } catch (error) {
            // 单个搜索类型失败不影响另一个类型
        }
    }
    const seen = {};
    const list = [];
    for (const one of cards(all)) {
        if (seen[one.id]) continue;
        seen[one.id] = true;
        list.push(one);
    }
    return {items: list.map(publicCard), hasMore: hasMore};
}

// 直链签名有时效，播放时重新请求详情现取现用。
async function play(arg) {
    const videoId = str((arg && arg.id) || (arg && arg.episodeId));
    if (!/^\d+$/.test(videoId)) throw new Error("无效的播放 ID");
    let payload;
    try {
        payload = await request("/api/app/media/play", {
            id: intValue(videoId, 0),
            isCollet: false,
        });
    } catch (error) {
        throw new Error("播放信息获取失败");
    }
    const data = payload && payload.data && typeof payload.data === "object" ? payload.data : {};
    const media = data.mediaInfo && typeof data.mediaInfo === "object" ? data.mediaInfo : null;
    const videoUrl = media && media.videoUrl ? str(media.videoUrl) : "";
    if (!videoUrl) throw new Error("未找到可用的 m3u8 直链");
    const token = loadToken() || await ensureToken();
    const url = signedM3u8Url(token, videoUrl);
    return {
        streams: [{
            url: url,
            format: "hls",
            headers: {
                "User-Agent": UA,
                "X-User-Agent": UA,
                "Referer": HOST + "/",
                "Origin": HOST,
            },
            name: "妻友社",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
