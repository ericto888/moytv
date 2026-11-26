// 妇愁者联盟 — idj1 插件（由内置 py 蜘蛛 fuchou 改写）
// 原 py 基址 kkb1.sixnicefczlm.cc 现 301 跳转到 kkb2.sixnicefczlm.cc（2026-11-25 实测），
// 插件以 kkb2 为主、kkb1 兜底，探活时按最终跳转 URL 的 origin 自愈域名。
// MacCMS 服务端 HTML：列表卡 dx-card，分类 /index.php/vod/type/id/<id>.html，
// 播放页 player_data 里现取 m3u8 直链（thm3u8.co），带 UA + Referer，无 Cookie/Authorization 依赖。
// 分类与原 py 完全一致：首页动态解析（同原 py 的「查看」/67E5 旗标过滤），失败回退原 py CATS 表。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const BASES = [
    "https://kkb2.sixnicefczlm.cc",
    "https://kkb1.sixnicefczlm.cc",
];
let BASE = BASES[0];
let baseState = {base: "", ts: 0};
let homeBodyCache = "";

// 与原 py CATS 1:1 对应（63 个，原 py 自带表，未删减）。
const CATS = [
    ["1", "热播片库"], ["6", "禁忌母子"], ["7", "兄弟姐妹"], ["8", "爱上嫂子"],
    ["9", "狂操小姨"], ["10", "换夫换妻"], ["11", "淫荡儿媳"], ["12", "爷爷奶奶"],
    ["20", "乱伦精选"], ["2", "精品资源"], ["13", "JK少女"], ["14", "黑丝白丝"],
    ["15", "女仆"], ["16", "cosplay"], ["21", "OL制服"], ["22", "旗袍"],
    ["23", "空姐制服"], ["24", "护士医生"], ["3", "特色仓库"], ["25", "学生少女"],
    ["26", "技师风采"], ["27", "熟女少妇"], ["28", "国产热播"], ["29", "反差母狗"],
    ["30", "美脚丝足"], ["31", "情侣自拍"], ["32", "私房俱乐部"], ["4", "网曝黑料"],
    ["33", "偷情约炮"], ["34", "真实偷拍"], ["35", "高潮喷水"], ["36", "强奸迷奸"],
    ["37", "户外露出"], ["38", "SM调教"], ["39", "情趣内衣"], ["40", "精选探花"],
    ["41", "国产剧情"], ["42", "网曝门事件"], ["43", "校园猛料"], ["44", "网红流出"],
    ["45", "明星黑料"], ["46", "裸贷肉偿"], ["47", "婚闹恶俗"], ["48", "抓奸名场面"],
    ["49", "男同女同"], ["50", "国产传媒"], ["51", "人兽性交"], ["52", "SM性虐"],
    ["53", "人妖伪娘"], ["54", "孕妇内射"], ["55", "吃屎喝尿"], ["56", "扩阴拳交"],
    ["57", "阳具巨物"], ["58", "动漫"], ["59", "必射精选"], ["60", "日本中文"],
    ["61", "无码流出"], ["62", "网红主播"], ["63", "主播网黄"], ["64", "国产AV"],
    ["65", "车震直播"], ["66", "自慰诱惑"], ["67", "欧美重口"],
];

const RE_CARD = /<a class="dx-card" href="\/index\.php\/vod\/play\/id\/(\d+)\/sid\/1\/nid\/1\.html"[^>]*title="([^"]*)"[\s\S]*?<img src="([^"]+)"/g;
const RE_CAT = /<a href="\/index\.php\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)<\/a>/g;
const RE_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/;
const RE_DESC = /<meta name="description"[^>]*content="([^"]+)"/;
const RE_PLAYER = /player_(?:data|aaaa)=[\s\S]*?"url":"([^"]+)"/;

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

// 对应原 py 的 html.unescape + \/ 还原
function unescapeHtml(s) {
    if (!s) return "";
    return str(s)
        .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\\\//g, "/")
        .trim();
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("/") === 0) return BASE + u;
    return u;
}

async function httpGetFull(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
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
            // 本机出口慢，逐个重试，不并行冲
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

async function ensureBase() {
    const now = Date.now();
    if (baseState.base && now - baseState.ts < 600000) {
        BASE = baseState.base;
        return BASE;
    }
    for (const cand of BASES) {
        const r = await httpGetFull(cand + "/", cand + "/");
        if (r.body && (r.body.indexOf("dx-card") >= 0 || r.body.indexOf("/vod/type/id/") >= 0)) {
            const base = originOf(r.url) || cand;
            baseState = {base: base, ts: now};
            BASE = base;
            homeBodyCache = r.body;
            return base;
        }
    }
    baseState = {base: BASES[0], ts: now};
    BASE = BASES[0];
    return BASE;
}

function parseCategories(body) {
    const out = [];
    const seen = {};
    if (!body) return out;
    RE_CAT.lastIndex = 0;
    let m;
    while ((m = RE_CAT.exec(body)) !== null) {
        const cid = m[1];
        const rawName = m[2];
        // 与原 py 一致：原始名含「查看」或实体残片 67E5 的旗标项跳过（先于解码判断）
        if (!rawName || rawName.indexOf("查看") >= 0 || rawName.indexOf("67E5") >= 0 || seen[cid]) continue;
        const name = unescapeHtml(rawName);
        if (!name) continue;
        seen[cid] = true;
        out.push([cid, name]);
    }
    return out;
}

async function getCats() {
    await ensureBase();
    let body = homeBodyCache;
    if (!body) body = await httpGet(BASE + "/", BASE + "/");
    const cats = parseCategories(body);
    return cats.length ? cats : CATS;
}

function parseCards(body) {
    const out = [];
    const seen = {};
    if (!body) return out;
    RE_CARD.lastIndex = 0;
    let m;
    while ((m = RE_CARD.exec(body)) !== null) {
        const vid = m[1];
        if (!vid || seen[vid]) continue;
        const title = unescapeHtml(m[2]);
        if (!title) continue;
        seen[vid] = true;
        out.push({id: vid, title: title, cover: fixUrl(m[3]), remarks: "", tags: []});
    }
    return out;
}

async function catalog(tid, pg) {
    await ensureBase();
    let url;
    if (pg <= 1) url = BASE + "/index.php/vod/type/id/" + tid + ".html";
    else url = BASE + "/index.php/vod/type/id/" + tid + "/page/" + pg + ".html";
    return parseCards(await httpGet(url, BASE + "/"));
}

// ---------- idj1 契约 ----------

async function home() {
    const cats = await getCats();
    const categories = cats.map((c) => ({id: c[0], name: c[1]}));
    let items = [];
    if (cats.length) items = await catalog(cats[0][0], 1);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "1";
    const items = await catalog(tid, pg);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    await ensureBase();
    const url = BASE + "/index.php/vod/search.html?wd=" + encodeURIComponent(keyword);
    const items = parseCards(await httpGet(url, BASE + "/"));
    return {items: items, hasMore: false};
}

async function detail(arg) {
    let nid = str(arg && arg.id).trim().replace(/^\//, "");
    const dm = /(\d+)/.exec(nid);
    if (dm) nid = dm[1];
    if (!nid) throw new Error("无效的影片 ID");
    await ensureBase();
    const playPath = "/index.php/vod/play/id/" + nid + "/sid/1/nid/1.html";
    const body = await httpGet(BASE + playPath, BASE + "/");
    if (!body) throw new Error("详情页拉取失败");
    let title = "";
    const tm = RE_TITLE.exec(body);
    if (tm) title = unescapeHtml(tm[1]);
    const suffix = " - 妇愁者联盟";
    if (title.endsWith(suffix)) title = title.slice(0, title.length - suffix.length);
    if (!title) throw new Error("详情页无标题");
    let synopsis = "";
    const descM = RE_DESC.exec(body);
    if (descM) synopsis = unescapeHtml(descM[1]);
    const epRe = new RegExp("/index\\.php/vod/play/id/" + nid + "/sid/1/nid/(\\d+)\\.html", "g");
    const eps = [];
    const seen = {};
    let em;
    while ((em = epRe.exec(body)) !== null) {
        const n = em[1];
        if (seen[n]) continue;
        seen[n] = true;
        eps.push({
            id: BASE + "/index.php/vod/play/id/" + nid + "/sid/1/nid/" + n + ".html",
            name: "第" + n + "集",
        });
    }
    if (!eps.length) {
        eps.push({id: BASE + playPath, name: "第1集"});
    }
    return {
        id: nid,
        title: title,
        cover: "",
        desc: synopsis,
        tags: [],
        lines: [{name: "在线播放", episodes: eps}],
    };
}

// 若拿到的是 master 列表，预解析到第一条子列表，避免播放端多跳超时；媒体列表原样返回。
async function resolvePlaylist(url, headers) {
    try {
        const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
        if (resp && resp.status === 200 && resp.body && resp.body.indexOf("#EXT-X-STREAM-INF") >= 0) {
            const lines = resp.body.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s.indexOf("#") !== 0);
            if (lines.length) {
                try {
                    return new URL(lines[0], url).href;
                } catch (error) {
                    return url;
                }
            }
        }
    } catch (error) {
        // 预解析失败不拦播放，返回原始地址
    }
    return url;
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("fuchou:") === 0) raw = raw.slice("fuchou:".length);
    await ensureBase();
    const url = fixUrl(raw);
    const headers = {"User-Agent": UA, "Referer": BASE + "/"};
    let m3u8 = "";
    if (url.indexOf("/vod/play/") >= 0) {
        let path = url;
        const idx = url.indexOf("/index.php");
        if (idx >= 0) path = url.slice(idx);
        const body = await httpGet(path.indexOf("/") === 0 ? BASE + path : path, BASE + "/");
        if (body) {
            const m = RE_PLAYER.exec(body);
            if (m) m3u8 = unescapeHtml(m[1]);
        }
    } else if (/^https?:\/\//.test(url) && /\.m3u8($|\?)/.test(url)) {
        m3u8 = url;
    }
    if (!m3u8) throw new Error("未找到可用的 m3u8 直链");
    m3u8 = await resolvePlaylist(m3u8, headers);
    const isHls = /\.m3u8($|\?)/i.test(m3u8);
    return {
        streams: [{
            url: m3u8,
            format: isHls ? "hls" : "video",
            headers: headers,
            name: "在线播放",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
