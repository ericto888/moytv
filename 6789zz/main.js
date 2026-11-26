// 6789影视 — idj1 插件（由内置 py 蜘蛛 6789zz.py 改写）
// 站点：https://www.6789zz.com ，纯网页解析（stui 模板），无 Cookie/登录依赖。
// 分类与原 py 1:1 写死 6 类：电视剧2/电影1/综艺3/动漫4/短剧5/国产剧13。
// 列表/详情/搜索/播放提取逻辑逐项照搬原 py（_cards/detailContent/_extract_stream）。
// 本机出口慢：超时 58 秒、每请求最多 3 次尝试（与原 py _fetch 一致）。
// master 播放列表在 play() 内预解析到子列表，避免播放器侧多跳超时。

const BASE = "https://www.6789zz.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    {id: "2", name: "电视剧"},
    {id: "1", name: "电影"},
    {id: "3", name: "综艺"},
    {id: "4", name: "动漫"},
    {id: "5", name: "短剧"},
    {id: "13", name: "国产剧"},
];

const PAN_HOSTS = ["pan.quark.cn", "pan.baidu.com", "pan.xunlei.com", "aliyundrive", "alipan", "115.com", "cloud.189.cn", "pan.189.cn", "drive.uc.cn", "caiyun.139.com", "pan.wo.cn"];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function absUrl(url) {
    url = str(url).trim();
    if (!url) return "";
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.charAt(0) === "/") return BASE + url;
    return url;
}

function clean(text) {
    let t = str(text).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    t = t.replace(/<[^>]+>/g, "");
    t = t.replace(/\s+/g, " ");
    return t.trim();
}

// 与原 py _fetch 一致：3 次尝试，取到含 </html> 即返回，否则取最长的一份。
async function fetchText(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Referer": referer || (BASE + "/"),
        "Accept": "text/html,application/xhtml+xml,*/*",
    };
    let best = "";
    let lastError = null;
    for (let i = 0; i < 3; i++) {
        try {
            const resp = await host.http.request({url: url, headers: headers, timeout: TIMEOUT});
            const text = resp.body || "";
            if (text.length > best.length) best = text;
            if (text.indexOf("</html>") >= 0) return text;
            if (resp.status !== 200) lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (best) return best;
    throw lastError || new Error("请求失败");
}

function parseCards(html) {
    const vods = [];
    const seen = {};
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = liRe.exec(html || "")) !== null) {
        const block = m[1];
        const hm = /href="(\/vod\/\d+\.html)"/.exec(block);
        if (!hm) continue;
        const vid = hm[1].replace(/^\/+|\/+$/g, "");
        if (seen[vid]) continue;
        const tm = /title="([^"]+)"/.exec(block);
        if (!tm) continue;
        let pm = /data-original="([^"]+)"/.exec(block);
        if (!pm) pm = /<img[^>]+src="([^"]+)"/.exec(block);
        const rm = /pic-text[^>]*>([^<]+)</.exec(block);
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

// ---------- 播放地址提取（原 py _extract_stream 逐项照搬） ----------

function extractStream(html) {
    if (!html) return "";
    let m = /var player_aaaa\s*=\s*(\{[\s\S]*?\})/.exec(html);
    if (m) {
        try {
            const data = JSON.parse(m[1]);
            const u = str(data.url || "");
            if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
        } catch (error) {}
    }
    m = /var\s+now\s*=\s*"([^"]+)"/.exec(html);
    if (m && m[1].indexOf("http") === 0) return m[1];
    const urlRe = /"url"\s*:\s*"([^"]+)"/g;
    let cm;
    while ((cm = urlRe.exec(html)) !== null) {
        const cand = cm[1].replace(/\\\//g, "/");
        if (cand.indexOf(".m3u8") >= 0 || cand.indexOf(".mp4") >= 0) return cand;
    }
    m = /player_data\s*=\s*(\{[\s\S]*?\})/.exec(html);
    if (m) {
        try {
            const data = JSON.parse(m[1]);
            const u = str(data.url || "");
            if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
        } catch (error) {}
    }
    const ifRe = /<iframe[^>]+src="([^"]+)"/g;
    let im;
    while ((im = ifRe.exec(html)) !== null) {
        const src = im[1];
        const qi = src.indexOf("?");
        const q = qi >= 0 ? src.slice(qi + 1) : "";
        for (const pair of q.split("&")) {
            const eq = pair.indexOf("=");
            if (eq < 0) continue;
            const k = pair.slice(0, eq);
            const v = pair.slice(eq + 1);
            if (k === "url" || k === "u" || k === "play" || k === "src") {
                let dec = "";
                try {
                    dec = host.codec.base64Decode(v, {to: "utf8"});
                } catch (error) {
                    dec = "";
                }
                if (dec.indexOf("http") === 0 && (dec.indexOf(".m3u8") >= 0 || dec.indexOf(".mp4") >= 0)) return dec;
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

// master 列表预解析：取到 #EXT-X-STREAM-INF 时换成第一个子列表地址。
async function resolveMaster(url, page) {
    try {
        const resp = await host.http.request({
            url: url,
            headers: {"User-Agent": UA, "Referer": page},
            timeout: TIMEOUT,
        });
        const text = resp.body || "";
        if (resp.status !== 200 || text.indexOf("#EXTM3U") < 0) return url;
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s.charAt(0) !== "#");
        if (!lines.length) return url;
        return host.url.resolve(url, lines[0]);
    } catch (error) {
        return url;
    }
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
    return {categories: CATS, items: items, hasMore: false};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    if (!tid) return {items: [], hasMore: false};
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
    return {items: vods, hasMore: total > page};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let vods = [];
    try {
        const url = BASE + "/search/" + encodeURIComponent(keyword) + "-------------.html";
        const html = await fetchText(url);
        vods = parseCards(html);
    } catch (error) {
        vods = [];
    }
    return {items: vods, hasMore: false};
}

async function detail(arg) {
    const vid = str(arg && arg.id).replace(/^\/+|\/+$/g, "");
    if (!vid) throw host.error("E_PARSE", "无效的影片 ID");
    const url = BASE + "/" + vid;
    const html = await fetchText(url);
    let title = vid;
    const tm = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (tm) title = clean(tm[1].replace(/<span[^>]*>[\s\S]*?<\/span>/g, ""));
    let pm = /property="og:image" content="([^"]+)"/.exec(html);
    if (!pm) pm = /data-original="([^"]+)"/.exec(html);
    const pic = pm ? absUrl(pm[1]) : "";
    let dm = /剧情简介<\/h3>[\s\S]{0,400}?<p[^>]*>([^<]{2,})<\/p>/i.exec(html);
    if (!dm) dm = /剧情简介[：:\s]*([^<]{10,})/.exec(html);
    if (!dm) dm = /class="[^"]*detail-content[^"]*"[^>]*>([\s\S]*?)<\//i.exec(html);
    if (!dm) dm = /剧情简介[：:]\s*([\s\S]*?)<\//i.exec(html);
    const desc = dm ? clean(dm[1]) : "";
    let info = "";
    const im = /class="[^"]*(?:stui|myui)-content__detail[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(html);
    if (im) info = clean(im[1]);
    if (!info) {
        let flat = html.replace(/<script[\s\S]*?<\/script>/gi, "");
        flat = flat.replace(/<style[\s\S]*?<\/style>/gi, "");
        flat = flat.replace(/<head[\s\S]*?<\/head>/gi, "");
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
    // 线路 + 分集
    let pairs = [];
    const pairRe = /<h3 class="title">([\s\S]*?)<\/h3>[\s\S]*?<ul class="stui-content__playlist[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi;
    let pr;
    while ((pr = pairRe.exec(html)) !== null) pairs.push([pr[1], pr[2]]);
    if (!pairs.length) {
        const ulRe = /<ul class="stui-content__playlist[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi;
        let ur;
        while ((ur = ulRe.exec(html)) !== null) pairs.push(["", ur[1]]);
    }
    const lines = [];
    for (let idx = 0; idx < pairs.length; idx++) {
        const lname = pairs[idx][0];
        const block = pairs[idx][1];
        const episodes = [];
        const seen = {};
        const aRe = /href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
        let em;
        while ((em = aRe.exec(block)) !== null) {
            const href = em[1].trim();
            let isPan = false;
            for (const d of PAN_HOSTS) {
                if (href.indexOf(d) >= 0) { isPan = true; break; }
            }
            if (isPan) continue;
            if (!href || href.indexOf("javascript") === 0 || seen[href] || href.indexOf("heji") >= 0) continue;
            seen[href] = true;
            const nm = clean(em[2]);
            if (!nm) continue;
            episodes.push({id: absUrl(href), name: nm});
        }
        if (!episodes.length) continue;
        const nm = clean(lname);
        lines.push({name: nm || ("线路" + (idx + 1)), episodes: episodes});
    }
    if (!lines.length) {
        lines.push({name: "线路1", episodes: [{id: url, name: "正片"}]});
    }
    const descParts = [];
    if (desc) descParts.push(desc);
    const meta = [];
    if (year) meta.push("年份：" + year);
    if (area) meta.push("地区：" + area);
    if (director) meta.push("导演：" + director);
    if (actor) meta.push("主演：" + actor);
    if (meta.length) descParts.push(meta.join("\n"));
    return {
        id: vid,
        title: title,
        cover: pic,
        desc: descParts.join("\n"),
        tags: [],
        lines: lines,
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id) || "").trim();
    if (!raw) throw host.error("E_PARSE", "无效的播放 ID");
    const page = raw.indexOf("http") === 0 ? raw : absUrl(raw);
    let url = "";
    if (raw.indexOf(".m3u8") >= 0 || raw.indexOf(".mp4") >= 0) {
        url = raw;
    } else {
        const html = await fetchText(page);
        url = extractStream(html);
        if (!url) {
            const im = /<iframe[^>]+src="([^"]+)"/.exec(html);
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
    if (!url) throw host.error("E_PARSE", "未能从播放页提取播放地址");
    const isHls = /\.m3u8($|\?)/i.test(url);
    if (isHls) url = await resolveMaster(url, page);
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
