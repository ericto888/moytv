// 2026短剧AI — idj1 插件（由内置 py 蜘蛛 ai2026 改写）
// 站点：跳转页 2026.2026aidjtz.top 给出 fixedDomain，默认域名 11171224.2026aidj789.lol；
// 页面是服务端渲染 HTML：首页/分类/搜索卡片 <a class="card" href="/shipin/ID">，
// 详情页 /shipin/ID 内有 ep-list 剧集与 data-src 的 m3u8 直链，现取现播。
// 与原 py 一致：取页先按当前域名取，不是站点页（无 /shipin/、window.ZQ、/list/ 特征）
// 就去跳转页解析新域名再重试一次；分类只认已知的 5 个（与站点导航 1:1）。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;
const BASE_DEFAULT = "https://11171224.2026aidj789.lol";
const JUMP = "https://2026.2026aidjtz.top/?yng";

const KNOWN_CATS = [
    ["2427808755", "国产自拍"],
    ["1821390968", "AI短剧"],
    ["4211939055", "日本无码"],
    ["1335262090", "欧美"],
    ["3725810177", "主播"],
];

let curBase = BASE_DEFAULT;
let catsCache = null;
let catsCacheAt = 0;

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

// 对应 py 的 _clean：去掉 <zq-h> 隐藏块与所有标签、解实体、
// 剔除 Cf/Cc 类不可见字符（U+034F 与控制/格式字符），压缩空白。
function clean(s) {
    if (!s) return "";
    s = str(s);
    s = s.replace(/<zq-h[^>]*>[\s\S]*?<\/zq-h>/g, "");
    s = s.replace(/<[^>]+>/g, " ");
    s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    s = s.replace(/[\u0000-\u001F\u007F-\u009F\u034F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "");
    return s.replace(/\s+/g, " ").trim();
}

function headers(referer) {
    const h = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) h["Referer"] = referer;
    return h;
}

// 对应 py 的 _http_get：失败重试（本站响应很慢，重试次数比 py 的 3 次少一次），非 200 返回空。
async function httpGet(url, referer) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(referer), timeout: TIMEOUT});
            if (resp.status !== 200) return "";
            const text = str(resp.body);
            if (text.trim()) return text;
        } catch (error) {
            // 网络错误重试
        }
    }
    return "";
}

function isSitePage(html) {
    if (!html) return false;
    return html.indexOf("/shipin/") >= 0 || html.indexOf("window.ZQ") >= 0 || html.indexOf("/list/") >= 0;
}

async function resolveBase() {
    const raw = await httpGet(JUMP, null);
    if (raw) {
        const m = raw.match(/fixedDomain\s*=\s*"([^"]+)"/);
        if (m && m[1].trim()) return "https://" + m[1].trim();
    }
    return "";
}

// 页面短时缓存：本站单页响应要几十秒，home 的分类与卡片共用主页、
// detail 后紧接着的 play 共用详情页，90 秒内不重复取页（py 无此缓存，是慢站适配）。
const pageCache = new Map();

function cacheGet(path) {
    const hit = pageCache.get(path);
    if (hit && Date.now() - hit.at < 90 * 1000) return hit.html;
    return "";
}

function cachePut(path, html) {
    if (html) pageCache.set(path, {html: html, at: Date.now()});
    if (pageCache.size > 20) pageCache.clear();
}

// 对应 py 的 _fetch：当前域名取页，不是站点页就解析新域名换域名重试。
async function fetchPage(path, referer) {
    const cached = cacheGet(path);
    if (cached) return cached;
    const base = curBase;
    let html = await httpGet(base + path, referer || (base + "/"));
    if (isSitePage(html)) {
        cachePut(path, html);
        return html;
    }
    const newBase = await resolveBase();
    if (newBase && newBase !== base) {
        curBase = newBase;
        html = await httpGet(newBase + path, referer || (newBase + "/"));
        if (isSitePage(html)) {
            cachePut(path, html);
            return html;
        }
    }
    cachePut(path, html);
    return html || "";
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return curBase + u;
    return u;
}

// 对应 py 的 _parse_cards。
function parseCards(html) {
    const out = [];
    if (!html) return out;
    const re = /<a class="card" href="\/shipin\/(\d+)" title="([^"]*)"/g;
    const anchors = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        anchors.push({start: m.index, vid: m[1], title: m[2]});
    }
    const seen = {};
    for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (!a.vid || seen[a.vid]) continue;
        seen[a.vid] = true;
        const end = i + 1 < anchors.length ? anchors[i + 1].start : Math.min(a.start + 3000, html.length);
        const chunk = html.slice(a.start, end);
        const title = clean(a.title);
        if (!title) continue;
        let cover = "";
        const imgRe = /<img[^>]+src="([^"]+)"/g;
        let im;
        const imgs = [];
        while ((im = imgRe.exec(chunk)) !== null) imgs.push(im[1]);
        for (const src of imgs) {
            if (src.indexOf("/upload/vod/") >= 0) { cover = src; break; }
        }
        if (!cover && imgs.length) cover = imgs[0];
        let remark = "";
        const rm = clean(chunk).match(/更新至\s*(\d+)\s*集/);
        if (rm) remark = "更新至" + rm[1] + "集";
        else if (chunk.indexOf("NEW") >= 0) remark = "NEW";
        out.push({id: a.vid, title: title, cover: fixUrl(cover), remarks: remark, duration: "", tags: []});
    }
    return out;
}

// 对应 py 的 _fetch_categories：首页里出现的已知分类（保持 KNOWN_CATS 顺序外
// 按页面出现顺序），一个都没有就用全量已知分类兜底。
async function fetchCategories() {
    const now = Date.now();
    if (catsCache && now - catsCacheAt < 3600 * 1000) return catsCache;
    const known = {};
    for (const pair of KNOWN_CATS) known[pair[0]] = pair[1];
    let cats = [];
    const html = await fetchPage("/");
    if (html) {
        const seen = {};
        const re = /href="\/list\/(\d+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const cid = m[1];
            if (known[cid] && !seen[cid]) {
                seen[cid] = true;
                cats.push({id: cid, name: known[cid]});
            }
        }
    }
    let ttl = 3600 * 1000;
    if (!cats.length) {
        cats = KNOWN_CATS.map((pair) => ({id: pair[0], name: pair[1]}));
        ttl = 300 * 1000;
    }
    catsCache = cats;
    catsCacheAt = now - (3600 * 1000 - ttl);
    return cats;
}

// 对应 py 的 _parse_episodes：ep-list 块里的 /shipin/ID[?j=N] 链接，按集号排序。
// 剧集 id 编码：单集就是视频号，多集是 "视频号?j=N"，play() 按此现取 m3u8。
function parseEpisodes(html) {
    const eps = [];
    if (!html) return eps;
    let blk = "";
    const bm = html.match(/<div class="ep-list">([\s\S]*?)<\/div>/);
    if (bm) blk = bm[1];
    const seen = {};
    const re = /href="\/shipin\/(\d+)(\?j=(\d+))?"[^>]*>([\s\S]*?)<\/a>/g;
    let am;
    while ((am = re.exec(blk)) !== null) {
        const vid = am[1];
        const jnum = am[3] || "";
        let label = clean(am[4]);
        if (!label) label = "第" + (jnum || "1") + "集";
        const key = vid + ":" + (jnum || "1");
        if (seen[key]) continue;
        seen[key] = true;
        if (jnum && jnum !== "1") {
            eps.push({n: parseInt(jnum, 10), id: vid + "?j=" + jnum, name: label});
        } else {
            eps.push({n: 1, id: vid, name: label});
        }
    }
    eps.sort((a, b) => a.n - b.n);
    return eps.map((e) => ({id: e.id, name: e.name}));
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = await fetchCategories();
    const html = await fetchPage("/");
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const tid = str(arg && arg.id);
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const path = pg <= 1 ? "/list/" + tid : "/list/" + tid + "/" + pg;
    const html = await fetchPage(path);
    const items = parseCards(html);
    let pagecount = pg;
    if (html) {
        const re = new RegExp("/list/" + tid + "/(\\d+)", "g");
        let m;
        while ((m = re.exec(html)) !== null) {
            const n = parseInt(m[1], 10);
            if (n > pagecount) pagecount = n;
        }
    }
    return {items: items, hasMore: pagecount > pg && items.length > 0};
}

async function search(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let path = "/seek?wd=" + encodeURIComponent(keyword);
    if (pg > 1) path += "&page=" + pg;
    const html = await fetchPage(path);
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const nid = raw.split("?")[0].replace(/\D/g, "");
    if (!nid) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const html = await fetchPage("/shipin/" + nid);
    if (!html) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    let title = "";
    const hm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (hm) {
        title = clean(hm[1].replace(/<small[^>]*>[\s\S]*?<\/small>/g, ""));
    }
    if (!title) {
        const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/);
        if (tm) {
            title = clean(tm[1]);
            const suf = " - 2026AI短剧";
            if (title.endsWith(suf)) title = title.slice(0, title.length - suf.length).trim();
            title = title.replace(/\s*第\d+集\s*$/, "").trim();
        }
    }
    if (!title) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    let cover = "";
    const om = html.match(/<meta property="og:image"[^>]*content="([^"]+)"/);
    if (om) cover = fixUrl(om[1]);
    if (!cover) {
        const pm = html.match(/<video[^>]*poster="([^"]+)"/);
        if (pm) cover = fixUrl(pm[1]);
    }
    const tags = [];
    const chipRe = /<a class="chip"[^>]*>([\s\S]*?)<\/a>/g;
    let cm;
    while ((cm = chipRe.exec(html)) !== null) {
        const t = clean(cm[1]);
        if (t && tags.indexOf(t) < 0) tags.push(t);
    }
    const plain = clean(html);
    let remark = "";
    const um = plain.match(/更新至\s*(\d+)\s*集/);
    if (um) remark = "更新至" + um[1] + "集";
    const dm = plain.match(/(\d{4}-\d{2}-\d{2})\s*更新/);
    if (dm) remark = (remark + " " + dm[1]).trim();
    let eps = parseEpisodes(html);
    if (!eps.length) eps = [{id: nid, name: "正片"}];
    const parts = [];
    if (tags.length) parts.push("标签：" + tags.join("、"));
    if (remark) parts.push(remark);
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: parts.join("\n"),
        tags: tags,
        lines: [{name: "在线播放", episodes: eps}],
    };
}

// 对应 py 的 playerContent：打开 /shipin/ID[?j=N] 页，取 data-src 的 m3u8，
// 没有再全文正则找 m3u8 直链；请求头带该集页面地址作 Referer。
async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || "";
    if (raw.startsWith("ai2026:")) raw = raw.slice("ai2026:".length).trim();
    if (/^https?:\/\//i.test(raw) && raw.indexOf(".m3u8") >= 0) {
        return {
            streams: [{url: raw, format: "hls", headers: {"User-Agent": UA, "Referer": curBase + "/"}, name: "在线播放"}],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const m = raw.trim().match(/^(\d+)(\?j=(\d+))?$/);
    if (!m) throw new Error("无效的播放 ID");
    let path = "/shipin/" + m[1];
    if (m[3]) path += "?j=" + m[3];
    const pageUrl = curBase + path;
    const html = await fetchPage(path, pageUrl);
    let url = "";
    if (html) {
        const dm = html.match(/data-src="([^"]+\.m3u8[^"]*)"/);
        if (dm) url = clean(dm[1]);
        if (!url) {
            const um = html.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/);
            if (um) url = clean(um[1]);
        }
    }
    if (!url) throw new Error("未找到可用的 m3u8 直链");
    return {
        streams: [{url: url, format: "hls", headers: {"User-Agent": UA, "Referer": pageUrl}, name: "在线播放"}],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
