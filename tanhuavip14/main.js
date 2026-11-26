// 探花AV — idj1 插件（由内置 py 蜘蛛 tanhuavip14 改写，1:1）
// 站点：https://tanhuavip14.xyz/853（服务端 HTML）
// 分类：首页 HTML 里 /853/vodtype/<id>/ 抠取，只保留原 py FALLBACK_CATS 里有名字的
//   （domestic-media 国产传媒 / japanese-av 日本有码 / chinese-subtitles 中文字幕 /
//    ribenwuma 无码视频），抠不到时用这 4 个兜底——与原 py _fetch_categories 一致。
// 列表卡：<div class="thumbnail group video-card"> 分块，href=/853/vodplay/<slug>，
//   img alt/src 取标题与封面，标题去掉尾巴「 高清在线观看」，封面去掉 ? 后参数。
// 详情：/853/vodplay/<slug>，h1 标题（去「 高清在线播放」）、thumbnailUrl 封面、
//   meta description 简介、genre、actor 名单；播放集 id = tanhuavip14:<slug>。
// 播放：详情页现取 player_aaaa 的 url（或任意 .m3u8 url），master 列表在 play 内
//   预解析到最高码率子列表再返回（原 py _resolve_variant 同款）。
// 搜索：/853/vodsearch/?wd=<关键词>（原 py 不分页，照搬）。
// 全链只带 UA + Referer，不依赖 Cookie/Authorization。

const ORIGIN = "https://tanhuavip14.xyz";
const BASE = ORIGIN + "/853";
const SUBPATH = "/853/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const FALLBACK_CATS = [
    ["domestic-media", "国产传媒"],
    ["japanese-av", "日本有码"],
    ["chinese-subtitles", "中文字幕"],
    ["ribenwuma", "无码视频"],
];
const CAT_NAMES = {};
for (const pair of FALLBACK_CATS) CAT_NAMES[pair[0]] = pair[1];

let catsCache = null;
let catsTs = 0;
let homeBodyCache = "";
let homeBodyTs = 0;

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
    return str(s)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\\\//g, "/");
}

function stripTags(s) {
    if (!s) return "";
    return unescapeHtml(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf(SUBPATH) === 0) return ORIGIN + u;
    if (u.charAt(0) === "/") return BASE + u;
    return u;
}

async function httpGet(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) headers["Referer"] = referer;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp && resp.status === 200 && resp.body) {
                if (resp.body.indexOf("Checking your browser") >= 0) continue;
                return resp.body;
            }
        } catch (error) {
            // 逐个重试，不并行冲
        }
    }
    return "";
}

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const blocks = str(html).split('<div class="thumbnail group video-card">');
    const seen = {};
    for (let i = 1; i < blocks.length; i++) {
        const blk = blocks[i];
        const m = /href="\/853\/vodplay\/([^"]+)"/.exec(blk);
        if (!m) continue;
        const slug = m[1].trim();
        if (!slug || seen[slug]) continue;
        let titleRaw = "";
        let coverRaw = "";
        const im = /<img\s+alt="([^"]+?)"[^>]*\ssrc="([^"]+)"/.exec(blk);
        if (im) {
            titleRaw = im[1];
            coverRaw = im[2];
        } else {
            const im2 = /<img[^>]*src="([^"]+)"[^>]*alt="([^"]+?)"/.exec(blk);
            if (!im2) continue;
            coverRaw = im2[1];
            titleRaw = im2[2];
        }
        let title = unescapeHtml(titleRaw.trim());
        const suffix = " 高清在线观看";
        if (title.endsWith(suffix)) title = title.slice(0, title.length - suffix.length);
        title = title.trim();
        if (!title) continue;
        seen[slug] = true;
        out.push({
            id: slug,
            title: title,
            cover: fixUrl(coverRaw).split("?")[0],
            remarks: "",
            tags: [],
        });
    }
    return out;
}

async function fetchCategories() {
    const now = Date.now();
    if (catsCache && now - catsTs < 3600000) return catsCache;
    let cats = [];
    const html = await httpGet(BASE + "/", BASE + "/");
    if (html) {
        // 首页正文顺手缓存，home() 3 分钟内复用，少打一次慢请求
        homeBodyCache = html;
        homeBodyTs = Date.now();
        const re = /href="\/853\/vodtype\/([a-z-]+)\/"/g;
        const seen = {};
        const order = [];
        let m;
        while ((m = re.exec(html)) !== null) {
            const cid = m[1].trim();
            if (cid && !seen[cid]) {
                seen[cid] = true;
                order.push(cid);
            }
        }
        cats = order.filter((cid) => CAT_NAMES[cid]).map((cid) => [cid, CAT_NAMES[cid]]);
    }
    let ttl = 3600000;
    if (!cats.length) {
        cats = FALLBACK_CATS.slice();
        ttl = 300000;
    }
    catsCache = cats;
    catsTs = Date.now() - (3600000 - ttl);
    return cats;
}

function parsePlayerUrl(html) {
    if (!html) return "";
    let m = /player_aaaa=[\s\S]*?"url":"([^"]+)"/.exec(html);
    if (m) return unescapeHtml(m[1]);
    m = /"url":"(https?:\/\/[^"]+\.m3u8[^"]*)"/.exec(html);
    if (m) return unescapeHtml(m[1]);
    return "";
}

// 相对地址拼接（不依赖 URL 全局量，沙箱里不一定有）。
function resolveUrl(base, rel) {
    const r = str(rel).trim();
    if (!r) return base;
    if (/^https?:\/\//i.test(r)) return r;
    const bm = /^(https?:\/\/[^/?#]+)([^?#]*)/.exec(str(base));
    if (!bm) return r;
    const origin = bm[1];
    if (r.indexOf("//") === 0) return "https:" + r;
    if (r.charAt(0) === "/") return origin + r;
    if (r.charAt(0) === "?" || r.charAt(0) === "#") return base + r;
    let path = bm[2] || "/";
    path = path.slice(0, path.lastIndexOf("/") + 1);
    let relPath = r;
    while (relPath.indexOf("../") === 0) {
        relPath = relPath.slice(3);
        path = path.replace(/[^/]+\/$/, "");
    }
    if (relPath.indexOf("./") === 0) relPath = relPath.slice(2);
    return origin + path + relPath;
}

// master 播放列表预解析到最高码率子列表（原 py _resolve_variant）。
async function resolveVariant(masterUrl) {
    if (!masterUrl || masterUrl.indexOf(".m3u8") < 0) return masterUrl;
    const txt = await httpGet(masterUrl, BASE + "/");
    if (!txt || txt.indexOf("#EXT-X-STREAM-INF") < 0) return masterUrl;
    let best = null;
    let bestBw = -1;
    const lines = txt.split(/\r?\n/).map((s) => s.trim());
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (ln.indexOf("#EXT-X-STREAM-INF") === 0) {
            let bw = 0;
            const m = /BANDWIDTH=(\d+)/.exec(ln);
            if (m) bw = intValue(m[1], 0);
            if (i + 1 < lines.length) {
                const uri = lines[i + 1];
                if (uri && uri.charAt(0) !== "#") {
                    if (bw >= bestBw) {
                        bestBw = bw;
                        best = uri;
                    }
                }
            }
        }
    }
    if (best) return resolveUrl(masterUrl, best);
    return masterUrl;
}

function normSlug(raw) {
    let slug = str(raw);
    if (slug.indexOf("$") >= 0) slug = slug.split("$")[1] || "";
    if (slug.indexOf("tanhuavip14:") === 0) slug = slug.slice("tanhuavip14:".length);
    if (slug.indexOf("vodplay/") === 0) slug = slug.slice("vodplay/".length);
    return slug.replace(/^\/+|\/+$/g, "").trim();
}

async function fetchDetail(slug) {
    const d = {title: "", cover: "", synopsis: "", genre: "", actor: "", html: ""};
    const html = await httpGet(BASE + "/vodplay/" + slug, BASE + "/");
    if (!html) return d;
    d.html = html;
    let m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    if (m) {
        let t = stripTags(m[1]);
        const suffix = " 高清在线播放";
        if (t.endsWith(suffix)) t = t.slice(0, t.length - suffix.length);
        d.title = t.trim();
    }
    if (!d.title) {
        m = /"name":\s*"([^"]+)"/.exec(html);
        if (m) d.title = unescapeHtml(m[1].trim());
    }
    m = /"thumbnailUrl":\s*"([^"]+)"/.exec(html);
    if (m) d.cover = fixUrl(m[1]);
    m = /<meta name="description"[^>]*content="([^"]+)"/.exec(html);
    if (m) d.synopsis = unescapeHtml(m[1].trim());
    m = /"genre":\s*"([^"]+)"/.exec(html);
    if (m) d.genre = unescapeHtml(m[1].trim());
    m = /"actor":\s*\[([\s\S]*?)\]/.exec(html);
    if (m) {
        const names = [];
        const re = /"name":\s*"([^"]+)"/g;
        let nm;
        while ((nm = re.exec(m[1])) !== null) {
            const n = unescapeHtml(nm[1].trim());
            if (n) names.push(n);
        }
        d.actor = names.join(",");
    }
    return d;
}

// ---------- idj1 契约 ----------

async function home() {
    const cats = await fetchCategories();
    const categories = cats.map((pair) => ({id: pair[0], name: pair[1]}));
    let html = "";
    if (homeBodyCache && Date.now() - homeBodyTs < 180000) {
        html = homeBodyCache;
    } else {
        html = await httpGet(BASE + "/", BASE + "/");
    }
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    let tid = str(arg && arg.id).trim();
    if (!tid || tid === "all") tid = "domestic-media";
    const path = pg <= 1 ? "/vodtype/" + tid + "/" : "/vodtype/" + tid + "-" + pg + "/";
    const html = await httpGet(BASE + path, BASE + "/");
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const html = await httpGet(BASE + "/vodsearch/?wd=" + encodeURIComponent(keyword), BASE + "/");
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const slug = normSlug(arg && arg.id);
    if (!slug) throw new Error("无效的影片 ID");
    const d = await fetchDetail(slug);
    if (!d.title) throw new Error("详情页未取到标题");
    const tags = d.genre ? [d.genre] : [];
    const lines = [{name: "在线播放", episodes: [{id: "tanhuavip14:" + slug, name: "播放"}]}];
    return {
        id: slug,
        title: d.title,
        cover: d.cover,
        desc: d.synopsis,
        actor: d.actor,
        remarks: d.genre,
        tags: tags,
        lines: lines,
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    const headers = {"User-Agent": UA, "Referer": BASE + "/"};
    if (raw.indexOf("http") === 0 && raw.indexOf(".m3u8") >= 0) {
        const direct = await resolveVariant(raw);
        return {streams: [{url: direct, format: "hls", headers: headers, name: "在线播放"}], expiresAt: Date.now() + 3600 * 1000};
    }
    const slug = normSlug(raw);
    if (!slug) throw new Error("无效的播放 ID");
    const html = await httpGet(BASE + "/vodplay/" + slug, BASE + "/");
    let url = parsePlayerUrl(html);
    if (!url) throw new Error("未找到可用的播放地址");
    url = await resolveVariant(url);
    const isHls = url.indexOf(".m3u8") >= 0;
    return {
        streams: [{url: url, format: isHls ? "hls" : "video", headers: headers, name: "在线播放"}],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
