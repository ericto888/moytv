// AI小视频·ficeforand — idj1 插件（由内置 py 蜘蛛 ficeforand 改写）
// 站点：https://ficeforand.aicjjc.cc（HTML 站，MacCMS 风格）
// 分类/列表/搜索都是服务端 HTML，正则提取卡片；详情页取标题/封面/简介，
// 播放页 var player_data 给出 "mid|ep" + from=huangguo，再调
// /huangguo.php?ac=play 换取 /hgmedia.php?e=... 的 HLS 代理地址。
//
// 相对原 py 的差异（宿主契约限制）：
// - 原 py 的 huangguo 接口请求只带 UA/Referer/X-Requested-With，不依赖
//   Cookie/Authorization，宿主剥离那 12 个头不影响本插件。
// - 分类与原 py 1:1：首页解析 /aidj/ 链接（已知 slug 映射 c1..c4，
//   未知 slug 按原 py _cats 的默认归 c1；_slug_of 对未知 id 回落到
//   AIchengrenduanju），解析不到时用原 py 的 4 个兜底分类。
//   原 py 无旗标过滤规则，故不加。

const BASE = "https://ficeforand.aicjjc.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 55000;

const FALLBACK_CATS = [
    ["c1", "AI成人短剧", "AIchengrenduanju"],
    ["c2", "AI成人漫剧", "AIchengrenmanju"],
    ["c3", "AI换脸", "AIhuanlian"],
    ["c4", "AI魔改", "AImogai"],
];

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
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
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
    const cats = [];
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
        return FALLBACK_CATS.map((row) => ({id: row[0], name: row[1]}));
    }
    return cats;
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
    const slug = slugOf(str(arg && arg.id));
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
        if (bm) eps = [{no: 1, path: bm[1]}];
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
    if (raw.indexOf("ficeforand:") === 0) raw = raw.slice("ficeforand:".length).trim();
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
    if (pd.url.indexOf("|") < 0 || pd.from !== "huangguo") {
        throw new Error("未知播放来源");
    }
    const seg = pd.url.split("|");
    const mid = seg[0].trim();
    const mep = seg.slice(1).join("|").trim();
    if (!mid || !mep) throw new Error("未知播放来源");
    const api = BASE + "/huangguo.php?ac=play&id=" + encodeURIComponent(mid) +
        "&ep=" + encodeURIComponent(mep);
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
    if (!(proxy.indexOf("/hgmedia.php?e=") === 0 || proxy.indexOf("/huangguo.php?ac=media&t=") === 0)) {
        throw new Error("播放接口无可用地址");
    }
    return {
        streams: [{
            url: BASE + proxy,
            format: "hls",
            headers: header,
            name: "在线播放",
        }],
        expiresAt: Date.now() + 30 * 60 * 1000,
    };
}

export default {home, category, search, detail, play};
