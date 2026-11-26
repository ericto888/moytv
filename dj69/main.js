// 69短剧 — idj1 插件（由内置 py 蜘蛛 dj69 改写）
// 站点：MacCMS 结构，域名靠跳转链动态下发：入口页给出 MAIN_DOMAIN，
// 再跳一层随机子域拿到第二个域名，随机子域 + 第二域名才是正站。
// 原 py 自带兜底正站 q7w2kx.69dj05.vip，本插件优先验兜底站（同站同内容，
// 省两跳），验不过再走完整跳转链，最后都失败才报错。
// 列表 / 详情 / 播放页都是 HTML 正则提取（与原 py 同一套规则）；
// 播放页 player_aaaa 里的 url 即 m3u8 直链，无加密、无登录、无付费墙。
// 分类与原 py 1:1：优先解析首页导航，并照搬原 py 的旗标词过滤
//（含旗标词的分类名剔除，如站上的「萝莉少女」即被此规则滤掉）；
// 解析不到时回退原 py 的 23 个写死分类。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const ENTRY = "https://agx6p-z9.69djudaq.vip/69d/";
const FALLBACK_BASE = "https://q7w2kx.69dj05.vip";

const CATS = [
    ["6", "AI短剧"], ["7", "家庭短剧"], ["8", "武侠短剧"], ["9", "宫廷短剧"],
    ["10", "都市短剧"], ["11", "仙侠短剧"], ["12", "异能短剧"], ["20", "校园短剧"],
    ["13", "国产黑料"], ["14", "传媒精选"], ["15", "抖阴视频"], ["16", "国产主播"],
    ["21", "网红头条"], ["22", "伦理三级"], ["23", "国产乱伦"], ["24", "明星换脸"],
    ["25", "中文字幕"], ["26", "日本无码"], ["27", "强奸乱伦"], ["28", "制服诱惑"],
    ["30", "AV解说"], ["31", "欧美无码"], ["32", "人妖系列"],
];

const FLAG_WORDS = ["loli", "lolita", "幼女", "幼齿", "初中生", "小学生", "未成年",
    "未满", "萝莉", "童颜", "幼态", "处女", "小萝莉"];

const CARD_RE = /<a href="\/voddetail\/(\d+)\.html">.*?<img src="([^"]+)"[^>]*>.*?<span><text>([^<]+)<\/text><\/span>/gs;
const CAT_RE = /<a[^>]*href="\/vodtype\/(\d+)\.html"[^>]*>(.*?)<\/a>/gs;
const H1_RE = /<h1[^>]*>(.*?)<\/h1>/s;
const COVER_RE = /<img class="detail-cover"[^>]*src="([^"]+)"/;
const SYN_RE = /<meta name="description"[^>]*content="([^"]+)"/;
const EP_RE = /<a[^>]*href="(\/vodplay\/\d+-1-(\d+)\.html)"[^>]*>([^<]*)<\/a>/g;
const PLAYER_RE = /player_aaaa=.*?"url":"([^"]+)"/s;
const DOMAIN_RE = /(?:MAIN_DOMAIN|PRIMARY_DOMAIN)\s*=\s*['"]([^'"]+)['"]/;

let cachedBase = "";
let cachedHomeHtml = "";

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function unescapeHtml(s) {
    let out = str(s);
    if (!out) return "";
    out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)));
    out = out.replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)));
    out = out.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
    return out.replace(/\\\//g, "/").trim();
}

function stripTags(s) {
    return str(s).replace(/<[^>]+>/g, "").trim();
}

function fixUrl(raw, base) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return base + u;
    return u;
}

function flagged(name) {
    const low = str(name).toLowerCase();
    return FLAG_WORDS.some((w) => low.indexOf(w) >= 0);
}

function randSub(n) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < n; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}

// ---------- HTTP ----------

async function getText(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) headers["Referer"] = referer;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
            if (resp.body) return resp.body;
        } catch (error) {
            // 超时 / 网络错误：换连接重试一次
        }
    }
    return "";
}

// ---------- 域名解析（原 py _resolve_base） ----------

function nextDomain(html) {
    const m = DOMAIN_RE.exec(html || "");
    return m ? m[1].trim() : "";
}

async function resolveBase() {
    if (cachedBase) return cachedBase;
    // 先验原 py 自带兜底站：是正站同内容，省去两跳跳转。
    try {
        const fbHome = await getText(FALLBACK_BASE + "/", FALLBACK_BASE + "/");
        if (fbHome && fbHome.indexOf("69短剧") >= 0) {
            cachedBase = FALLBACK_BASE;
            cachedHomeHtml = fbHome;
            return cachedBase;
        }
    } catch (error) {
        // 落到跳转链
    }
    // 完整跳转链：入口 → 一级域名 → 随机子域页 → 二级域名 → 随机子域正站。
    const entry = await getText(ENTRY);
    const d1 = nextDomain(entry);
    if (d1) {
        const hop1 = "https://" + randSub(7) + "." + d1 + "/";
        const h1 = await getText(hop1);
        const d2 = nextDomain(h1);
        if (d2) {
            const cand = "https://" + randSub(6) + "." + d2;
            const home = await getText(cand + "/");
            if (home && home.indexOf("69短剧") >= 0) {
                cachedBase = cand;
                cachedHomeHtml = home;
                return cachedBase;
            }
        }
    }
    cachedBase = FALLBACK_BASE;
    return cachedBase;
}

async function homeHtml() {
    const base = await resolveBase();
    if (cachedHomeHtml) return cachedHomeHtml;
    cachedHomeHtml = await getText(base + "/", base + "/");
    return cachedHomeHtml;
}

// ---------- 解析 ----------

function parseCards(html) {
    const out = [];
    const seen = {};
    if (!html) return out;
    CARD_RE.lastIndex = 0;
    let m;
    while ((m = CARD_RE.exec(html)) !== null) {
        const vid = m[1].trim();
        if (!vid || seen[vid]) continue;
        const title = unescapeHtml(m[3]);
        if (!title) continue;
        seen[vid] = true;
        out.push({
            id: vid,
            title: title,
            cover: unescapeHtml(m[2]),
            remarks: "",
            duration: "",
            tags: [],
        });
    }
    return out;
}

function parseCategories(html) {
    const out = [];
    const seen = {};
    if (!html) return out;
    CAT_RE.lastIndex = 0;
    let m;
    while ((m = CAT_RE.exec(html)) !== null) {
        const cid = m[1];
        const name = stripTags(unescapeHtml(m[2]));
        if (!name || name.indexOf("更多") >= 0 || seen[cid] || flagged(name)) continue;
        seen[cid] = true;
        out.push({id: cid, name: name});
    }
    return out;
}

async function catalog(tid, pg) {
    const base = await resolveBase();
    const url = pg <= 1
        ? base + "/vodtype/" + tid + ".html"
        : base + "/vodtype/" + tid + "-" + pg + ".html";
    return parseCards(await getText(url, base + "/"));
}

// ---------- idj1 契约 ----------

async function home() {
    let categories = parseCategories(await homeHtml());
    if (!categories.length) categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    let items = [];
    if (categories.length) items = await catalog(categories[0].id, 1);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || CATS[0][0];
    const items = await catalog(tid, page);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const base = await resolveBase();
    const q = encodeURIComponent(keyword);
    const html = await getText(base + "/vodsearch/" + q + "-------------.html", base + "/");
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function detail(arg) {
    const id = str(arg && arg.id).trim();
    if (!id) throw new Error("无效的影片 ID");
    const base = await resolveBase();
    const html = await getText(base + "/voddetail/" + id + ".html", base + "/");
    if (!html) return {id: id, title: id, cover: "", desc: "", tags: [], lines: []};
    const tm = H1_RE.exec(html);
    const title = tm ? unescapeHtml(stripTags(tm[1])) : "";
    if (!title) return {id: id, title: id, cover: "", desc: "", tags: [], lines: []};
    const cm = COVER_RE.exec(html);
    const cover = cm ? fixUrl(cm[1], base) : "";
    const sm = SYN_RE.exec(html);
    const desc = sm ? unescapeHtml(sm[1]) : "";
    const episodes = [];
    const seen = {};
    EP_RE.lastIndex = 0;
    let m;
    while ((m = EP_RE.exec(html)) !== null) {
        const path = m[1];
        const k = m[2];
        if (seen[k]) continue;
        seen[k] = true;
        const name = unescapeHtml(m[3]) || ("第" + k + "集");
        episodes.push({id: base + path, name: name});
    }
    if (!episodes.length) {
        episodes.push({id: base + "/vodplay/" + id + "-1-1.html", name: "第1集"});
    }
    return {
        id: id,
        title: title,
        cover: cover,
        desc: desc,
        tags: [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    if (!raw) throw new Error("无效的播放 ID");
    const url = raw.replace(/^dj69:/, "");
    const headers = {"User-Agent": UA, "Referer": url};
    if (url.indexOf(".m3u8") >= 0) {
        return {
            streams: [{url: url, format: "hls", headers: headers, name: "69短剧"}],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const base = await resolveBase();
    const html = await getText(url, base + "/");
    let m3u8 = "";
    if (html) {
        const m = PLAYER_RE.exec(html);
        if (m) m3u8 = unescapeHtml(m[1]);
    }
    if (!m3u8) throw new Error("未找到可用的播放地址");
    const isHls = /\.m3u8($|\?)/i.test(m3u8);
    if (isHls) {
        // 主列表（master）先解析到第一条子列表再返回，播放器少跳一层；
        // 解析失败就原样返回主列表，不影响播放。
        try {
            const pl = await getText(m3u8, url);
            if (pl && pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const lines = pl.split(/\r?\n/).map((s) => s.trim())
                    .filter((s) => s && s.charAt(0) !== "#");
                if (lines.length) m3u8 = host.url.resolve(m3u8, lines[0]);
            }
        } catch (error) {
            // 保留主列表
        }
    }
    return {
        streams: [{
            url: m3u8,
            format: isHls ? "hls" : "video",
            headers: {"User-Agent": UA, "Referer": url},
            name: "69短剧",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
