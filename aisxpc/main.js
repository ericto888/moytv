// Ai小视频 — idj1 插件（由内置 py 蜘蛛 aisxpc 改写）
// 站点：https://aicjjc.cc（HTML 站，MacCMS 风格）
// 分类/列表/搜索都是服务端 HTML，正则提取卡片；详情页取标题/封面/简介，
// 播放页 var player_data 给出 "mid|ep" + from=huangguo，再调
// /huangguo.php?ac=play 换取 /huangguo.php?ac=media&t=... 的 HLS 地址。
//
// 相对原 py 的差异（宿主契约限制）：
// - 原 py 用会话 Cookie 调 huangguo 接口；宿主会剥离 Cookie 头，
//   实测该接口不带 Cookie 也返回 code=1，故直接无 Cookie 请求。
// - 分类与原 py 1:1：首页解析 /aidj/ 链接，缺的用原 py 的 4 个兜底分类补齐，
//   旗标词过滤规则照搬原 py（分类名命中旗标词即剔除）。

const BASE = "https://aicjjc.cc";
const UA = "Mozilla/5.0 (Linux; Android 14; HarmonyOS; HUAWEI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const TIMEOUT = 55000;

const FALLBACK_CATS = [
    ["c1", "AI成人短剧", "AIchengrenduanju"],
    ["c2", "AI成人漫剧", "AIchengrenmanju"],
    ["c3", "AI换脸", "AIhuanlian"],
    ["c4", "AI魔改", "AImogai"],
];

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

function unescapeHtml(s) {
    if (!s) return "";
    return String(s)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\\\//g, "/");
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return BASE + u;
    return u;
}

function stripTags(s) {
    if (!s) return "";
    return unescapeHtml(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function slugOf(categoryId) {
    const t = str(categoryId).trim();
    for (const row of FALLBACK_CATS) {
        if (t === row[0] || t === row[2]) return row[2];
    }
    return "AIchengrenduanju";
}

// ---------- HTTP ----------

async function fetchText(path, referer) {
    const url = path.indexOf("http") === 0 ? path : BASE + path;
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": referer || (BASE + "/home/"),
    };
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp.status === 200) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return "";
}

// ---------- 解析 ----------

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const cardRe = /<a[^>]*href="\/detail\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/g;
    const seen = {};
    let m;
    while ((m = cardRe.exec(html)) !== null) {
        const vid = m[1].trim();
        if (!vid || seen[vid]) continue;
        seen[vid] = true;
        const body = m[2];
        let title = "";
        const hm = /<h3[^>]*>([^<]+)<\/h3>/.exec(body);
        if (hm) title = hm[1].trim();
        if (!title) {
            const am = /alt="([^"]+)"/.exec(body);
            if (am) title = am[1].trim();
        }
        if (!title) {
            const tm = /title="([^"]+)"/.exec(m[0]);
            if (tm) title = tm[1].trim();
        }
        title = unescapeHtml(title);
        if (!title) continue;
        const im = /<img[^>]*src="([^"]+)"/.exec(body);
        const cover = im ? fixUrl(im[1]) : "";
        const bm = /video-badge">([^<]+)</.exec(body);
        const badge = bm ? bm[1].trim() : "";
        const dm = /(\d{4}-\d{2}-\d{2})/.exec(body);
        const date = dm ? dm[1] : "";
        let remarks = "";
        if (date && badge) remarks = date + " · " + badge;
        else remarks = date || badge;
        out.push({id: vid, title: title, cover: cover, remarks: remarks, duration: "", tags: []});
    }
    return out;
}

function parseCategories(html) {
    let cats = [];
    if (html) {
        const pat = /<a[^>]*href="\/aidj\/([^/]+)\/"[^>]*>([^<]+)<\/a>/g;
        const seen = {};
        let m;
        while ((m = pat.exec(html)) !== null) {
            const slug = m[1].trim();
            const name = unescapeHtml(m[2].trim());
            if (!name || seen[slug]) continue;
            seen[slug] = true;
            let cid = "c1";
            for (const row of FALLBACK_CATS) {
                if (row[2] === slug) { cid = row[0]; break; }
            }
            cats.push({id: cid, name: name});
        }
    }
    if (!cats.length) {
        cats = FALLBACK_CATS.map((row) => ({id: row[0], name: row[1]}));
    } else {
        const have = {};
        for (const c of cats) have[c.id] = true;
        for (const row of FALLBACK_CATS) {
            if (!have[row[0]]) cats.push({id: row[0], name: row[1]});
        }
    }
    return cats.filter((c) => !isFlagged(c.name));
}

function parseEpisodes(playHtml) {
    const eps = [];
    if (!playHtml) return eps;
    const pat = /href="(\/play\/\d+-1-(\d+)\/)"[^>]*>\s*第(\d+)集/g;
    const seen = {};
    let m;
    while ((m = pat.exec(playHtml)) !== null) {
        const path = m[1];
        if (seen[path]) continue;
        seen[path] = true;
        eps.push({no: intValue(m[2], 0), path: path});
    }
    eps.sort((a, b) => a.no - b.no);
    return eps;
}

function parsePlayerData(html) {
    if (!html) return {url: "", from: ""};
    const m = /var player_data=(\{[\s\S]*?\})<\/script>/.exec(html);
    if (!m) return {url: "", from: ""};
    try {
        const data = JSON.parse(m[1]);
        return {url: str(data.url || "").trim(), from: str(data.from || "").trim()};
    } catch (error) {
        return {url: "", from: ""};
    }
}

// ---------- idj1 契约 ----------

async function home() {
    let html = "";
    try {
        html = await fetchText("/home/");
    } catch (error) {
        html = "";
    }
    const categories = parseCategories(html);
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    const slug = slugOf(tid);
    const path = page <= 1 ? "/aidj/" + slug + "/" : "/aidj/" + slug + "/page/" + page + "/";
    let html = "";
    try {
        html = await fetchText(path);
    } catch (error) {
        html = "";
    }
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const kw = encodeURIComponent(keyword).replace(/%20/g, "+");
    let html = "";
    try {
        html = await fetchText("/search/-------------/?wd=" + kw);
    } catch (error) {
        html = "";
    }
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const nid = raw.replace(/\D/g, "");
    if (!nid) throw new Error("无效的影片 ID");
    const html = await fetchText("/detail/" + nid + "/");
    if (!html) throw new Error("详情页获取失败");
    let title = "";
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    if (h1) title = stripTags(h1[1]);
    if (!title) {
        const tt = /<title[^>]*>([\s\S]*?)<\/title>/.exec(html);
        if (tt) {
            title = stripTags(tt[1]);
            for (const suffix of ["在线观看", "剧情介绍"]) {
                const pos = title.indexOf(suffix);
                if (pos >= 0) { title = title.slice(0, pos).trim(); break; }
            }
        }
    }
    if (!title) throw new Error("详情页无标题");
    let cover = "";
    const cm = /<img class="detail-poster"[^>]*src="([^"]+)"/.exec(html);
    if (cm) cover = fixUrl(cm[1]);
    if (!cover) {
        const om = /<meta property="og:image"[^>]*content="([^"]+)"/.exec(html);
        if (om) cover = fixUrl(om[1]);
    }
    const dm = /<div class="detail-desc">([\s\S]*?)<\/div>/.exec(html);
    const synopsis = dm ? stripTags(dm[1]) : "";
    const mm = /<div class="detail-meta">([\s\S]*?)<\/div>/.exec(html);
    const remark = mm ? stripTags(mm[1]) : "";
    const desc = [remark, synopsis].filter(Boolean).join("\n");

    let eps = [];
    try {
        const playHtml = await fetchText("/play/" + nid + "-1-1/");
        eps = parseEpisodes(playHtml);
    } catch (error) {
        eps = [];
    }
    if (!eps.length) {
        const bm = /href="(\/play\/\d+-1-\d+\/)"[^>]*>立即播放/.exec(html);
        if (bm) {
            const pm = /\/play\/(\d+)-1-(\d+)\//.exec(bm[1]);
            if (pm) eps = [{no: intValue(pm[2], 1), path: bm[1]}];
        }
    }
    if (!eps.length) throw new Error("未找到剧集");
    const episodes = eps.map((ep) => {
        const pm = /\/play\/(\d+)-1-(\d+)\//.exec(ep.path);
        const eid = pm ? (pm[1] + "-1-" + pm[2]) : (nid + "-1-" + ep.no);
        return {id: eid, name: "第" + ep.no + "集"};
    });
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: desc,
        tags: [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
}

async function play(arg) {
    const raw0 = str((arg && arg.episodeId) || (arg && arg.id) || "");
    let raw = raw0;
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
    if (raw.indexOf("aisxpc:") === 0) raw = raw.slice("aisxpc:".length).trim();
    if (raw.indexOf("http") === 0) {
        return {
            streams: [{
                url: raw,
                format: /\.m3u8($|\?)/i.test(raw) ? "hls" : "mp4",
                headers: {"User-Agent": UA, "Referer": BASE + "/home/"},
                name: "在线播放",
            }],
            expiresAt: Date.now() + 30 * 60 * 1000,
        };
    }
    const parts = raw.split("-");
    if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[2])) {
        throw new Error("无效的播放 ID");
    }
    const vid = parts[0], sid = parts[1], ep = parts[2];
    const playPage = "/play/" + vid + "-" + sid + "-" + ep + "/";
    const pageUrl = BASE + playPage;
    const html = await fetchText(playPage, pageUrl);
    const pd = parsePlayerData(html);
    const header = {"User-Agent": UA, "Referer": pageUrl};
    if (!pd.url) throw new Error("播放页无 player_data");
    if (/\.m3u8($|\?)/i.test(pd.url) || /\.mp4($|\?)/i.test(pd.url)) {
        return {
            streams: [{
                url: pd.url,
                format: /\.m3u8($|\?)/i.test(pd.url) ? "hls" : "mp4",
                headers: header,
                name: "在线播放",
            }],
            expiresAt: Date.now() + 30 * 60 * 1000,
        };
    }
    if (pd.url.indexOf("|") < 0) throw new Error("未知播放地址格式");
    const seg = pd.url.split("|");
    const mid = seg[0].trim();
    const mep = seg.slice(1).join("|").trim();
    if (pd.from !== "huangguo" || !mid || !mep) throw new Error("未知播放来源");
    const api = BASE + "/huangguo.php?ac=play&id=" + encodeURIComponent(mid) +
        "&ep=" + encodeURIComponent(mep) + "&_=" + Date.now();
    const resp = await host.http.get(api, {
        headers: {
            "User-Agent": UA,
            "Referer": pageUrl,
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout: TIMEOUT,
    });
    if (resp.status !== 200) throw new Error("播放接口 HTTP " + resp.status);
    let data;
    try {
        data = JSON.parse(resp.body);
    } catch (error) {
        throw new Error("播放接口响应不是 JSON");
    }
    if (!data || data.code !== 1) throw new Error("播放接口返回失败");
    const proxy = str(data.url || "").trim();
    let full = "";
    if (proxy.indexOf("/hgmedia.php?e=") === 0 || proxy.indexOf("/huangguo.php?ac=media&t=") === 0) {
        full = BASE + proxy;
    } else if (proxy.indexOf("http") === 0) {
        full = proxy;
    } else {
        throw new Error("播放接口无可用地址");
    }
    return {
        streams: [{
            url: full,
            format: "hls",
            headers: header,
            name: "在线播放",
        }],
        expiresAt: Date.now() + 30 * 60 * 1000,
    };
}

export default {home, category, search, detail, play};
