// 新黄果短剧 — idj1 插件（由内置 py 蜘蛛 aimove 改写）
// 站点：aimove.click；接口 JSON：/api/dramas/categories、/api/dramas(?categoryId=)、
// /api/dramas/{id}；封面在 img.mfantasy.net；播放是 /api/media/<hash>/index.m3u8（HLS 主列表）。
//
// 与原 py 的差异（如实说明）：
// - 原 py 对锁定集走游客自动注册 → 签到领金币 → 逐集解锁，令牌靠 Authorization 头传递；
//   idj 宿主会剥离 Authorization 头，且本站不认 ?token= / token 头 / X-Access-Token 等
//   替代通道（2026-11-25 本机逐个实测均无效），所以插件内解锁链照原样保留但在当前
//   宿主下不会生效；未解锁集会明确报错，不编造地址。已解锁集（每部第 1 集等）直出 videoUrl 播放。
// - 列表接口一次返回全量，分页与搜索按原 py 在本地做（PAGE_SIZE=24、标题包含匹配）。
// - 分类与原 py 一样实时取 /api/dramas/categories，并照搬 FLAG_WORDS 旗标过滤。

const BASE = "https://aimove.click";
const IMG_BASE = "https://img.mfantasy.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 55000;
const RETRIES = 2;
const PAGE_SIZE = 24;

const FLAG_WORDS = [
    "loli", "lolita", "幼女", "幼齿", "初中生", "小学生", "未成年",
    "未满", "萝莉", "童颜", "幼态", "处女", "小萝莉",
];

function isFlagged(name) {
    const low = String(name || "").toLowerCase();
    return FLAG_WORDS.some((w) => low.indexOf(w.toLowerCase()) >= 0);
}

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function absUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASE + u;
    return BASE + "/" + u;
}

function imgUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return IMG_BASE + u;
    return IMG_BASE + "/" + u;
}

// ---------- 接口 ----------

let guestToken = "";

async function httpJson(url, method, token) {
    const headers = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": BASE + "/",
    };
    if (token) headers["Authorization"] = "Bearer " + token;
    let lastError = null;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
        try {
            let resp;
            if (method === "POST") {
                headers["Content-Type"] = "application/json";
                resp = await host.http.post(url, "{}", {headers: headers, timeout: TIMEOUT});
            } else {
                resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            }
            let data = null;
            try {
                data = JSON.parse(resp.body);
            } catch (error) {
                data = null;
            }
            if (resp.status !== 200) {
                const msg = data ? str(data.message || "") : "";
                throw new Error("HTTP " + resp.status + (msg ? " " + msg : ""));
            }
            if (data == null) throw new Error("响应不是 JSON");
            if (data.code != null && data.code !== 0) {
                throw new Error("code " + data.code + " " + str(data.message || ""));
            }
            return data;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("请求失败");
}

function getJson(url, token) {
    return httpJson(url, "GET", token);
}

function postJson(url, token) {
    return httpJson(url, "POST", token);
}

async function guestRegister() {
    if (guestToken) return guestToken;
    const data = await postJson(BASE + "/api/member/auto/register");
    const token = str((data.data || {}).accessToken || "");
    if (!token) throw new Error("自动注册未返回令牌");
    guestToken = token;
    return token;
}

async function checkIn(token) {
    try {
        await postJson(BASE + "/api/member/daily-check-in", token);
    } catch (error) {
        // 与原 py 一致：签到失败忽略
    }
}

// ---------- 数据 ----------

let catsCache = null;
let catsCacheAt = 0;

async function fetchCategories() {
    const now = Date.now();
    if (catsCache && now - catsCacheAt < 3600 * 1000) return catsCache;
    let cats = [];
    try {
        const data = await getJson(BASE + "/api/dramas/categories");
        const items = Array.isArray(data.data) ? data.data : [];
        for (const item of items) {
            if (!item || typeof item !== "object") continue;
            const cid = intValue(item.id, 0);
            const name = str(item.name).trim();
            if (cid !== 0 && name && !isFlagged(name)) {
                cats.push({id: str(cid), name: name});
            }
        }
    } catch (error) {
        cats = [];
    }
    catsCache = cats;
    catsCacheAt = now;
    return cats;
}

async function listDramas(categoryId) {
    let url = BASE + "/api/dramas";
    if (categoryId && categoryId !== "all" && /^\d+$/.test(categoryId)) {
        url += "?categoryId=" + categoryId;
    }
    const data = await getJson(url);
    return Array.isArray(data.data) ? data.data : [];
}

async function fetchDetail(dramaId, token) {
    const data = await getJson(BASE + "/api/dramas/" + encodeURIComponent(dramaId), token);
    return (data && typeof data.data === "object" && data.data) || {};
}

function dramaCard(v) {
    if (!v || typeof v !== "object") return null;
    const did = intValue(v.id, 0);
    if (!did) return null;
    const title = str(v.title).trim();
    if (!title) return null;
    const total = intValue(v.totalEpisodes, 0);
    const views = intValue(v.viewCount, 0);
    let remarks = "";
    if (total > 0 && views > 0) remarks = total + "集 · " + views + "播放";
    else if (total > 0) remarks = total + "集";
    return {
        id: str(did),
        title: title,
        cover: imgUrl(v.coverUrl),
        remarks: remarks,
        duration: "",
        tags: [],
    };
}

function paginate(items, page) {
    const pg = Math.max(1, page);
    const start = (pg - 1) * PAGE_SIZE;
    if (start >= items.length) return {items: [], hasMore: false};
    return {
        items: items.slice(start, start + PAGE_SIZE),
        hasMore: start + PAGE_SIZE < items.length,
    };
}

function episodeTitle(ep) {
    const no = intValue(ep.episodeNo, 0);
    const base = no > 0 ? "第" + no + "集" : (str(ep.title).trim() || "播放");
    const locked = !ep.isUnlocked;
    if (locked) {
        const cost = intValue(ep.unlockPoints, 0);
        if (cost > 0) return base + "（" + cost + "金币）";
        return base + "（未解锁）";
    }
    return base;
}

function findEpisode(detail, episodeId) {
    const eps = Array.isArray(detail.episodes) ? detail.episodes : [];
    for (const ep of eps) {
        if (!ep || typeof ep !== "object") continue;
        if (str(intValue(ep.id, 0)) === str(episodeId)) return ep;
    }
    return null;
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = await fetchCategories();
    let cards = [];
    try {
        const raw = await listDramas("");
        cards = raw.map(dramaCard).filter(Boolean);
    } catch (error) {
        cards = [];
    }
    const page = paginate(cards, 1);
    return {categories: categories, items: page.items, hasMore: page.hasMore};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    const cats = await fetchCategories();
    for (const c of cats) {
        if (c.id === tid && isFlagged(c.name)) return {items: [], hasMore: false};
    }
    let cards = [];
    try {
        const raw = await listDramas(tid);
        cards = raw.map(dramaCard).filter(Boolean);
    } catch (error) {
        cards = [];
    }
    return paginate(cards, page);
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const needle = str(arg && arg.keyword).trim().toLowerCase();
    let cards = [];
    try {
        const raw = await listDramas("");
        for (const v of raw) {
            if (!v || typeof v !== "object") continue;
            if (needle && str(v.title).toLowerCase().indexOf(needle) < 0) continue;
            const card = dramaCard(v);
            if (card) cards.push(card);
        }
    } catch (error) {
        cards = [];
    }
    return paginate(cards, page);
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const nid = raw.replace(/[^\d]/g, "");
    if (!nid) throw new Error("无效的影片 ID");
    const data = await fetchDetail(nid);
    const title = str(data.title).trim();
    if (!title) throw new Error("详情为空");
    const episodes = [];
    const eps = Array.isArray(data.episodes) ? data.episodes : [];
    for (const ep of eps) {
        if (!ep || typeof ep !== "object") continue;
        const eid = intValue(ep.id, 0);
        if (!eid) continue;
        episodes.push({id: nid + ":" + eid, name: episodeTitle(ep)});
    }
    return {
        id: nid,
        title: title,
        cover: imgUrl(data.coverUrl),
        desc: str(data.intro).trim(),
        tags: [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
}

async function play(arg) {
    // episodeId 形如 "<dramaId>:<episodeId>"（detail 里给的）；兼容直接传纯集 id。
    let combined = str((arg && arg.episodeId) || "");
    let dramaId = str((arg && arg.id) || "");
    if (combined.indexOf(":") >= 0) {
        const parts = combined.split(":");
        dramaId = parts[0];
        combined = parts[1];
    } else if (dramaId.indexOf(":") >= 0) {
        const parts = dramaId.split(":");
        dramaId = parts[0];
        combined = parts[1];
    }
    const episodeId = combined || dramaId;
    if (!dramaId || !episodeId) throw new Error("无效的播放 ID");

    const headers = {"User-Agent": UA, "Referer": BASE + "/"};
    let detailData = await fetchDetail(dramaId);
    let ep = findEpisode(detailData, episodeId);
    if (!ep) throw new Error("未找到该集");
    let url = absUrl(ep.videoUrl);
    if (url) return streamResult(url, headers);

    // 锁定集：照原 py 走游客注册 → 签到 → 逐次解锁（令牌靠 Authorization 头，
    // 当前宿主会剥离该头，失败时如实报错，不编造地址）。
    const no = intValue(ep.episodeNo, 0);
    const bound = no > 0 ? no : 1;
    let token;
    try {
        token = await guestRegister();
    } catch (error) {
        throw new Error("该集未解锁且游客注册失败");
    }
    await checkIn(token);
    for (let i = 0; i < bound; i++) {
        try {
            await postJson(BASE + "/api/member/dramas/" + encodeURIComponent(dramaId) + "/unlock", token);
        } catch (error) {
            if (/401|token/i.test(str(error && error.message))) guestToken = "";
            throw new Error("该集未解锁，金币解锁失败：" + str(error && error.message));
        }
        detailData = await fetchDetail(dramaId, token);
        ep = findEpisode(detailData, episodeId);
        if (!ep) throw new Error("未找到该集");
        url = absUrl(ep.videoUrl);
        if (url) return streamResult(url, headers);
    }
    throw new Error("该集未解锁（需金币解锁，宿主剥离 Authorization 头，插件内暂无法解锁）");
}

function streamResult(url, headers) {
    const isHls = /\.m3u8($|\?)/i.test(url);
    let format = "hls";
    if (!isHls) {
        const m = /\.([a-z0-9]+)($|\?)/i.exec(url);
        format = m ? m[1].toLowerCase() : "mp4";
    }
    return {
        streams: [{url: url, format: format, headers: headers, name: "在线播放"}],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
