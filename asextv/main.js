// A色TV — idj1 插件（由内置 py 蜘蛛 asextv 改写）
// 站点：asextv.xyz，服务端渲染 HTML：列表页 <a class="movie-card"> 卡片，
// 详情页 /video/<数字id> 的 HTML 里直接含 https://….m3u8 直链与 JSON 里的 cover。
// 相对原蜘蛛：分类表 1:1 照搬（含原 py 的旗标词过滤规则，命中旗标的分类不输出、
// 进分类也返回空）；播放现取现用（play 每次重拉详情页提取 m3u8）。
// 本机出口单请求常 20–55 秒，超时放宽到 60 秒、重试 2 次。

const BASE = "https://asextv.xyz";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATS = [
    ["1/20", "大奶子·精品推荐"],
    ["1/21", "大奶子·国产主播"],
    ["1/22", "大奶子·国产乱伦"],
    ["1/23", "大奶子·自拍偷拍"],
    ["1/24", "大奶子·制服丝袜"],
    ["1/25", "大奶子·网曝事件"],
    ["1/26", "大奶子·传媒探花"],
    ["1/27", "大奶子·清纯学生"],
    ["1/28", "大奶子·A V 解说"],
    ["1/29", "大奶子·淫妻作乐"],
    ["1/30", "大奶子·港台辣妹"],
    ["1/31", "大奶子·足浴撩妹"],
    ["1/32", "大奶子·反差母狗"],
    ["1/33", "大奶子·A I 换脸"],
    ["1/34", "大奶子·V R 视角"],
    ["1/35", "大奶子·重口性癖"],
    ["1/36", "大奶子·制服诱惑"],
    ["1/37", "大奶子·丝袜美腿"],
    ["1/38", "大奶子·中文字幕"],
    ["1/39", "大奶子·无码流出"],
    ["1/40", "大奶子·多人群交"],
    ["1/41", "大奶子·凌辱快感"],
    ["1/42", "大奶子·角色剧情"],
    ["1/43", "大奶子·强奸乱伦"],
    ["1/44", "大奶子·韩国三级"],
    ["1/45", "大奶子·欧美激情"],
    ["1/46", "大奶子·人妻熟女"],
    ["1/47", "大奶子·主奴调教"],
    ["1/48", "大奶子·动漫卡通"],
    ["1/49", "大奶子·变性伪娘"],
    ["1/50", "大奶子·女同性恋"],
    ["1/51", "大奶子·野外露出"],
    ["2/54", "极品·日韩无码"],
    ["2/55", "极品·国产精品"],
    ["2/57", "极品·日韩精品"],
    ["2/58", "极品·欧美精品"],
    ["2/59", "极品·动漫精品"],
    ["2/60", "极品·自拍偷拍"],
    ["2/61", "极品·伦理影片"],
    ["2/62", "极品·中文字幕"],
    ["2/63", "极品·人妻系列"],
    ["2/64", "极品·制服诱惑"],
    ["2/65", "极品·强奸乱伦"],
    ["2/66", "极品·AV明星"],
    ["2/68", "极品·SM重味"],
    ["2/70", "极品·巨乳系列"],
    ["2/71", "极品·颜射系列"],
    ["2/72", "极品·口交视频"],
    ["2/73", "极品·自慰系列"],
    ["2/74", "极品·教师学生"],
    ["2/75", "极品·大秀视频"],
    ["2/76", "极品·明星换脸"],
    ["2/78", "极品·AV解说"],
    ["2/80", "极品·黑料网曝"],
    ["2/81", "极品·精品探花"],
    ["2/82", "极品·精品网红"],
    ["2/83", "极品·反差母狗"],
    ["2/84", "极品·颜值正义"],
    ["2/85", "极品·熟女少妇"],
    ["2/86", "极品·人兽乱交"],
    ["2/89", "极品·国产传媒"],
    ["2/90", "极品·野战车震"],
    ["2/91", "极品·SM调教"],
    ["2/92", "极品·家庭乱伦"],
    ["2/93", "极品·百合女同"],
    ["2/94", "极品·学生空姐"],
    ["2/95", "极品·撸管必看"],
    ["2/97", "极品·偷情少妇"],
    ["3/21", "红楼·原创乱伦"],
    ["3/22", "红楼·鬼父操女"],
    ["3/23", "红楼·中文字幕"],
    ["3/24", "红楼·制服诱惑"],
    ["3/25", "红楼·嫂子诱惑"],
    ["3/26", "红楼·姐夫小姨子"],
    ["3/27", "红楼·兄弟姐妹"],
    ["3/28", "红楼·风韵岳母"],
    ["3/32", "红楼·吃瓜黑料"],
    ["3/33", "红楼·酒店探花"],
    ["3/34", "红楼·儿媳献穴"],
    ["3/35", "红楼·SM调教"],
    ["3/36", "红楼·师生迷情"],
    ["3/37", "红楼·AI换脸"],
    ["3/38", "红楼·国产主播"],
    ["3/39", "红楼·AV解说"],
    ["3/40", "红楼·家族淫趴"],
    ["3/41", "红楼·淫母兽儿"],
    ["3/42", "红楼·近亲相奸"],
    ["3/59", "红楼·欧美劲爆"],
    ["3/60", "红楼·SM重味"],
    ["3/61", "红楼·伦理影片"],
    ["3/64", "红楼·日韩无码"],
    ["3/65", "红楼·强奸乱伦"],
    ["3/66", "红楼·强奸迷奸"],
    ["3/67", "红楼·野战车震"],
    ["3/68", "红楼·熟女少妇"],
    ["3/69", "红楼·反差母狗"],
    ["3/70", "红楼·巨乳尤物"],
    ["3/71", "红楼·人妻巨乳"],
    ["3/72", "红楼·站长推荐"],
    ["3/73", "红楼·自拍偷拍"],
    ["3/74", "红楼·教师学生"],
    ["3/75", "红楼·3D动漫"],
    ["3/76", "红楼·人妻系列"],
    ["3/77", "红楼·日韩精品"],
    ["3/78", "红楼·撸管必看"],
    ["3/79", "红楼·短视频"],
    ["3/80", "红楼·兄妹姐弟"],
    ["3/81", "红楼·叔嫂乱伦"],
    ["3/82", "红楼·姐夫小姨"],
    ["3/83", "红楼·家庭乱伦"],
    ["3/84", "红楼·母子乱伦"],
    ["3/87", "红楼·母子乱伦"],
    ["3/88", "红楼·母子乱伦"],
    ["3/89", "红楼·母子乱伦"],
    ["3/90", "红楼·国产传媒"],
    ["3/91", "红楼·直播裸聊"],
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
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function unescapeHtml(s) {
    return str(s)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return BASE + u;
    return BASE + "/" + u;
}

async function fetchText(path, referer) {
    const url = path.charAt(0) === "/" ? BASE + path : path;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(url, {
                headers: {
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Referer": referer || (BASE + "/"),
                },
                timeout: TIMEOUT,
            });
            if (resp.status === 200 && resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return "";
}

// 与原 py _parse_cards 同逻辑：按 <a class="movie-card" 切块，
// 取 href="/video/<数字>"、<h3> 标题（缺失时用 img alt）、img src 封面、movie-caption 备注。
function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    const blocks = str(html).split('<a class="movie-card"');
    for (let i = 1; i < blocks.length; i++) {
        let block = blocks[i];
        const next = block.indexOf('<a class="movie-card"');
        if (next >= 0) block = block.slice(0, next);
        const hm = /href="\/video\/(\d+)"/.exec(block);
        if (!hm) continue;
        const vid = hm[1];
        if (seen[vid]) continue;
        seen[vid] = true;
        let title = "";
        const h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block);
        if (h3) title = unescapeHtml(h3[1].replace(/<[^>]+>/g, ""));
        let cover = "";
        const img = /<img [^>]*>/.exec(block);
        if (img) {
            const sm = /src="([^"]+)"/.exec(img[0]);
            if (sm) cover = fixUrl(sm[1]);
            if (!title) {
                const am = /alt="([^"]*)"/.exec(img[0]);
                if (am) title = unescapeHtml(am[1]);
            }
        }
        if (!title) continue;
        if (title.length > 90) title = title.slice(0, 90);
        let remark = "";
        const cap = /movie-caption[^>]*>([\s\S]*?)<\/div>/.exec(block);
        if (cap) {
            const parts = cap[1].split(/<[^>]+>/).map((t) => t.trim()).filter(Boolean);
            remark = unescapeHtml(parts.join(" · "));
        }
        out.push({id: vid, title: title, cover: cover, remarks: remark, duration: "", tags: []});
    }
    return out;
}

function detailCover(html, nid) {
    if (!html || !nid) return "";
    const re = new RegExp('\\\\"id\\\\":\\\\"' + nid + '\\\\"[^}]*?\\\\"cover\\\\":\\\\"(/covers/[^"\\\\]+)\\\\"');
    const m = re.exec(html);
    return m ? fixUrl(m[1]) : "";
}

function extractM3u8(html) {
    if (!html) return "";
    const m = /https:\/\/[^\s"\\]+\.m3u8/.exec(html);
    return m ? m[0] : "";
}

function digitsOf(value) {
    return str(value).replace(/\D/g, "");
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = CATS.filter((c) => !isFlagged(c[1])).map((c) => ({id: c[0], name: c[1]}));
    let items = [];
    try {
        items = parseCards(await fetchText("/"));
    } catch (error) {
        items = [];
    }
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    let tid = str(arg && arg.id).trim();
    for (const c of CATS) {
        if (c[0] === tid && isFlagged(c[1])) return {items: [], hasMore: false};
    }
    if (!tid || tid === "all") tid = "1/20";
    const path = page <= 1 ? "/category/" + tid : "/category/" + tid + "?page=" + page;
    let items = [];
    try {
        items = parseCards(await fetchText(path));
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let items = [];
    try {
        const html = await fetchText("/search?q=" + encodeURIComponent(keyword).replace(/%20/g, "+"));
        items = parseCards(html).slice(0, 60);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const nid = digitsOf(arg && arg.id);
    if (!nid) return {title: "", desc: "", tags: [], lines: []};
    let html = "";
    try {
        html = await fetchText("/video/" + nid);
    } catch (error) {
        html = "";
    }
    let title = "";
    const tm = /<title>([\s\S]*?)<\/title>/.exec(html);
    if (tm) {
        title = unescapeHtml(tm[1]);
        for (const sep of [" - A-SEX-TV", " - A色TV"]) {
            const idx = title.lastIndexOf(sep);
            if (idx >= 0) {
                title = title.slice(0, idx).trim();
                break;
            }
        }
    }
    if (!title) return {title: "", desc: "", tags: [], lines: []};
    return {
        id: nid,
        title: title,
        cover: detailCover(html, nid),
        desc: "",
        tags: [],
        lines: [{name: "在线播放", episodes: [{id: nid, name: "正片"}]}],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("asextv:") >= 0) raw = raw.split("asextv:")[1] || raw;
    if (/^https?:\/\//i.test(raw) && raw.indexOf(".m3u8") >= 0) {
        return {
            streams: [{url: raw, format: "hls", headers: {"User-Agent": UA, "Referer": BASE + "/"}, name: "A色TV"}],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const nid = digitsOf(raw);
    if (!nid) throw new Error("无效的播放 ID");
    const pageUrl = BASE + "/video/" + nid;
    const html = await fetchText("/video/" + nid, pageUrl);
    const url = extractM3u8(html);
    if (!url) throw new Error("详情页未找到 m3u8 直链");
    return {
        streams: [{url: url, format: "hls", headers: {"User-Agent": UA, "Referer": pageUrl}, name: "A色TV"}],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home, category, search, detail, play};
