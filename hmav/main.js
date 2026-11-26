// 河马AV — idj1 插件（由内置 py 蜘蛛 hmav 改写）
// 站点域名会轮换：原 py 的 5.hmav7911~7913.cc:8888 已跳转到「最新地址发布页」，
// 发布页上列的现行内容站是 5.hmav8451~8453.cc:8888（2026-11-25 实测）。
// 探活逻辑：逐个候选试首页，含 vod-img 即内容站；若落到发布页，
// 从页里抠出 hmav*:8888 链接继续试（域名再轮换也能自愈）。
// 页面是服务端 HTML：列表页 /category/<id>/、/search/<kw>/，详情页 /view/<id> 内嵌 m3u8 直链。
// 部分响应被 decodeURIComponent("...") 包裹，先解包再解析（与原 py 一致）。
// 播放：详情页现取 m3u8 直链，带 UA + Referer。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 45000;
const CACHE_TTL = 180000;

const BASES = [
    "https://5.hmav8451.cc:8888",
    "https://5.hmav8452.cc:8888",
    "https://5.hmav8453.cc:8888",
    "https://5.hmav7911.cc:8888",
    "https://5.hmav7912.cc:8888",
    "https://5.hmav7913.cc:8888",
];
let BASE = BASES[0];
let baseState = {base: "", ts: 0};

// 17 个分类，与原 py CATEGORIES 1:1 对应（成人游戏/赌博类原 py 本就没有，未删减）。
const CATEGORIES = [
    ["1", "大陆"],
    ["2", "日韩"],
    ["3", "欧美"],
    ["4", "动漫"],
    ["5", "综艺"],
    ["6", "国产传媒"],
    ["7", "偷拍自拍"],
    ["35", "绿帽偷情"],
    ["37", "强奸迷奸"],
    ["10", "日韩无码"],
    ["11", "中文字幕"],
    ["12", "日韩杂类"],
    ["19", "欧美无码"],
    ["20", "黑白专区"],
    ["23", "少女动漫"],
    ["30", "网爆黑料"],
    ["28", "其他综艺"],
];

const RE_ITEM = /<a\s+href="(\/view\/[0-9a-zA-Z]+)"\s+class="vod-img">([\s\S]{0,1200}?)<\/a>\s*<a\s+href="\/view\/([0-9a-zA-Z]+)"\s+class="vod-title">([\s\S]*?)<\/a>/g;
const RE_IMG = /data-original="([^"]+)"/;
const RE_DUR = /secondsToHMS\((\d+)\)/;
const RE_M3U8 = /https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*/g;
const RE_H1 = /<h1[^>]*>([\s\S]*?)<\/h1>/;
const RE_DATE = /formatDateString\((\d+)\)/;
const RE_TAG = /href="\/tag\/([^"]+)"/g;
const RE_CONTENT = /<div class="vod-content">([\s\S]*?)<\/div>/;
const RE_TOTAL = /var\s+total\s*=\s*parseInt\((\d+)\)/;

const cache = {};

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function txt(s) {
    if (!s) return "";
    return str(s)
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function fmtDur(sec) {
    sec = intValue(sec, 0);
    if (sec <= 0) return "";
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    if (sec >= 3600) return Math.floor(sec / 3600) + ":" + pad(Math.floor((sec % 3600) / 60)) + ":" + pad(sec % 60);
    return Math.floor(sec / 60) + ":" + pad(sec % 60);
}

function unwrap(raw) {
    if (!raw) return "";
    const m = /decodeURIComponent\("([\s\S]*?)"\)/.exec(raw);
    if (m) {
        try {
            return decodeURIComponent(m[1]);
        } catch (error) {
            return raw;
        }
    }
    return raw;
}

async function httpGetFull(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    };
    if (referer) headers["Referer"] = referer;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp && resp.status >= 200 && resp.status < 400 && resp.body) {
                return {body: resp.body, url: resp.url || url};
            }
            if (resp && resp.body && attempt === 2) return {body: resp.body, url: resp.url || url};
        } catch (error) {
            // 逐个重试，不并行冲
        }
    }
    return {body: "", url: url};
}

async function httpGet(url, referer) {
    const r = await httpGetFull(url, referer);
    return r.body;
}

function originOf(url) {
    try {
        const u = new URL(url);
        return u.protocol + "//" + u.host;
    } catch (error) {
        return "";
    }
}

// 发布页里列的现行地址（hmav 域名 + :8888），抠出来当候选继续探活。
function extractBases(body) {
    const out = [];
    const re = /https?:\/\/[0-9a-zA-Z.-]*hmav[0-9a-zA-Z.-]*:8888/g;
    let m;
    while ((m = re.exec(body || "")) !== null) {
        if (out.indexOf(m[0]) < 0) out.push(m[0]);
    }
    return out;
}

async function ensureBase() {
    const now = Date.now();
    if (baseState.base && now - baseState.ts < 600000) {
        BASE = baseState.base;
        return BASE;
    }
    const queue = BASES.slice();
    const tried = {};
    while (queue.length) {
        const cand = queue.shift();
        if (tried[cand]) continue;
        tried[cand] = true;
        let body = "";
        let finalUrl = cand;
        try {
            const r = await httpGetFull(cand + "/", cand + "/");
            body = unwrap(r.body);
            finalUrl = r.url || cand;
        } catch (error) {
            body = "";
        }
        if (body && body.indexOf("vod-img") >= 0) {
            const base = originOf(finalUrl) || cand;
            baseState = {base: base, ts: now};
            BASE = base;
            // 探活拿到的首页正文顺手塞进 page 缓存，home() 不再重复请求
            cache["P:" + base + "/"] = [Date.now(), body];
            return base;
        }
        // 落到发布页：把页里列的新地址排到队尾继续试
        for (const nb of extractBases(body)) {
            if (!tried[nb] && queue.indexOf(nb) < 0) queue.push(nb);
        }
    }
    baseState = {base: BASES[0], ts: now};
    BASE = BASES[0];
    return BASE;
}

function rebase(url) {
    try {
        const u = new URL(url);
        const b = new URL(BASE);
        if (u.host && u.host !== b.host) {
            return b.protocol + "//" + b.host + u.pathname + u.search + u.hash;
        }
    } catch (error) {
        // 保持原样
    }
    return url;
}

async function page(url) {
    await ensureBase();
    url = rebase(url);
    const key = "P:" + url;
    const hit = cache[key];
    if (hit && Date.now() - hit[0] < CACHE_TTL) return hit[1];
    const body = unwrap(await httpGet(url, BASE + "/"));
    if (body && body.length > 300) {
        if (Object.keys(cache).length > 400) {
            for (const k of Object.keys(cache)) delete cache[k];
        }
        cache[key] = [Date.now(), body];
    }
    return body;
}

function parseList(body) {
    const out = [];
    if (!body) return out;
    const seen = {};
    RE_ITEM.lastIndex = 0;
    let m;
    while ((m = RE_ITEM.exec(body)) !== null) {
        const vid = m[3];
        if (seen[vid]) continue;
        const seg = m[2];
        const name = txt(m[4]);
        if (!name) continue;
        seen[vid] = true;
        let pic = "";
        const im = RE_IMG.exec(seg);
        if (im) {
            pic = im[1];
            if (pic.indexOf("//") === 0) pic = "https:" + pic;
        }
        let dur = "";
        const dm = RE_DUR.exec(seg);
        if (dm) dur = fmtDur(dm[1]);
        out.push({id: vid, title: name, cover: pic, remarks: dur, duration: dur, tags: []});
    }
    return out;
}

function totalPages(body) {
    const m = RE_TOTAL.exec(body || "");
    return m ? intValue(m[1], 1) : 1;
}

// 与原 py 一致：分类每逻辑页合并 4 个站内页，搜索合并 3 个。
async function listMerged(kind, cidOrKw, pg, merge) {
    const items = [];
    const seen = {};
    let total = 1;
    const start = (pg - 1) * merge + 1;
    for (let i = 0; i < merge; i++) {
        const p = start + i;
        let url;
        if (kind === "category") {
            url = p === 1 ? BASE + "/category/" + cidOrKw + "/" : BASE + "/category/" + cidOrKw + "/" + p + "/";
        } else {
            url = p === 1 ? BASE + "/search/" + cidOrKw + "/" : BASE + "/search/" + cidOrKw + "/" + p + "/";
        }
        const body = await page(url);
        if (!body) break;
        if (i === 0) total = totalPages(body);
        const got = parseList(body);
        if (!got.length) break;
        for (const it of got) {
            if (!seen[it.id]) {
                seen[it.id] = true;
                items.push(it);
            }
        }
        if (p >= total) break;
    }
    const pagecount = Math.max(1, Math.ceil(total / merge));
    return {items: items, pagecount: pagecount, total: total};
}

async function fetchDetail(vid) {
    const d = {name: "", content: "", year: "", remarks: "", tags: [], m3u8: ""};
    const body = await page(BASE + "/view/" + vid);
    if (!body) return d;
    const h1 = RE_H1.exec(body);
    if (h1) d.name = txt(h1[1]);
    RE_M3U8.lastIndex = 0;
    const ms = body.match(RE_M3U8) || [];
    if (ms.length) d.m3u8 = ms[0].replace(/&amp;/g, "&");
    const dm = RE_DATE.exec(body);
    if (dm) {
        const ts = intValue(dm[1], 0);
        if (ts > 0) {
            const date = new Date(ts);
            d.year = str(date.getFullYear());
            const pad = (n) => (n < 10 ? "0" + n : "" + n);
            d.remarks = date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
        }
    }
    const cm = RE_CONTENT.exec(body);
    if (cm) d.content = txt(cm[1]);
    RE_TAG.lastIndex = 0;
    let tm;
    while ((tm = RE_TAG.exec(body)) !== null) {
        let t = tm[1];
        try {
            t = decodeURIComponent(t);
        } catch (error) {
            // 保持原文
        }
        if (t && d.tags.indexOf(t) < 0) d.tags.push(t);
    }
    if (!d.content && d.tags.length) d.content = "标签：" + d.tags.join("、");
    return d;
}

function normVid(id) {
    let vid = str(id);
    const m = /([0-9a-fA-F]{16})/.exec(vid);
    if (m) vid = m[1];
    return vid;
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = CATEGORIES.map((item) => ({id: item[0], name: item[1]}));
    await ensureBase();
    let items = parseList(await page(BASE + "/"));
    if (!items.length) {
        const merged = await listMerged("category", "30", 1, 1);
        items = merged.items;
    }
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "1";
    await ensureBase();
    const merged = await listMerged("category", tid, pg, 4);
    return {items: merged.items, hasMore: pg < merged.pagecount};
}

async function search(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    await ensureBase();
    const merged = await listMerged("search", encodeURIComponent(keyword), pg, 3);
    return {items: merged.items, hasMore: pg < merged.pagecount};
}

async function detail(arg) {
    const vid = normVid(arg && arg.id);
    if (!vid) throw new Error("无效的影片 ID");
    await ensureBase();
    const d = await fetchDetail(vid);
    const lines = d.m3u8 ? [{name: "河马AV", episodes: [{id: vid, name: "正片"}]}] : [];
    return {
        id: vid,
        title: d.name || ("视频 " + vid),
        cover: "",
        desc: d.content,
        tags: d.tags,
        lines: lines,
    };
}

// m3u8 在详情页里，播放时现取（与原 py playerContent 一致）。
async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    const vid = normVid(raw);
    if (!vid) throw new Error("无效的播放 ID");
    await ensureBase();
    const d = await fetchDetail(vid);
    if (!d.m3u8) throw new Error("未找到可用的 m3u8 直链");
    return {
        streams: [{
            url: d.m3u8,
            format: "hls",
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
            name: "河马AV",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
