// 幻影AI — idj1 插件（2026-11-25 由海阔规则 🔞幻影AI 移植，皇帝影院版 v2）
// 站点：https://mfantasy.net（AI 短剧站，接口驱动，无登录墙）
// 接口：
//   列表 GET /api/dramas（全量 317 部）/ GET /api/dramas?categoryId=<id>
//   详情 GET /api/dramas/<id> → data.episodes[]（episodeNo/isUnlocked/videoUrl）
//   封面 https://img.mfantasy.net + coverUrl 相对路径
//   播放 videoUrl 为 /api/media/<hash>/index.m3u8（主清单→多档 variant→AES-128 分片，
//        分片在 vod.mfantasy.net，2026-11-25 本机出口实测全链 200）
// 免费部分：每部仅已解锁集可播（站方规则：第 1 集免费，其余集要积分解锁），
//   detail 只把已解锁集放进线路，desc 里写明已解锁/总集数。
// 分类与站导航 1:1（规则 class_name/class_url 原样）：
//   二次元区68/特殊趣味17/域外传奇13/特殊口味12/校园记忆11/家庭伦理10/
//   异能穿越9/现代惊悚6/AI演示5/经典动漫4/经典魔改3/都市爱情2/古装玄幻1

const SITE = "https://mfantasy.net";
const MEDIA = "https://img.mfantasy.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATEGORIES = [
    {id: "68", name: "二次元区"},
    {id: "17", name: "特殊趣味"},
    {id: "13", name: "域外传奇"},
    {id: "12", name: "特殊口味"},
    {id: "11", name: "校园记忆"},
    {id: "10", name: "家庭伦理"},
    {id: "9", name: "异能穿越"},
    {id: "6", name: "现代惊悚"},
    {id: "5", name: "AI演示"},
    {id: "4", name: "经典动漫"},
    {id: "3", name: "经典魔改"},
    {id: "2", name: "都市爱情"},
    {id: "1", name: "古装玄幻"},
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function mediaUrl(u) {
    const value = str(u).trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.indexOf("/api/") === 0) return SITE + value;
    if (value.indexOf("/") === 0) return MEDIA + value;
    return MEDIA + "/" + value;
}

function absSite(u) {
    const value = str(u).trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.indexOf("/") === 0) return SITE + value;
    return SITE + "/" + value;
}

async function fetchJson(url) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.request({
                url: url,
                method: "GET",
                headers: {
                    "User-Agent": UA,
                    "Referer": SITE + "/",
                    "Accept": "application/json,text/html,*/*",
                },
                timeout: TIMEOUT,
            });
            if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
            const text = resp.body == null ? "" : String(resp.body);
            const json = JSON.parse(text);
            if (!json || json.code !== 0) throw new Error("接口返回异常");
            return json;
        } catch (error) {
            lastErr = error;
        }
    }
    throw lastErr || new Error("请求失败");
}

function toItem(d) {
    const total = parseInt(d.totalEpisodes, 10) || 0;
    return {
        id: str(d.id),
        title: str(d.title || ""),
        cover: mediaUrl(d.coverUrl),
        remarks: total ? "共" + total + "集" : "",
        tags: d.categoryName ? [str(d.categoryName)] : [],
    };
}

function toItems(list) {
    const items = [];
    const seen = {};
    for (const d of list || []) {
        if (!d || d.id == null || seen[d.id]) continue;
        if (!str(d.title)) continue;
        seen[d.id] = true;
        items.push(toItem(d));
    }
    return items;
}

// ---------- idj1 契约 ----------

async function home() {
    let items = [];
    try {
        const json = await fetchJson(SITE + "/api/dramas");
        const list = Array.isArray(json.data) ? json.data : [];
        const car = [], hot = [], plat = [];
        for (const d of list) {
            if (d.isCarousel) car.push(d);
            if (d.isHot) hot.push(d);
            if (d.sourceType === "platform") plat.push(d);
        }
        hot.sort((a, b) => (a.hotRank || 0) - (b.hotRank || 0));
        plat.sort((a, b) => {
            const ta = str(a.latestEpisodeAt || a.createdAt || "");
            const tb = str(b.latestEpisodeAt || b.createdAt || "");
            return tb < ta ? -1 : (tb > ta ? 1 : 0);
        });
        items = toItems(car.concat(hot, plat)).slice(0, 48);
        if (!items.length) items = toItems(list).slice(0, 48);
    } catch (error) {
        items = [];
    }
    return {categories: CATEGORIES, items: items, hasMore: false};
}

async function category(arg) {
    const page = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const tid = str(arg && arg.id);
    if (!tid || page > 1) return {items: [], hasMore: false};
    let items = [];
    try {
        const json = await fetchJson(SITE + "/api/dramas?categoryId=" + encodeURIComponent(tid));
        items = toItems(Array.isArray(json.data) ? json.data : []);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: false};
}

async function search(arg) {
    const page = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword || page > 1) return {items: [], hasMore: false};
    let items = [];
    try {
        const json = await fetchJson(SITE + "/api/dramas");
        const list = Array.isArray(json.data) ? json.data : [];
        const kl = keyword.toLowerCase();
        items = toItems(list.filter((d) => str(d.title).toLowerCase().indexOf(kl) >= 0)).slice(0, 40);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const rawId = str(arg && arg.id).replace(/[^0-9]/g, "");
    if (!rawId) throw new Error("无效的影片 ID");
    const json = await fetchJson(SITE + "/api/dramas/" + rawId);
    const d = json.data;
    if (!d) throw new Error("详情为空");
    const eps = (Array.isArray(d.episodes) ? d.episodes.slice() : [])
        .sort((a, b) => (a.episodeNo || 0) - (b.episodeNo || 0));
    const unlocked = eps.filter((e) => e.isUnlocked && e.videoUrl);
    const episodes = unlocked.map((e) => ({
        id: rawId + "|" + e.episodeNo,
        name: "第" + e.episodeNo + "集",
    }));
    const total = parseInt(d.totalEpisodes, 10) || eps.length;
    let desc = str(d.intro || d.shareDesc || "").trim();
    const state = "共" + total + "集 · 已解锁" + unlocked.length + "/" + total + "集 · " + (parseInt(d.viewCount, 10) || 0) + "次播放";
    desc = desc ? state + "\n" + desc : state;
    const lines = episodes.length ? [{name: "在线播放", episodes: episodes}] : [];
    return {
        id: rawId,
        title: str(d.title || rawId),
        cover: mediaUrl(d.coverUrl),
        desc: desc,
        tags: d.categoryName ? [str(d.categoryName)] : [],
        lines: lines,
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id) || "");
    const parts = raw.split("|");
    if (parts.length < 2) throw new Error("无效的播放地址");
    const did = parts[0].replace(/[^0-9]/g, "");
    const epNo = parseInt(parts[1].replace(/[^0-9]/g, ""), 10);
    if (!did || !isFinite(epNo)) throw new Error("无效的播放地址");
    const json = await fetchJson(SITE + "/api/dramas/" + did);
    const d = json.data;
    if (!d || !Array.isArray(d.episodes)) throw new Error("解析失败");
    let hit = null;
    for (const e of d.episodes) {
        if (e.episodeNo === epNo) { hit = e; break; }
    }
    if (!hit || !hit.isUnlocked || !hit.videoUrl) throw new Error("该集未解锁");
    const url = absSite(hit.videoUrl);
    if (!url) throw new Error("解析失败");
    return {
        streams: [{
            url: url,
            format: /\.m3u8($|\?)/i.test(url) ? "hls" : "mp4",
            headers: {"User-Agent": UA, "Referer": SITE + "/"},
            name: "幻影AI",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
