// PornTube — idj1 插件（由 CatVod 蜘蛛 porntube v1.0.2 改写）
// 站点：porntube.cool；接口 POST <host>/js，响应是 CryptoJS AES-CBC（密码 xxx）
// OpenSSL 格式密文（"Salted__" + salt，EVP_BytesToKey MD5 派生 32 字节 key + 16 字节 iv）。
//
// 相对原蜘蛛丢掉 / 降级的能力：
// - CatVod 的 filters（排序 / 发布时间 / 播放量 / 时长）idj 契约里没有对应物，
//   分类一律走默认最新排序（/sevenVideos?page=&type=）。
// - link() 作者跳转是 CatVod 语义，丢掉；作者名只留在详情简介里。
// - proxy() 图片代理 idj 里没有对应物，丢掉；封面是接口 JSON 里的直链，不受影响。
// - 解密改走 host.crypto（MD5 + AES-256-CBC），不再带纯 JS 的 MD5/AES 实现。
// - m3u8 签名直链约 2 小时有效，play() 每次重新请求详情现取现用，不复用缓存。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 20000;
const PAGE_SIZE = 24;
const APP = "porntube.cool";
const VERSION = "260901";

const HOSTS = [
    "https://v2.cdn199.com",
    "https://v2.kekecdn.net",
    "https://v2.luchu.org",
    "https://v2.madou.ws",
    "https://v2.papapa.biz",
    "https://v2.xiaoshuo.info",
    "https://v2.xiaoshuo.la",
];

// 32 个分类：VIP 免登录专享 + 20 个站点主分类 + 11 个榜单 / 标签。
const CATEGORIES = [
    ["home_vip", "VIP专享（免登录）"],
    ["hot", "91Porn大神"],
    ["banana", "淫工工作室"],
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
    ["cq", "BDSM"],
    ["pissvids", "欧美重口 (pissvids)"],
    ["lesbian", "女同系列"],
    ["xart", "欧美唯美"],
    ["kink", "欧美重口"],
    ["recent", "最近更新"],
    ["hd", "高清视频"],
    ["recent_hot", "最近加精"],
    ["91original", "91原创"],
    ["10mins", "10分钟以上"],
    ["20mins", "20分钟以上"],
    ["month_discuss", "本月讨论"],
    ["month_favs", "本月收藏"],
    ["favs", "收藏最多"],
    ["month_hot", "本月最热"],
    ["last_month_hot", "上月最热"],
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function cleanEpisodeName(value) {
    return str(value)
        .replace(/\$/g, " ")
        .replace(/#/g, " ")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "播放";
}

function yearOf(timestamp) {
    const value = intValue(timestamp, 0);
    if (!value) return "";
    try {
        return str(new Date(value).getFullYear());
    } catch (error) {
        return "";
    }
}

// ---------- host.crypto 解密：CryptoJS AES-CBC OpenSSL 格式 ----------
// 密文 base64 解开是 "Salted__" + 8 字节 salt + AES-256-CBC 密文；
// key/iv 由 EVP_BytesToKey（MD5 链）从密码 "xxx" + salt 派生：
// D1 = MD5(pass + salt)，D2 = MD5(D1 + pass + salt)，D3 = MD5(D2 + pass + salt)，
// key = (D1 + D2 + D3)[0:32]，iv = (D1 + D2 + D3)[32:48]。
// 二进制在 latin1 字符串里中转（每个字符恰好一个字节），与 Go 侧编解码一致。
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
    if (raw.length < 32) throw new Error("响应密文过短");
    if (raw.slice(0, 8) !== "Salted__") throw new Error("响应格式错误");
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

// ---------- 接口 ----------

async function request(hostBase, route, extra) {
    const body = {
        app: APP,
        isStandalone: false,
        theLink: "novaluenull",
        uuid: "novalue",
        version: VERSION,
        deviceInfo: {},
        url: route,
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
            "Origin": "https://porntube.cool",
            "Referer": "https://porntube.cool/",
        },
        body: JSON.stringify(body),
        timeout: TIMEOUT,
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
    let json;
    try {
        json = JSON.parse(resp.body);
    } catch (error) {
        throw new Error("响应不是 JSON");
    }
    if (json.error) throw new Error(str(json.error));
    if (!json.r) throw new Error("响应缺少密文");
    return decryptResponse(json.r);
}

async function api(route, extra) {
    let lastError = null;
    for (const host of HOSTS) {
        try {
            return await request(host, route, extra);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("接口不可用");
}

// ---------- 卡片 ----------

function normalizeVideo(item) {
    if (!item || typeof item !== "object") return null;
    const id = str(item.id || item.vId);
    if (!id) return null;
    const thumbs = item.thumbnails || item.thumbNails || [];
    const pic = thumbs.length ? str(thumbs[0]) : "";
    const keywords = str(item.keywords_gem || item.keywords || "");
    const author = str(item.user || item.user_en || "");
    const vip = Boolean(item.vip);
    const remarks = [str(item.durationStr || ""), str(item.time || ""), vip ? "VIP" : ""]
        .filter(Boolean).join(" · ");
    const tags = keywords.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean);
    return {
        id: id,
        title: str(item.title || item.title_en || id),
        cover: pic,
        remarks: remarks,
        duration: str(item.durationStr || ""),
        tags: tags,
        _author: author,
        _keywords: keywords,
        _year: yearOf(item.createdTime),
        _content: [
            keywords ? "标签：" + keywords : "",
            author ? "作者：" + author : "",
            item.durationStr ? "时长：" + str(item.durationStr) : "",
            item.size ? "大小：" + str(item.size) : "",
            item.views != null ? "播放：" + str(item.views) : "",
            str(item.time || ""),
        ].filter(Boolean).join("\n"),
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

function publicCard(card) {
    return {
        id: card.id,
        title: card.title,
        cover: card.cover,
        remarks: card.remarks,
        duration: card.duration,
        tags: card.tags,
    };
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = CATEGORIES.map((item) => ({id: item[0], name: item[1]}));
    let items = [];
    try {
        const rows = await api("/sevenVideos?page=1&type=home_hot");
        items = videoCards(rows);
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
    const type = str(arg && arg.id) || "hot";
    let items = [];
    try {
        const rows = await api("/sevenVideos?page=" + page + "&type=" + encodeURIComponent(type));
        items = videoCards(rows);
    } catch (error) {
        items = [];
    }
    return {items: items.map(publicCard), hasMore: items.length >= PAGE_SIZE};
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
    return {items: items.map(publicCard), hasMore: items.length >= PAGE_SIZE};
}

async function detail(arg) {
    const id = str(arg && arg.id);
    if (!id) throw new Error("无效的影片 ID");
    let data = null;
    try {
        data = await api("/sevenVideos/" + encodeURIComponent(id), {url_search: ""});
    } catch (error) {
        data = null;
    }
    if (!data || typeof data !== "object" || !(data.id || data.vId)) {
        return {id: id, title: id, cover: "", desc: "", tags: [], lines: []};
    }
    const videoId = str(data.id || data.vId || id);
    const base = normalizeVideo(data);
    if (!base) return {id: id, title: id, cover: "", desc: "", tags: [], lines: []};

    const author = str(data.user || data.user_en || "");
    let related = [];
    if (author) {
        try {
            const rows = await api("/searchSevenVideos", {
                page: 1,
                keywords: "user_" + author,
                filterCategory: "all",
                filterTimeInDays: "all",
                filterViews: "all",
                filterDurationInMins: "all",
                sortBy: "time",
                keywordLogic: "or",
            });
            if (Array.isArray(rows)) {
                related = videoCards(rows).filter((item) => item.id !== videoId).slice(0, 18);
            }
        } catch (error) {
            related = [];
        }
    }

    const lines = [{
        name: "正片",
        episodes: [{id: videoId, name: cleanEpisodeName(data.title || videoId)}],
    }];
    if (related.length) {
        lines.push({
            name: "相关推荐（同作者）",
            episodes: related.map((item) => ({id: item.id, name: item.title})),
        });
    }
    return {
        id: videoId,
        title: base.title,
        cover: base.cover,
        desc: base._content,
        duration: base.duration,
        tags: base.tags,
        lines: lines,
    };
}

// 签名直链有时效，播放时重新请求详情，绝不复用详情页缓存的 m3u8。
async function play(arg) {
    const videoId = str((arg && arg.id) || (arg && arg.episodeId));
    if (!videoId) throw new Error("无效的播放 ID");
    let data;
    try {
        data = await api("/sevenVideos/" + encodeURIComponent(videoId), {url_search: ""});
    } catch (error) {
        throw new Error("播放地址获取失败");
    }
    let urls = [];
    if (data && Array.isArray(data.m3u8s)) urls = data.m3u8s;
    else if (data && data.m3u8) urls = [data.m3u8];
    urls = urls.map((url) => str(url)).filter((url) => /^https?:\/\//i.test(url));
    if (!urls.length) throw new Error("未找到可用的 m3u8 直链");
    return {
        streams: [{
            url: urls[0],
            format: "hls",
            headers: {
                "User-Agent": UA,
                "Referer": "https://porntube.cool/",
                "Origin": "https://porntube.cool",
            },
            name: "PornTube",
        }],
        expiresAt: Date.now() + 2 * 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
