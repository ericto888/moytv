// 大哥视频 — idj1 插件（2026-11-24 新写，非 CatVod 改写）
// 站点：https://dage.one（99dh 第 14 项；镜像 dage01.net；站内提示永久域 dagexxx.com）
// Vue 单页应用，内容走 JSON 接口（axios baseURL /api，见站内 /static/index-*.js）：
//  config GET /api/core.json（菜单分类），index GET /api/index.json（最新视频），
//  list GET /api/lists/<分类id>/<页>/<每页24>.json，play GET /api/play/<视频id>.json，
//  search GET /api/vodsearch?key=<关键词>&page=<页>。
// 接口信封 {status:1, data:"<混淆串>"}，解码：data 里 "/"→"0"、"@"→"/"、"."→"+"，
// 再整体反转、补 base64 填充、base64 解码得 JSON（见站内拦截器）。
// 播放：play 接口的 player[0].play 即 m3u8 直链（本机出口实测 200、真 VOD 播放列表，AES-128 分片）。
//
// 降级 / 硬限制：
// - 只做视频分类（菜单里 type=vod 的 4 区 32 个子分类）；图片专区、小说专区（type=news）非视频，不进插件。
// - 首页 /enter 是“继续访问”门禁页（点按钮写 cookie x-index-auth=authed 后进站），
//   但 /api 接口无需该饼干直通（实测 200），插件直接调接口，不走门禁页。
// - 播放直链是 play 接口现取的，无需 Authorization（接口不带鉴权头）。

const SITE = "https://dage.one";
const API = "https://dage.one/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 30000;
const PAGE_SIZE = 24;

// 菜单视频分类（core.json 取不到时兜底；与 2026-11-24 实抓菜单 1:1，只含 type=vod）
const FALLBACK_CATEGORIES = [
    ["56", "亚洲有码"], ["57", "亚洲无码"], ["58", "亚洲主播"], ["59", "韩国高清"],
    ["60", "大陆高清"], ["61", "欧美高清"], ["62", "H动漫"], ["63", "三级伦理"],
    ["101", "日韩无码"], ["102", "中文字幕"], ["103", "国产自制"], ["104", "约炮偷拍"],
    ["105", "传媒剧情"], ["106", "强制乱伦"], ["107", "SM调教"], ["108", "剧情动漫"],
    ["83", "国产制片"], ["84", "日本无码"], ["85", "中文字幕"], ["86", "AV剧情"],
    ["87", "长腿丝袜"], ["88", "邻家人妻"], ["89", "网红主播"], ["90", "国模私拍"],
    ["92", "抖阴视频"], ["93", "网红头条"], ["94", "AV解说"], ["95", "制服诱惑"],
    ["96", "明星换脸"], ["97", "SM调教"], ["98", "女同性恋"], ["99", "VR视角"],
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function absUrl(url, base) {
    const value = str(url).trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (/^\/\//.test(value)) return "https:" + value;
    if (/^\//.test(value)) return base.replace(/\/+$/, "") + value;
    return base.replace(/\/+$/, "") + "/" + value;
}

function cleanText(value) {
    return str(value)
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

async function fetchJson(url) {
    const resp = await host.http.request({
        url: url,
        method: "GET",
        headers: {
            "User-Agent": UA,
            "Referer": SITE + "/",
            "Accept": "application/json, text/plain, */*",
        },
        timeout: TIMEOUT,
    });
    if (resp.status !== 200) throw new Error("请求失败 HTTP " + resp.status + "：" + url);
    let envelope;
    try {
        envelope = JSON.parse(resp.body || "{}");
    } catch (error) {
        throw new Error("接口返回不是 JSON");
    }
    if (envelope.status !== 1) throw new Error("接口返回异常 status=" + str(envelope.status));
    return decodeEnvelope(str(envelope.data));
}

// 信封解码："/"→"0"、"@"→"/"、"."→"+"，反转，补 "="，base64 解码
function decodeEnvelope(data) {
    if (!data) return {};
    let t = data.replace(/\//g, "0").replace(/@/g, "/").replace(/\./g, "+");
    t = t.split("").reverse().join("");
    const rem = t.length % 4;
    if (rem !== 0) t = t + "====".slice(0, 4 - rem);
    const text = host.codec.base64Decode(t, {to: "utf8"});
    return JSON.parse(text);
}

function videoIdOf(item) {
    if (item.vod_id) return str(item.vod_id);
    const url = str(item.url || "");
    const m = /\/play\/(\d+)\.html/.exec(url);
    return m ? m[1] : "";
}

function toItem(item) {
    const id = videoIdOf(item);
    if (!id) return null;
    return {
        id: id,
        title: cleanText(item.title),
        cover: absUrl(item.img, SITE),
        remarks: cleanText(item.duration),
    };
}

function toItems(list) {
    const items = [];
    const seen = {};
    for (const row of list || []) {
        const item = toItem(row);
        if (!item || seen[item.id]) continue;
        seen[item.id] = true;
        items.push(item);
    }
    return items;
}

function parseMenuCategories(core) {
    const result = [];
    const seen = {};
    function walk(nodes) {
        for (const node of nodes || []) {
            if (node.type === "vod" && node.children && node.children.length) {
                walk(node.children);
            } else if (node.type === "vod" && node.id) {
                const id = str(node.id);
                if (!seen[id]) {
                    seen[id] = true;
                    result.push({id: id, name: cleanText(node.name) || id});
                }
            }
            if (node.children) walk(node.children);
        }
    }
    walk(core.menu);
    if (!result.length) {
        for (const pair of FALLBACK_CATEGORIES) result.push({id: pair[0], name: pair[1]});
    }
    return result;
}

async function home() {
    let categories = [];
    let items = [];
    try {
        const core = await fetchJson(API + "/core.json");
        categories = parseMenuCategories(core);
    } catch (error) {
        categories = [];
    }
    if (!categories.length) {
        for (const pair of FALLBACK_CATEGORIES) categories.push({id: pair[0], name: pair[1]});
    }
    try {
        const index = await fetchJson(API + "/index.json");
        items = toItems(index.new && index.new.items);
    } catch (error) {
        items = [];
    }
    return {categories: categories, items: items, hasMore: false};
}

async function category(arg) {
    const id = str(arg && arg.id);
    const page = Math.max(1, parseInt((arg && arg.page) || "1", 10) || 1);
    if (!id) throw new Error("无效的分类 ID");
    const data = await fetchJson(API + "/lists/" + id + "/" + page + "/" + PAGE_SIZE + ".json");
    const items = toItems(data.items);
    return {items: items, hasMore: items.length >= PAGE_SIZE};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    const page = Math.max(1, parseInt((arg && arg.page) || "1", 10) || 1);
    if (!keyword) return {items: [], hasMore: false};
    const data = await fetchJson(API + "/vodsearch?key=" + encodeURIComponent(keyword) + "&page=" + page);
    const items = toItems(data.items);
    return {items: items, hasMore: items.length >= PAGE_SIZE};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    if (!rawId) throw new Error("无效的影片 ID");
    const id = rawId.split("#")[0].replace(/\D/g, "");
    if (!id) throw new Error("无效的影片 ID");
    const data = await fetchJson(API + "/play/" + id + ".json");
    const lines = [];
    const players = data.player || [];
    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        if (!player.play) continue;
        lines.push({
            name: cleanText(player.name) || "播放",
            episodes: [{id: id + "#" + i, name: "全集"}],
        });
    }
    return {
        id: rawId,
        title: cleanText(data.title) || rawId,
        cover: absUrl(data.img, SITE),
        desc: cleanText(data.s_description),
        duration: cleanText(data.time),
        tags: data.tags || [],
        lines: lines,
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    const parts = raw.split("#");
    const id = (parts[0] || "").replace(/\D/g, "");
    const index = parseInt(parts[1] || "0", 10) || 0;
    if (!id) throw new Error("无效的播放地址");
    const data = await fetchJson(API + "/play/" + id + ".json");
    const players = data.player || [];
    const player = players[index] || players[0];
    const url = player && player.play ? str(player.play) : "";
    if (!/^https?:\/\//i.test(url)) throw new Error("未找到可用播放地址");
    return {
        streams: [{
            url: url,
            format: "hls",
            headers: {"User-Agent": UA, "Referer": SITE + "/"},
            name: "大哥视频",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
