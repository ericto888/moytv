// 大奶Ai短剧 — idj1 插件（由内置 py 蜘蛛 danai.py 改写）
// 站点：入口 https://danai88.cc/?from=yng；接口在随机子域名 https://<随机6位>.<后缀>.cyou/api 下，
// 后缀从入口页 HTML 正则提取（取不到时默认 danai88.cyou，与原 py 一致）。
// 接口响应或为明文 JSON，或为 {"cipher": base64} —— AES-128-CBC（key/iv 为固定字符串）
// 解密后是 {"code":0,"data":{...}}，解密走 host.crypto.aes。
//
// 相对原 py 丢掉 / 降级的能力：
// - 封面图代理（localProxy 对图片字节做 AES 解密）：idj 契约没有图片代理，封面直出
//   cover_url。实测当前封面为明文 JPEG 直链可取；个别历史封面若为加密字节，
//   在宿主里可能显示异常，属契约限制，如实标注。
// - 无 Cookie/Authorization 依赖：原 py 本就只带 UA/Referer，无登录态，天然兼容。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 55000;
const ENTRY = "https://danai88.cc/?from=yng";
const API_KEY = "a9yX32LpQvUt7wBc";
const API_IV = "N7cPk2Bv38hWqFzM";

// 原 py FALLBACK_CATS：接口分类取不到时兜底，1:1 照搬（id, name）。
const FALLBACK_CATS = [
    ["2012", "AI成人漫剧"],
    ["2011", "Ai魔改"],
    ["2010", "AI成人短剧"],
    ["1908", "AI短剧"],
    ["1907", "野外露出"],
    ["1906", "女同性恋"],
    ["1905", "变性伪娘"],
    ["1904", "动漫卡通"],
    ["1903", "主奴调教"],
    ["1901", "人妻熟女"],
    ["1899", "欧美激情"],
    ["1897", "韩国三级"],
    ["1895", "强奸乱伦"],
    ["1893", "角色剧情"],
    ["1892", "凌辱快感"],
    ["1890", "多人群交"],
    ["1888", "无码流出"],
    ["1886", "中文字幕"],
    ["1884", "丝袜美腿"],
    ["1882", "制服诱惑"],
    ["1881", "重口性癖"],
    ["1878", "V R 视角"],
    ["1877", "A I 换脸"],
    ["1875", "反差母狗"],
    ["1873", "足浴撩妹"],
    ["1871", "港台辣妹"],
    ["1869", "淫妻作乐"],
    ["1867", "A V 解说"],
    ["1865", "清纯学生"],
    ["1864", "传媒探花"],
    ["1861", "网曝事件"],
    ["1860", "制服丝袜"],
    ["1858", "自拍偷拍"],
    ["1857", "国产乱伦"],
    ["1853", "国产主播"],
    ["1852", "精品推荐"],
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function fixUrl(u) {
    u = str(u);
    if (!u) return "";
    u = u.replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\u002F/g, "/").replace(/\\\//g, "/");
    if (u.indexOf("//") === 0) return "https:" + u;
    return u;
}

function randSub() {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}

// ---------- 基址解析（与原 py _resolve_base 同逻辑，缓存 600 秒） ----------

let baseCache = {base: "", ts: 0};

async function resolveBase() {
    const now = Date.now();
    if (baseCache.base && now - baseCache.ts < 600000) return baseCache.base;
    let suffix = "danai88.cyou";
    try {
        const resp = await host.http.get(ENTRY, {headers: {"User-Agent": UA}, timeout: TIMEOUT});
        if (resp.status === 200 && resp.body) {
            const m = /\.([A-Za-z0-9.\-]+\.cyou)\//.exec(resp.body);
            if (m) suffix = m[1];
        }
    } catch (error) {
        // 入口取不到就用默认后缀，与原 py 一致
    }
    const base = "https://" + randSub() + "." + suffix;
    baseCache = {base: base, ts: now};
    return base;
}

// ---------- HTTP（原 py 3 次重试，本机出口慢，降为 2 次尝试） ----------

async function httpGet(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) headers["Referer"] = referer;
    let lastError = null;
    for (let i = 0; i < 2; i++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
            if (resp.body) return resp.body;
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return "";
}

// ---------- 接口 ----------

async function api(path) {
    const base = await resolveBase();
    const txt = await httpGet(base + "/api" + path, base + "/");
    if (!txt) return {};
    let obj;
    try {
        obj = JSON.parse(txt);
    } catch (error) {
        return {};
    }
    if (obj && typeof obj === "object" && obj.cipher) {
        try {
            const plain = host.crypto.aes({
                op: "decrypt", mode: "cbc",
                key: API_KEY, iv: API_IV,
                data: str(obj.cipher), in: "base64", out: "utf8",
            });
            obj = JSON.parse(plain);
        } catch (error) {
            return {};
        }
    }
    if (!obj || typeof obj !== "object" || obj.code !== 0) return {};
    return obj.data || {};
}

async function fetchCats() {
    let out = [];
    try {
        const data = await api("/categories");
        const lst = data && Array.isArray(data.list) ? data.list : null;
        if (lst) {
            for (const c of lst) {
                if (!c || c.module !== "video") continue;
                const cid = str(c.id || "");
                const name = str(c.name || "");
                if (cid && name) out.push({id: cid, name: name});
            }
        }
    } catch (error) {
        out = [];
    }
    if (!out.length) out = FALLBACK_CATS.map((item) => ({id: item[0], name: item[1]}));
    return out;
}

function toCards(items) {
    const cards = [];
    if (!Array.isArray(items)) return cards;
    for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const vid = str(it.id || "");
        const title = str(it.title || "");
        if (!vid || !title) continue;
        cards.push({
            id: vid,
            title: title,
            cover: fixUrl(it.cover_url || ""),
            remarks: str(it.hits || ""),
            duration: "",
            tags: [],
        });
    }
    return cards;
}

async function catalog(tid, pg) {
    const data = await api("/categories/videos?ids=" + encodeURIComponent(tid) + "&page=" + pg);
    if (!data || typeof data !== "object") return {items: [], total: 0};
    const total = intValue(data.count != null ? data.count : data.total, 0);
    return {items: toCards(data.list || []), total: total};
}

function pageHasMore(page, count, total) {
    if (!count) return false;
    if (total > 0) return page * count < total;
    return true;
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = await fetchCats();
    let items = [];
    if (categories.length) {
        try {
            const first = await catalog(categories[0].id, 1);
            items = first.items;
        } catch (error) {
            items = [];
        }
    }
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    if (!tid) return {items: [], hasMore: false};
    let result = {items: [], total: 0};
    try {
        result = await catalog(tid, page);
    } catch (error) {
        result = {items: [], total: 0};
    }
    return {items: result.items, hasMore: pageHasMore(page, result.items.length, result.total)};
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let items = [];
    let total = 0;
    try {
        const data = await api("/videos?kw=" + encodeURIComponent(keyword) + "&page=" + page);
        if (data && typeof data === "object") {
            items = toCards(data.list || []);
            total = intValue(data.count != null ? data.count : data.total, 0);
        }
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: pageHasMore(page, items.length, total)};
}

async function detail(arg) {
    const nid = str(arg && arg.id).trim();
    if (!nid) throw new Error("无效的影片 ID");
    const data = await api("/movie?id=" + encodeURIComponent(nid));
    const info = data && typeof data === "object" ? data.info : null;
    if (!info || !str(info.title || "")) {
        return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    }
    const title = str(info.title);
    const cat = str(info.category || "");
    const hits = info.hits;
    const parts = [];
    if (cat) parts.push("分类：" + cat);
    if (hits) parts.push("播放：" + str(hits));
    const episodes = [];
    const playUrl = str(info.play_url || "");
    for (const rawSeg of playUrl.split("#")) {
        const seg = rawSeg.trim();
        if (!seg || seg.indexOf("$") < 0) continue;
        const idx = seg.indexOf("$");
        const namePart = seg.slice(0, idx);
        const urlPart = fixUrl(seg.slice(idx + 1).trim());
        if (urlPart.indexOf("http") !== 0) continue;
        let name = namePart.split("/").pop().trim() || "正片";
        episodes.push({id: urlPart, name: name});
    }
    return {
        id: nid,
        title: title,
        cover: fixUrl(info.cover_url || ""),
        desc: parts.join("\n"),
        tags: cat ? [cat] : [],
        lines: episodes.length ? [{name: "在线播放", episodes: episodes}] : [],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id) || "");
    if (raw.indexOf("$") >= 0) raw = raw.split("$").slice(1).join("$");
    if (raw.indexOf("danai:") === 0) raw = raw.slice(6);
    const url = fixUrl(raw);
    if (!url) throw new Error("无效的播放 ID");
    const base = await resolveBase();
    const headers = {"User-Agent": UA, "Referer": base + "/"};
    if (url.indexOf(".m3u8") >= 0) {
        return {
            streams: [{url: url, format: "hls", headers: headers, name: "大奶Ai短剧"}],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    // 非 m3u8：与原 py 一致，抓播放页找 m3u8，再走 huangguo 兜底链。
    const html = await httpGet(url, base + "/");
    if (html) {
        const m = /https?:\/\/[^\s"'<>]*\.m3u8[^\s"'<>]*/.exec(html);
        if (m) {
            const m3u8 = fixUrl(m[0]);
            return {
                streams: [{url: m3u8, format: "hls", headers: {"User-Agent": UA, "Referer": url}, name: "大奶Ai短剧"}],
                expiresAt: Date.now() + 3600 * 1000,
            };
        }
        const m2 = /player_data=\{[^}]*"url":"([^"]+)"[^}]*"from":"([^"]+)"/.exec(html);
        if (m2 && m2[1] && m2[2] === "huangguo") {
            const originMatch = /^(https?:\/\/[^\/]+)/.exec(url);
            if (originMatch) {
                const originUrl = originMatch[1];
                const pair = m2[1].split("|");
                if (pair.length >= 2) {
                    const playApi = originUrl + "/huangguo.php?ac=play&id=" + encodeURIComponent(pair[0]) +
                        "&ep=" + encodeURIComponent(pair[1]) + "&_=" + Date.now();
                    const txt = await httpGet(playApi, url);
                    try {
                        const obj = JSON.parse(txt || "{}");
                        if (obj.code === 1 && str(obj.url || "").indexOf("/hgmedia.php?e=") === 0) {
                            return {
                                streams: [{
                                    url: originUrl + obj.url,
                                    format: "hls",
                                    headers: {"User-Agent": UA, "Referer": url},
                                    name: "大奶Ai短剧",
                                }],
                                expiresAt: Date.now() + 3600 * 1000,
                            };
                        }
                    } catch (error) {
                        // 落到下面的报错
                    }
                }
            }
        }
    }
    throw new Error("未找到可用的播放地址");
}

export default {home: home, category: category, search: search, detail: detail, play: play};
