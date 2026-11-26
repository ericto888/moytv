// 6789影视 — idj1 插件（由内置 py 蜘蛛 6789ysw 改写）
// 站点：https://www.6789ysw.com，纯 HTML 正则提取（与原 py 同一套规则），
// 无登录、无付费墙、无 Cookie 依赖（仅 UA+Referer，宿主不剥）。
// 分类与原 py 1:1 写死：电视剧(2)、电影(1)、综艺(3)、动漫(4)、短剧(5)。
// 详情页按 h3 线路名 + stui-content__playlist 分组，过滤网盘链接与 heji 合集项（照搬原 py）。
// 播放页依次现取：player_aaaa / var now / "url": / player_data / iframe 参数 base64 / 裸 m3u8|mp4 / source / url:'...'，
// 取不到再跟一层 iframe（与原 py 一致）。主列表在 play() 内预解析到子列表，少一跳。
// 本机出口慢：单请求超时 60 秒、失败重试 3 次（与原 py 一致）。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const BASE = "https://www.6789ysw.com";

const CLASSES = [
    {id: "2", name: "电视剧"},
    {id: "1", name: "电影"},
    {id: "3", name: "综艺"},
    {id: "4", name: "动漫"},
    {id: "5", name: "短剧"},
];

const PAN_HOSTS = [
    "pan.quark.cn", "pan.baidu.com", "pan.xunlei.com", "aliyundrive", "alipan",
    "115.com", "cloud.189.cn", "pan.189.cn", "drive.uc.cn", "caiyun.139.com", "pan.wo.cn",
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function clean(text) {
    let out = str(text)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
    out = out.replace(/<[^>]+>/g, "");
    out = out.replace(/\s+/g, " ");
    return out.trim();
}

function absUrl(url) {
    const u = str(url).trim();
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASE + u;
    return u;
}

// ---------- HTTP（与原 py _fetch 一致：3 次尝试、取最长正文、见 </html> 即返回） ----------

async function fetchText(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Referer": referer || (BASE + "/"),
        "Accept": "text/html,application/xhtml+xml,*/*",
    };
    let best = "";
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            const text = resp.body || "";
            if (text.length > best.length) best = text;
            if (text.indexOf("</html>") >= 0) return text;
        } catch (error) {
            // 超时 / 网络错误：换连接重试
        }
    }
    return best;
}

// ---------- 卡片（与原 py _cards 一致） ----------

function parseCards(html) {
    const vods = [];
    if (!html) return vods;
    const seen = {};
    const liRe = /<li[^>]*>(.*?)<\/li>/gs;
    let block;
    while ((block = liRe.exec(html)) !== null) {
        const b = block[1];
        const m = /href="(\/vod\/\d+\.html)"/.exec(b);
        if (!m) continue;
        const vid = m[1].replace(/^\/+|\/+$/g, "");
        if (seen[vid]) continue;
        const tm = /title="([^"]+)"/.exec(b);
        if (!tm) continue;
        let pm = /data-original="([^"]+)"/.exec(b);
        if (!pm) pm = /<img[^>]+src="([^"]+)"/.exec(b);
        const rm = /pic-text[^>]*>([^<]+)</.exec(b);
        let pic = pm ? absUrl(pm[1]) : "";
        if (pic.indexOf("load.gif") >= 0 || pic.indexOf("placeholder") >= 0) pic = "";
        if (!pic) continue;
        seen[vid] = true;
        vods.push({
            id: vid,
            title: clean(tm[1]),
            cover: pic,
            remarks: rm ? clean(rm[1]) : "",
            duration: "",
            tags: [],
        });
    }
    return vods;
}

function pagecount(html, cur) {
    let mx = cur;
    const re = /\/list\/\d+-(\d+)\.html/g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        const n = parseInt(m[1], 10);
        if (isFinite(n) && n > mx) mx = n;
    }
    return mx;
}

// ---------- idj1 契约 ----------

async function home() {
    let items = [];
    try {
        const html = await fetchText(BASE + "/");
        items = parseCards(html).slice(0, 30);
    } catch (error) {
        items = [];
    }
    return {
        categories: CLASSES.map((c) => ({id: c.id, name: c.name})),
        items: items,
        hasMore: items.length > 0,
    };
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    let vods = [];
    let total = page;
    try {
        const html = await fetchText(BASE + "/list/" + tid + "-" + page + ".html");
        vods = parseCards(html);
        total = pagecount(html, page);
    } catch (error) {
        vods = [];
        total = page;
    }
    return {items: vods, hasMore: page < total, page: page, pagecount: total};
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let vods = [];
    try {
        const url = BASE + "/search/-------------.html?wd=" + encodeURIComponent(keyword);
        const html = await fetchText(url);
        vods = parseCards(html);
    } catch (error) {
        vods = [];
    }
    return {items: vods, hasMore: false, page: page};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    const vid = rawId.replace(/^\/+|\/+$/g, "");
    if (!vid) throw new Error("无效的影片 ID");
    const url = BASE + "/" + vid;
    const html = await fetchText(url);
    if (!html) return {id: vid, title: vid, cover: "", desc: "", tags: [], lines: []};

    const tm = /<h1[^>]*>(.*?)<\/h1>/s.exec(html);
    let title = vid;
    if (tm) {
        const inner = tm[1].replace(/<span[^>]*>.*?<\/span>/gs, "");
        title = clean(inner) || vid;
    }
    let pm = /property="og:image" content="([^"]+)"/.exec(html);
    if (!pm) pm = /data-original="([^"]+)"/.exec(html);
    const pic = pm ? absUrl(pm[1]) : "";

    let desc = "";
    let dm = /剧情简介<\/h3>.{0,400}?<p[^>]*>([^<]{2,})<\/p>/s.exec(html);
    if (!dm) dm = /剧情简介[：:\s]*([^<]{10,})/.exec(html);
    if (!dm) dm = /class="[^"]*detail-content[^"]*"[^>]*>(.*?)<\//s.exec(html);
    if (!dm) dm = /剧情简介[：:]\s*(.*?)<\//s.exec(html);
    if (dm) desc = clean(dm[1]);

    let info = "";
    const im = /class="[^"]*(?:stui|myui)-content__detail[^"]*"[^>]*>(.*?)<\/div>\s*<\/div>/s.exec(html);
    if (im) info = clean(im[1]);
    if (!info) {
        let flat = html.replace(/<script.*?<\/script>/gs, "");
        flat = flat.replace(/<style.*?<\/style>/gs, "");
        flat = flat.replace(/<head.*?<\/head>/gs, "");
        info = clean(flat);
    }
    let actor = "";
    const am = /主演[：:]\s*([^导年地类状集]+)/.exec(info);
    if (am) actor = am[1].trim();
    let director = "";
    const dm2 = /导演[：:]\s*([^\s]{1,30})/.exec(info);
    if (dm2) director = dm2[1].trim();
    let year = "";
    let ym = /年份[：:]\s*(19\d{2}|20\d{2})/.exec(info);
    if (!ym) ym = /(19\d{2}|20\d{2})/.exec(info);
    if (ym) year = ym[1];
    let area = "";
    const arm = /地区[：:]\s*([^年主导类型状更\s/]{1,12})/.exec(info);
    if (arm) area = arm[1].trim();

    // 线路：h3 线路名 + playlist ul 配对；无配对时退回裸 ul（与原 py 一致）
    const pairs = [];
    const pairRe = /<h3 class="title">(.*?)<\/h3>.*?<ul class="stui-content__playlist[^"]*"[^>]*>(.*?)<\/ul>/gs;
    let pr;
    while ((pr = pairRe.exec(html)) !== null) pairs.push([pr[1], pr[2]]);
    if (!pairs.length) {
        const ulRe = /<ul class="stui-content__playlist[^"]*"[^>]*>(.*?)<\/ul>/gs;
        let ur;
        while ((ur = ulRe.exec(html)) !== null) pairs.push(["", ur[1]]);
    }
    const lines = [];
    pairs.forEach((pair, idx) => {
        const lname = pair[0];
        const blockHtml = pair[1];
        const episodes = [];
        const seen = {};
        const aRe = /href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
        let em;
        while ((em = aRe.exec(blockHtml)) !== null) {
            const href = em[1].trim();
            if (PAN_HOSTS.some((d) => href.indexOf(d) >= 0)) continue;
            if (!href || href.startsWith("javascript") || seen[href] || href.indexOf("heji") >= 0) continue;
            seen[href] = true;
            const nm = clean(em[2]);
            if (!nm) continue;
            episodes.push({id: absUrl(href), name: nm});
        }
        if (!episodes.length) return;
        const nm = clean(lname);
        lines.push({name: nm || ("线路" + (idx + 1)), episodes: episodes});
    });
    if (!lines.length) {
        lines.push({name: "线路1", episodes: [{id: url, name: "正片"}]});
    }

    return {
        id: vid,
        title: title,
        cover: pic,
        desc: desc,
        year: year,
        area: area,
        remarks: "",
        actor: actor,
        director: director,
        tags: [],
        lines: lines,
    };
}

// ---------- 播放提取（与原 py _extract_stream 一致） ----------

function b64UrlDecode(v) {
    try {
        return host.codec.base64Decode(v, {to: "utf8"});
    } catch (error) {
        return "";
    }
}

function extractStream(html) {
    if (!html) return "";
    let m = /var player_aaaa\s*=\s*(\{.*?\})/s.exec(html);
    if (m) {
        try {
            const data = JSON.parse(m[1]);
            const u = data.url || "";
            if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
        } catch (error) {}
    }
    m = /var\s+now\s*=\s*"([^"]+)"/.exec(html);
    if (m && m[1].startsWith("http")) return m[1];
    const urlRe = /"url"\s*:\s*"([^"]+)"/g;
    let cand;
    while ((cand = urlRe.exec(html)) !== null) {
        const u = cand[1].replace(/\\\//g, "/");
        if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
    }
    m = /player_data\s*=\s*(\{.*?\})/s.exec(html);
    if (m) {
        try {
            const data = JSON.parse(m[1]);
            const u = data.url || "";
            if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
        } catch (error) {}
    }
    const ifRe = /<iframe[^>]+src="([^"]+)"/g;
    let ifr;
    while ((ifr = ifRe.exec(html)) !== null) {
        const src = ifr[1];
        const qi = src.indexOf("?");
        if (qi < 0) continue;
        const parts = src.slice(qi + 1).split("&");
        for (let i = 0; i < parts.length; i++) {
            const eq = parts[i].indexOf("=");
            if (eq < 0) continue;
            const k = parts[i].slice(0, eq);
            const v = parts[i].slice(eq + 1);
            if (k === "url" || k === "u" || k === "play" || k === "src") {
                let dec = b64UrlDecode(v);
                if (!dec || !dec.startsWith("http")) {
                    try {
                        dec = b64UrlDecode(decodeURIComponent(v));
                    } catch (error) {}
                }
                if (dec && dec.startsWith("http") && (dec.indexOf(".m3u8") >= 0 || dec.indexOf(".mp4") >= 0)) return dec;
            }
        }
    }
    const flat = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");
    m = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/.exec(flat);
    if (m) return m[1];
    m = /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/.exec(flat);
    if (m) return m[1];
    m = /<source[^>]+src="([^"]+)"/.exec(html);
    if (m) return absUrl(m[1]);
    m = /url:\s*'([^']+)'/.exec(html);
    if (m && (m[1].indexOf(".m3u8") >= 0 || m[1].indexOf(".mp4") >= 0)) return m[1];
    return "";
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
    const page = raw.startsWith("http") ? raw : absUrl(raw);
    let url = "";
    if (raw.indexOf(".m3u8") >= 0 || raw.indexOf(".mp4") >= 0) {
        url = raw.startsWith("http") ? raw : page;
    } else {
        const html = await fetchText(page);
        url = extractStream(html);
        if (!url) {
            const im = /<iframe[^>]+src="([^"]+)"/.exec(html || "");
            if (im) {
                const src = absUrl(im[1]);
                try {
                    const html2 = await fetchText(src, page);
                    url = extractStream(html2);
                } catch (error) {
                    url = "";
                }
            }
        }
    }
    if (!url) throw new Error("未找到可用的播放地址");
    const isHls = /\.m3u8($|\?)/i.test(url);
    if (isHls) {
        // 主列表先解析到第一条子列表再返回，播放器少跳一层；
        // 解析失败就原样返回主列表，不影响播放。
        try {
            const pl = await fetchText(url, page);
            if (pl && pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const segLines = pl.split(/\r?\n/).map((s) => s.trim())
                    .filter((s) => s && s.charAt(0) !== "#");
                if (segLines.length) url = host.url.resolve(url, segLines[0]);
            }
        } catch (error) {
            // 保留主列表
        }
    }
    return {
        streams: [{
            url: url,
            format: isHls ? "hls" : "video",
            headers: {"User-Agent": UA, "Referer": page},
            name: "6789影视",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
