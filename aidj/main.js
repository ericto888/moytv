// AI短剧AV — idj1 插件（由内置 py 蜘蛛 aidj 改写）
// 站点：aisee10w29.buzz（黄果系模板站）；纯 HTML 解析，无加密接口。
// 播放链：详情页收集 /play/{id}-1-{ep}/ 集数 → 播放页 player_data 取 url/from；
// url 是直链（.m3u8/.mp4）时直接用；url 是 "mid|ep" 且 from=huangguo 时，
// 请求 /huangguo.php?ac=play&id=&ep=（带 X-Requested-With）拿 ac=media 代理地址，
// 该地址直接返回 m3u8 播放列表（AES-128 加密分片，播放器原生可解）。
// 原 py 的 Session/Cookie 不需要：接口无 Cookie 也返回 code=1（实测）。

const BASE = "https://aisee10w29.buzz";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 45000;

const FALLBACK_CATS = [
    ["25", "AI成人短剧"],
    ["26", "AI成人漫剧"],
];

// 与原 py 一致：分类名命中这些词的分类不收录。
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
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
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
    let u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) u = "https:" + u;
    // 图床地址里带双斜杠（media.hgpicimg.cc//upload/...），规整成单斜杠，同一张图更快。
    u = u.replace(/^(https?:\/\/[^/]+)\/\/+/, "$1/");
    if (u.charAt(0) === "/") return BASE + u;
    return u;
}

function stripTags(s) {
    if (!s) return "";
    return unescapeHtml(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// ---------- HTTP ----------

async function fetchText(path, referer, extraHeaders) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": referer || (BASE + "/network/"),
    };
    if (extraHeaders) {
        for (const k of Object.keys(extraHeaders)) headers[k] = extraHeaders[k];
    }
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(BASE + path, {headers: headers, timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status + " " + path);
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
    const cardRe = /<a\s+href="\/detail\/(\d+)\/"[^>]*?class="video-cover"[^>]*?>\s*<img[^>]*?src="([^"]+)"[^>]*?alt="([^"]*)"/gs;
    const titleRe = /<h4 class="video-title">\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/s;
    const viewRe = /<div class="video-view">\s*([\d,]+)\s*浏览/;
    const seen = {};
    let m;
    while ((m = cardRe.exec(html)) !== null) {
        const vid = m[1].trim();
        if (!vid || seen[vid]) continue;
        seen[vid] = true;
        const tail = html.slice(cardRe.lastIndex, cardRe.lastIndex + 2000);
        const tm = titleRe.exec(tail);
        const title = unescapeHtml((tm ? tm[1].trim() : "") || m[3].trim());
        if (!title) continue;
        const vm = viewRe.exec(tail);
        out.push({
            id: vid,
            title: title,
            cover: fixUrl(m[2]),
            remarks: vm ? (vm[1].trim() + "浏览") : "",
            duration: "",
            tags: [],
        });
    }
    return out;
}

let catsCache = null;

function parseCategories(html) {
    let cats = [];
    if (html) {
        const i = html.indexOf("vod-category-menu");
        if (i >= 0) {
            let rest = html.slice(i);
            const end = rest.indexOf("色色本");
            if (end > 0) rest = rest.slice(0, end);
            const pat = /<a href="\/aidj\/(\d+)\/"[^>]*>.*?<\/i>\s*([^<]+?)\s*<\/a>/gs;
            const seen = {};
            let m;
            while ((m = pat.exec(rest)) !== null) {
                const cid = m[1].trim();
                const name = unescapeHtml(m[2].trim());
                if (!name || seen[cid]) continue;
                seen[cid] = true;
                cats.push([cid, name]);
            }
        }
    }
    if (!cats.length) cats = FALLBACK_CATS.slice();
    return cats.filter((c) => !isFlagged(c[1]));
}

async function getCategories(homeHtml) {
    if (catsCache) return catsCache;
    let html = homeHtml || "";
    if (!html) {
        try {
            html = await fetchText("/network/");
        } catch (error) {
            html = "";
        }
    }
    catsCache = parseCategories(html);
    return catsCache;
}

// ---------- idj1 契约 ----------

async function home() {
    let html = "";
    try {
        html = await fetchText("/network/");
    } catch (error) {
        html = "";
    }
    const cats = await getCategories(html);
    const items = parseCards(html);
    return {
        categories: cats.map((c) => ({id: c[0], name: c[1]})),
        items: items,
        hasMore: items.length > 0,
    };
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    if (!tid) return {items: [], hasMore: false};
    const cats = await getCategories("");
    if (!cats.some((c) => c[0] === tid)) return {items: [], hasMore: false};
    const path = page <= 1 ? ("/aidj/" + tid + "/") : ("/aidj/" + tid + "/page/" + page + "/");
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
        html = await fetchText("/search/" + kw + "-------------/");
    } catch (error) {
        html = "";
    }
    // 原 py 搜索不分页（同一地址），如实返回单页结果。
    return {items: parseCards(html), hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const nid = raw.replace(/\D/g, "");
    if (!nid) throw new Error("无效的影片 ID");
    const html = await fetchText("/detail/" + nid + "/");
    const h1 = /<h1[^>]*>(.*?)<\/h1>/s.exec(html);
    const title = h1 ? stripTags(h1[1]) : "";
    if (!title) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    const cm = /<img[^>]*src="([^"]*?\/upload\/huangguo\/[^"]+)"/.exec(html);
    const cover = cm ? fixUrl(cm[1]) : "";
    const dm = /<meta name="description" content="([^"]*)"/.exec(html);
    const desc = dm ? unescapeHtml(dm[1].trim()) : "";
    const epRe = new RegExp('href="/play/' + nid + '-1-(\\d+)/"', "g");
    const epSet = {};
    let em;
    while ((em = epRe.exec(html)) !== null) epSet[em[1]] = true;
    let eps = Object.keys(epSet).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    if (!eps.length) eps = ["1"];
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: desc,
        tags: [],
        lines: [{
            name: "在线播放",
            episodes: eps.map((ep) => ({id: nid + "-1-" + ep, name: "第" + ep + "集"})),
        }],
    };
}

async function play(arg) {
    const rawEp = str((arg && arg.episodeId) || (arg && arg.id));
    let vid = "", sid = "1", ep = "1";
    const parts = rawEp.split("-");
    if (parts.length === 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[2])) {
        vid = parts[0]; sid = parts[1]; ep = parts[2];
    } else if (/^\d+$/.test(rawEp)) {
        vid = rawEp;
    } else {
        throw new Error("无效的播放 ID");
    }
    const playPath = "/play/" + vid + "-" + sid + "-" + ep + "/";
    const pageUrl = BASE + playPath;
    const headers = {"User-Agent": UA, "Referer": pageUrl};
    const html = await fetchText(playPath, pageUrl);
    const um = /player_data=\{.*?"url":"([^"]+)"/s.exec(html);
    const url = um ? um[1].trim() : "";
    const fm = /"from":"([^"]+)"/.exec(html);
    const from = fm ? fm[1].trim() : "";
    if (!url) throw new Error("播放页未找到播放数据");
    if (/\.m3u8($|\?)/i.test(url)) {
        return {streams: [{url: fixUrl(url), format: "hls", headers: headers, name: "在线播放"}], expiresAt: Date.now() + 30 * 60 * 1000};
    }
    if (/\.mp4($|\?)/i.test(url)) {
        return {streams: [{url: fixUrl(url), format: "mp4", headers: headers, name: "在线播放"}], expiresAt: Date.now() + 30 * 60 * 1000};
    }
    if (url.indexOf("|") < 0) throw new Error("未知的播放数据格式");
    const pair = url.split("|");
    const mid = (pair[0] || "").trim();
    const mep = (pair[1] || "").trim();
    if (from !== "huangguo" || !mid || !mep) throw new Error("未知的播放数据格式");
    const apiPath = "/huangguo.php?ac=play&id=" + encodeURIComponent(mid) + "&ep=" + encodeURIComponent(mep);
    const body = await fetchText(apiPath, pageUrl, {"X-Requested-With": "XMLHttpRequest"});
    let data;
    try {
        data = JSON.parse(body);
    } catch (error) {
        throw new Error("播放接口返回异常");
    }
    if (!data || data.code !== 1) throw new Error("播放接口拒绝（code=" + (data && data.code) + "）");
    const proxy = str(data.url).trim();
    if (proxy.indexOf("/hgmedia.php?e=") !== 0 && proxy.indexOf("/huangguo.php?ac=media") !== 0) {
        throw new Error("播放接口返回了未知地址");
    }
    return {
        streams: [{url: BASE + proxy, format: "hls", headers: headers, name: "在线播放"}],
        expiresAt: Date.now() + 30 * 60 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
