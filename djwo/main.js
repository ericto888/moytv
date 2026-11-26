// 短剧窝（djwo）— idj1 插件（由内置 py 蜘蛛 djwo.py 改写）
// 站点：https://langwonqyl.forum ，纯 HTML 站：
// 首页 HTML 里带全部分类（/type/id/<id>.html 的 title 属性）与视频卡片；
// 详情页 /info/id/<id>.html；播放页 /play/id/<id>.html 里 var playUrl = '<m3u8>'。
// 与原 py 保持一致：
// - 分类优先从首页动态解析（去重、按 id 升序、旗标词过滤），解析不到才用内置分类表兜底。
// - 旗标词过滤规则照搬原 py 的 _FLAG_WORDS（分类名命中即剔除）。
// - 搜索走 /lookup/<关键词>.html（原 py 不带分页参数，hasMore 恒 false）。
// - play() 每次现取播放页解析 m3u8，不缓存。
// 本机出口下本站单请求约 20-26 秒，故超时放宽到 55 秒、重试 2 次。
// 原 py 不依赖 Cookie/Authorization，宿主剥离这类头无影响。

const BASE = "https://langwonqyl.forum";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 55000;
const RETRIES = 2;

const FLAG_WORDS = ["loli", "lolita", "幼女", "幼齿", "初中生", "小学生", "未成年", "未满", "萝莉", "童颜", "幼态", "处女", "小萝莉"];

// 原 py 内置分类表（首页解析失败时兜底，与 CATS 完全一致）。
const FALLBACK_CATS = [
    ["223", "国产视频"], ["224", "精品推荐"], ["225", "国产色情"], ["226", "中文字幕"],
    ["227", "主播直播"], ["228", "国产传媒"], ["229", "亚洲无码"], ["230", "日本有码"],
    ["231", "亚洲有码"], ["232", "日本无码"], ["233", "中文有码"], ["234", "欧美无码"],
    ["235", "巨乳美乳"], ["236", "强奸乱伦"], ["237", "人妻系列"], ["238", "制服诱惑"],
    ["239", "强奸精品"], ["240", "直播主播"], ["241", "欧美精品"], ["242", "激情动漫"],
    ["244", "明星换脸"], ["245", "伦理三级"], ["246", "抖阴视频"], ["248", "女优明星"],
    ["249", "自拍偷拍"], ["250", "视频一区"], ["251", "制服丝袜"], ["252", "视频二区"],
    ["253", "口交颜射"], ["254", "网-曝-门"], ["255", "日本精品"], ["256", "视频三区"],
    ["257", "Cosplay"], ["258", "伦理三级"], ["259", "素人自拍"], ["260", "AV解说"],
    ["261", "台湾辣妹"], ["262", "SM调教"], ["263", "韩国御姐"], ["265", "唯美港姐"],
    ["267", "东南亚AV"], ["268", "女同性恋"], ["269", "欺辱凌辱"], ["270", "玩偶姐姐"],
    ["271", "剧情介绍"], ["272", "视频四区"], ["273", "多人多P"], ["274", "人妖系列"],
    ["275", "91探花"], ["276", "网红流出"], ["277", "野外露出"], ["278", "古装扮演"],
    ["279", "女优系列"], ["280", "可爱学生"], ["281", "风情旗袍"], ["282", "兽耳系列"],
    ["283", "瑜伽裤"], ["284", "闷骚护士"], ["285", "过膝袜"], ["286", "网曝门"],
    ["287", "传媒出品"], ["288", "女同性恋"], ["289", "男同性恋"], ["290", "恋腿狂魔"],
    ["293", "韩国主播"], ["294", "VR视角"],
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
    return str(s)
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (m, d) => {
            try { return String.fromCharCode(parseInt(d, 10)); } catch (e) { return m; }
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
            try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return m; }
        })
        .replace(/&amp;/gi, "&")
        .trim();
}

function flagged(name) {
    const low = str(name).toLowerCase();
    return FLAG_WORDS.some((w) => low.indexOf(w) >= 0);
}

// ---------- HTTP ----------

async function getHtml(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) headers["Referer"] = referer;
    let lastError = null;
    for (let i = 0; i < RETRIES; i++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp.status === 200 && resp.body && resp.body.trim()) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) host.log("djwo getHtml failed", url, str(lastError && lastError.message));
    return "";
}

// ---------- 解析（正则与原 py 一一对应） ----------

const CARD_RE = /<a href="\/info\/id\/(\d+)\.html"[^>]*>\s*<img[^>]*src="([^"]+)"/g;
const TITLE_RE = /<h3 class="video-title">.*?<text>([^<]+)<\/text>/s;
const CAT_RE = /href="\/type\/id\/(\d+)\.html"[^>]*title="([^"]+)"/g;
const PLAY_RE = /var playUrl\s*=\s*'([^']+\.m3u8[^']*)'/;
const H1_RE = /<h1 class="title">.*?<text>([^<]+)<\/text>/s;
const TITLE_TAG_RE = /<title[^>]*>(.*?)<\/title>/s;
const COVER_RE = /<img[^>]*src="((?:https?:)?\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/i;
const COVER_RE2 = /<img[^>]*src="([^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/i;
const DESC_RE = /<meta name="description" content="([^"]*)"/;

function parseCards(html) {
    const out = [];
    const seen = {};
    if (!html) return out;
    CARD_RE.lastIndex = 0;
    let m;
    while ((m = CARD_RE.exec(html)) !== null) {
        const vid = m[1];
        if (seen[vid]) continue;
        seen[vid] = true;
        const cover = m[2].trim();
        const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 3000);
        const tm = TITLE_RE.exec(tail);
        const title = tm ? unescapeHtml(tm[1]) : "";
        if (!title) continue;
        out.push({id: vid, title: title, cover: cover, remarks: "", duration: "", tags: []});
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
        const name = unescapeHtml(m[2]);
        if (!name || seen[cid] || flagged(name)) continue;
        seen[cid] = true;
        out.push([cid, name]);
    }
    return out;
}

async function loadCategories() {
    const html = await getHtml(BASE, BASE + "/");
    const cats = parseCategories(html);
    if (cats.length) {
        cats.sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
        return {cats: cats, homeHtml: html};
    }
    return {cats: FALLBACK_CATS.slice(), homeHtml: html};
}

function catalogUrl(tid, pg) {
    if (pg <= 1) return BASE + "/type/id/" + tid + ".html";
    return BASE + "/type/id/" + tid + "/" + pg + ".html";
}

async function catalog(tid, pg) {
    const html = await getHtml(catalogUrl(tid, pg), BASE + "/");
    return parseCards(html);
}

function detailId(sid) {
    let s = str(sid).trim().replace(/^\//, "");
    if (s.indexOf("djwo:") === 0) s = s.slice(5);
    if (s.indexOf("info/id/") === 0) s = s.slice(8);
    if (s.slice(-5) === ".html") s = s.slice(0, -5);
    return s.replace(/\/$/, "");
}

// ---------- idj1 契约 ----------

async function home() {
    const loaded = await loadCategories();
    const categories = loaded.cats.map((c) => ({id: c[0], name: c[1]}));
    let items = [];
    if (loaded.cats.length) items = await catalog(loaded.cats[0][0], 1);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    if (!tid) return {items: [], hasMore: false};
    const items = await catalog(tid, page);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/lookup/" + encodeURIComponent(keyword) + ".html";
    const items = parseCards(await getHtml(url, BASE + "/"));
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const nid = detailId(arg && arg.id);
    if (!nid) throw new Error("无效的影片 ID");
    const html = await getHtml(BASE + "/info/id/" + nid + ".html", BASE + "/");
    if (!html) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    let title = "";
    const hm = H1_RE.exec(html);
    if (hm) title = unescapeHtml(hm[1]);
    if (title.slice(-3) === "详情页") title = title.slice(0, -3).trim();
    if (!title) {
        const tm = TITLE_TAG_RE.exec(html);
        title = tm ? unescapeHtml(tm[1]) : "";
        const suffix = "-短剧窝详情页面";
        if (title.slice(-suffix.length) === suffix) title = title.slice(0, -suffix.length).trim();
    }
    if (!title) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    let cover = "";
    const cm = COVER_RE.exec(html) || COVER_RE2.exec(html);
    if (cm) {
        cover = cm[1];
        if (cover.indexOf("//") === 0) cover = "https:" + cover;
    }
    const dm = DESC_RE.exec(html);
    const desc = dm ? unescapeHtml(dm[1]) : "";
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: desc,
        tags: [],
        lines: [{name: "在线播放", episodes: [{id: nid, name: "立即播放"}]}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (!raw) throw new Error("无效的播放 ID");
    let stream = "";
    let referer = BASE + "/";
    if (/^https?:\/\//i.test(raw)) {
        stream = raw;
        referer = stream;
    } else {
        const nid = detailId(raw);
        const html = await getHtml(BASE + "/play/id/" + nid + ".html", BASE + "/");
        const m = html ? PLAY_RE.exec(html) : null;
        if (m) {
            stream = m[1].trim();
            referer = stream;
        }
    }
    if (!stream) throw new Error("未找到可用的 m3u8 直链");
    const isHls = /\.m3u8($|\?)/i.test(stream);
    return {
        streams: [{
            url: stream,
            format: isHls ? "hls" : "mp4",
            headers: {"User-Agent": UA, "Referer": referer},
            name: "在线播放",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
