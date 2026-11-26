// 91短剧 — idj1 插件（由内置 py 蜘蛛 dj91 改写）
// 站点：app.91dju.cyou；接口 GET <BASE>/api/...，响应可能是明文 JSON，
// 也可能是 {"cipher": base64} —— AES-128-CBC（key/iv 与原 py 相同）解密后才是 JSON。
// 分类与原 py 一致：优先 /config 里的 home_rec_cat_id + core_category_ids，
// 再 /categories/batch 取名，只留 module=video，并照搬原 py 的旗标词过滤；
// 动态取不到时回退原 py 写死的 5 个分类。
//
// 相对原 py 丢掉 / 降级的能力：
// - localProxy 图片解密代理 idj 里没有对应物：封面回 cover_url 直链。
//   实测当前封面就是明文 JPEG（ffd8 魔数、200 直取），直链可用；
//   个别被加密的封面图在插件里无法解密显示（原 py 靠本地代理 + 图片 key/iv）。
// - 播放：剧集原始地址经 /parse_video 现取 m3u8_url，与原 py playerContent 一致，现取现用。

const BASE = "https://app.91dju.cyou";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 55000;
const AES_KEY = "a9yX32LpQvUt7wBc";
const AES_IV = "N7cPk2Bv38hWqFzM";

const FALLBACK_CATS = [
    ["2041", "AI短剧"],
    ["2042", "AI漫剧"],
    ["2034", "国产原创"],
    ["2035", "吃瓜爆料"],
    ["2037", "91探花"],
];

// 原 py FLAG_WORDS 原样照搬：命中任一词的分类名不进分类表。
const FLAG_WORDS = ["loli", "lolita", "幼女", "幼齿", "初中生", "小学生", "未成年",
    "未满", "萝莉", "童颜", "幼态", "处女", "小萝莉"];

function isFlagged(name) {
    const low = String(name || "").toLowerCase();
    return FLAG_WORDS.some((w) => low.indexOf(w.toLowerCase()) >= 0);
}

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

// ---------- 接口 ----------

async function api(path) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(BASE + "/api" + path, {
                headers: {
                    "User-Agent": UA,
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Referer": BASE + "/",
                },
                timeout: TIMEOUT,
            });
            if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
            if (!resp.body) throw new Error("响应为空");
            let obj = JSON.parse(resp.body);
            if (obj && typeof obj === "object" && obj.cipher) {
                const plain = host.crypto.aes({
                    op: "decrypt", mode: "cbc",
                    key: AES_KEY, keyEncoding: "utf8",
                    iv: AES_IV, ivEncoding: "utf8",
                    data: str(obj.cipher), in: "base64", out: "utf8",
                });
                obj = JSON.parse(plain);
            }
            return (obj && typeof obj === "object") ? obj : {};
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("接口不可用");
}

// ---------- 分类（与原 py _cats 一致） ----------

let catsCache = null;

async function getCats() {
    if (catsCache) return catsCache;
    let out = [];
    try {
        const body = await api("/config");
        const data = (body && typeof body.data === "object") ? body.data : null;
        const ids = [];
        if (data) {
            for (const field of ["home_rec_cat_id", "core_category_ids"]) {
                const parts = str(data[field] || "").split(",");
                for (const p of parts) {
                    const t = p.trim();
                    if (t) ids.push(t);
                }
            }
        }
        if (ids.length) {
            const batch = await api("/categories/batch/" + ids.join(","));
            const bdata = batch ? batch.data : null;
            let lst = null;
            if (bdata && typeof bdata === "object" && Array.isArray(bdata.list)) lst = bdata.list;
            else if (Array.isArray(bdata)) lst = bdata;
            for (const it of lst || []) {
                if (!it || typeof it !== "object") continue;
                if (it.module !== "video") continue;
                const cid = str(it.id);
                const name = str(it.name || "");
                if (cid && name && !isFlagged(name)) out.push({id: cid, name: name});
            }
        }
    } catch (error) {
        out = [];
    }
    if (!out.length) {
        out = FALLBACK_CATS.filter((c) => !isFlagged(c[1])).map((c) => ({id: c[0], name: c[1]}));
    }
    catsCache = out;
    return out;
}

// ---------- 卡片 ----------

function parseItems(body) {
    const out = [];
    const data = (body && typeof body.data === "object") ? body.data : null;
    const lst = (data && Array.isArray(data.list)) ? data.list : [];
    for (const it of lst) {
        if (!it || typeof it !== "object") continue;
        const vid = str(it.id);
        const title = str(it.title || "");
        if (!vid || !title) continue;
        out.push({
            id: vid,
            title: title,
            cover: fixUrl(it.cover_url || ""),
            remarks: str(it.hits || ""),
            duration: "",
            tags: [],
        });
    }
    return out;
}

async function catalog(tid, pg) {
    const body = await api("/videos?category_id=" + encodeURIComponent(tid) + "&page=" + pg + "&ps=28");
    const items = parseItems(body);
    const data = (body && typeof body.data === "object") ? body.data : null;
    const total = data ? intValue(data.total, 0) : 0;
    return {items: items, total: total};
}

// ---------- idj1 契约 ----------

async function home() {
    const cats = await getCats();
    let items = [];
    if (cats.length) {
        try {
            items = (await catalog(cats[0].id, 1)).items;
        } catch (error) {
            items = [];
        }
    }
    return {categories: cats, items: items, hasMore: items.length >= 28};
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
    return {items: result.items, hasMore: result.items.length >= 28 || (result.total > page * 28)};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    // 原 py 搜索固定取第一页 ps=13（忽略传入页码），照搬。
    let items = [];
    try {
        const body = await api("/videos?kw=" + encodeURIComponent(keyword) + "&page=1&ps=13");
        items = parseItems(body);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const id = str(arg && arg.id).trim();
    if (!id) throw new Error("无效的影片 ID");
    const body = await api("/movie?id=" + encodeURIComponent(id));
    const data = (body && typeof body.data === "object") ? body.data : null;
    const info = (data && typeof data.info === "object") ? data.info : null;
    if (!info) return {id: id, title: id, cover: "", desc: "", tags: [], lines: []};
    const title = str(info.title || "");
    // play_url 形如 "第1集$url#第2集$url"，与原 py _parse_episodes 一致拆分。
    const episodes = [];
    for (const segRaw of str(info.play_url || "").split("#")) {
        const seg = segRaw.trim();
        if (!seg || seg.indexOf("$") < 0) continue;
        const idx = seg.indexOf("$");
        let name = seg.slice(0, idx).trim();
        const url = seg.slice(idx + 1).trim();
        if (name.indexOf("http://localhost:8080/") === 0) name = name.slice("http://localhost:8080/".length);
        if (!name || !url) continue;
        episodes.push({id: url, name: name});
    }
    if (!title || !episodes.length) {
        return {id: id, title: title || id, cover: "", desc: "", tags: [], lines: []};
    }
    const cat = str(info.category || "");
    const hits = info.hits;
    const parts = [];
    if (cat) parts.push("分类：" + cat);
    if (hits) parts.push("播放：" + str(hits));
    return {
        id: id,
        title: title,
        cover: fixUrl(info.cover_url || ""),
        desc: parts.join("\n"),
        tags: cat ? [cat] : [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id) || "").trim();
    if (raw.indexOf("dj91:") === 0) raw = raw.slice(5);
    if (!raw) throw new Error("无效的播放 ID");
    let m3u8 = "";
    if (/\.m3u8($|\?)/i.test(raw)) {
        // 剧集地址本身已是 m3u8 直链：实测 /parse_video 对这类地址回的就是原地址，省一跳。
        m3u8 = raw;
    } else if (/^https?:\/\//i.test(raw)) {
        const body = await api("/parse_video?url=" + encodeURIComponent(raw));
        const data = (body && typeof body.data === "object") ? body.data : null;
        if (data) m3u8 = str(data.m3u8_url || "");
    }
    if (!m3u8) throw new Error("未找到可用的播放地址");
    const format = /\.m3u8($|\?)/i.test(m3u8) ? "hls" : "mp4";
    return {
        streams: [{
            url: m3u8,
            format: format,
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
            name: "在线播放",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
