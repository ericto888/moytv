// 飞快TV — idj1 插件（由内置 py 蜘蛛 feikuai 改写）
// 站点：https://feikuai.in，纯 HTML 正则提取（与原 py 同一套规则），无登录、无付费墙。
// 分类与原 py 1:1：写死 4 个（电影 1 / 剧集 2 / 综艺 3 / 动漫 4），原 py 无额外旗标过滤，照搬不删减。
// 列表/详情/搜索/播放提取顺序全部按原 py：player_aaaa → var now → "url" 候选 →
// player_data → iframe 参数 base64 → 裸 m3u8/mp4 → source → url:'...'。
// 本机出口慢：单请求超时 60 秒、失败重试 3 次（与原 py 一致）。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const BASE = "https://feikuai.in";

const CLASSES = [
    {id: "1", name: "电影"},
    {id: "2", name: "剧集"},
    {id: "3", name: "综艺"},
    {id: "4", name: "动漫"},
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function clean(text) {
    let t = str(text).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    t = t.replace(/<[^>]+>/g, "");
    t = t.replace(/\s+/g, " ");
    return t.trim();
}

function absUrl(url) {
    let u = str(url).trim();
    if (!u) return "";
    if (u.startsWith("//")) u = "https:" + u;
    else if (u.startsWith("/")) u = BASE + u;
    return u;
}

// ---------- HTTP（原 py _fetch：重试 3 次、取最长、见 </html> 即返回） ----------

async function fetchText(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Referer": referer || (BASE + "/"),
        "Accept": "text/html,application/xhtml+xml,*/*",
    };
    let best = "";
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            const text = resp.body || "";
            if (text.length > best.length) best = text;
            if (text.indexOf("</html>") >= 0) return text;
        } catch (e) {
            lastErr = e;
        }
    }
    if (best) return best;
    if (lastErr) throw lastErr;
    return best;
}

async function fetchOnce(url, referer) {
    const headers = {"User-Agent": UA, "Referer": referer || (BASE + "/")};
    const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
    return resp.body || "";
}

// ---------- 列表卡片（原 py _cards） ----------

function parseCards(html) {
    const vods = [];
    const seen = {};
    html = html || "";
    const re = /<a\s[^>]*href="(\/voddetail\/\d+\.html)"[^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const tag = m[0];
        const tm = /title="([^"]+)"/.exec(tag);
        if (!tm) continue;
        const vid = m[1].replace(/^\/+|\/+$/g, "");
        if (seen[vid]) continue;
        let end = html.indexOf("</a>", re.lastIndex);
        if (end < 0) end = re.lastIndex + 1500;
        const win = html.slice(re.lastIndex, Math.min(end, re.lastIndex + 1500));
        let pm = /data-original="([^"]+)"/.exec(win);
        if (!pm) pm = /data-local="([^"]+)"/.exec(win);
        let rm = /module-item-note">([^<]+)</.exec(win);
        if (!rm) rm = /pic-text[^>]*>([^<]+)</.exec(win);
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

function parseSearchCards(html) {
    const vods = [];
    const seen = {};
    const parts = str(html).split("module-card-item module-item");
    for (let i = 1; i < parts.length; i++) {
        const block = parts[i];
        const hm = /href="(\/voddetail\/\d+\.html)"/.exec(block);
        if (!hm) continue;
        const vid = hm[1].replace(/^\/+|\/+$/g, "");
        if (seen[vid]) continue;
        let tm = /<strong>([^<]+)<\/strong>/.exec(block);
        if (!tm) tm = /alt="([^"]+)"/.exec(block);
        const pm = /data-original="([^"]+)"/.exec(block);
        const rm = /module-item-note[^>]*>([^<]+)</.exec(block);
        const pic = pm ? absUrl(pm[1]) : "";
        if (!tm || !pic) continue;
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
    const re = /\/vodtype\/\d+-(\d+)\.html/g;
    let m, mx = 0;
    while ((m = re.exec(html || "")) !== null) {
        const n = parseInt(m[1], 10);
        if (n > mx) mx = n;
    }
    if (mx > 0) return Math.max(mx, cur);
    return cur;
}

// ---------- idj1 契约 ----------

async function home() {
    let items = [];
    try {
        const html = await fetchText(BASE + "/");
        items = parseCards(html).slice(0, 30);
    } catch (e) {
        items = [];
    }
    return {categories: CLASSES, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id);
    let vods = [], total = pg;
    try {
        const url = BASE + "/vodshow/" + tid + "--------" + pg + "---.html";
        const html = await fetchText(url);
        vods = parseCards(html);
        total = pagecount(html, pg);
    } catch (e) {
        vods = [];
        total = pg;
    }
    return {items: vods, hasMore: pg < total && vods.length > 0, page: pg, pagecount: total};
}

async function search(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const key = str(arg && arg.keyword).trim();
    if (!key) return {items: [], hasMore: false};
    let vods = [];
    try {
        const url = BASE + "/vodsearch/-------------.html?wd=" + encodeURIComponent(key);
        const html = await fetchText(url);
        vods = parseSearchCards(html);
    } catch (e) {
        vods = [];
    }
    return {items: vods, hasMore: false};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    const vid = rawId.replace(/^\/+|\/+$/g, "");
    const url = BASE + "/" + vid;
    const html = await fetchText(url);
    if (!html) throw host.error("E_NETWORK", "详情页拉取失败");
    let title = "";
    const tm = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (tm) {
        title = clean(tm[1].replace(/<span[^>]*>[\s\S]*?<\/span>/g, ""));
        if (!title) {
            const am = /alt="([^"]+)"/.exec(tm[1]);
            title = am ? am[1].trim() : "";
        }
    }
    if (!title) {
        const tt = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
        title = tt ? clean(tt[1]).split(" ")[0] : vid;
    }
    let pm = /class="[^"]*fk-vod-poster[^"]*"[^>]*data-original="([^"]+)"/.exec(html);
    if (!pm) pm = /property="og:image" content="([^"]+)"/.exec(html);
    if (!pm) pm = /data-original="([^"]+)"/.exec(html);
    const pic = pm ? absUrl(pm[1]) : "";
    let dm = /module-info-introduction-content[^>]*>\s*<p>([^<]{10,})<\/p>/i.exec(html);
    if (!dm) dm = /剧情简介<\/h3>.{0,400}?<p[^>]*>([^<]{10,})<\/p>/i.exec(html);
    if (!dm) dm = /剧情简介[：:\s]*([^<]{10,})/.exec(html);
    if (!dm) dm = /剧情简介[：:]\s*([\s\S]*?)<\//i.exec(html);
    if (!dm) dm = /class="[^"]*detail-content[^"]*"[^>]*>([\s\S]*?)<\//i.exec(html);
    const desc = dm ? clean(dm[1]) : "";
    let fb = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    fb = fb.replace(/<style[\s\S]*?<\/style>/gi, "");
    fb = fb.replace(/<head[\s\S]*?<\/head>/gi, "");
    const flat = clean(fb);
    let actor = "";
    const am2 = /主演[：:]\s*([^导年地类状集]{1,120})/.exec(flat);
    if (am2) actor = am2[1].trim();
    let director = "";
    const dm2 = /导演[：:]\s*([^\s]{1,30})/.exec(flat);
    if (dm2) director = dm2[1].trim();
    const tt2 = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const ttitle = tt2 ? clean(tt2[1]) : "";
    let year = "";
    const ym = /(19\d{2}|20\d{2})/.exec(ttitle);
    if (ym) year = ym[1];
    let area = "";
    const arm = /(内地|大陆|香港|台湾|美国|韩国|日本|英国|法国|泰国|印度)/.exec(ttitle);
    if (arm) area = arm[1];
    const groups = {};
    const order = [];
    const are = /<a\s([^>]*?)>([\s\S]*?)<\/a>/gi;
    let tagm;
    while ((tagm = are.exec(html)) !== null) {
        const attrs = tagm[1], name = tagm[2];
        if (attrs.indexOf("module-play-list-link") < 0) continue;
        const hm = /href="(\/vodplay\/\d+-(\d+)-\d+\.html)"/.exec(attrs);
        if (!hm) continue;
        const href = hm[1], fid = hm[2];
        let nm = clean(name);
        if (!nm) nm = "正片";
        if (!groups[fid]) {
            groups[fid] = [];
            order.push(fid);
        }
        const item = nm + "$" + absUrl(href);
        if (groups[fid].indexOf(item) < 0) groups[fid].push(item);
    }
    const lines = [];
    for (let idx = 0; idx < order.length; idx++) {
        const fid = order[idx];
        const episodes = groups[fid].map((it) => {
            const p = it.split("$");
            return {id: p[1], name: p[0]};
        });
        lines.push({name: "线路" + (idx + 1), episodes: episodes});
    }
    if (!lines.length) {
        lines.push({name: "线路1", episodes: [{id: url, name: "正片"}]});
    }
    const tags = [];
    if (actor) tags.push.apply(tags, actor.split(/[\s\/、,，]+/).filter(Boolean));
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
        tags: tags,
        lines: lines,
    };
}

// ---------- 播放（原 py _extract_stream，顺序照搬） ----------

function tryJsonObject(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
}

function extractStream(html) {
    if (!html) return "";
    let m = /var player_aaaa\s*=\s*(\{[\s\S]*?\})/.exec(html);
    if (m) {
        const data = tryJsonObject(m[1]);
        if (data) {
            const u = data.url || "";
            if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
        }
    }
    m = /var\s+now\s*=\s*"([^"]+)"/.exec(html);
    if (m && m[1].startsWith("http")) return m[1];
    const urlRe = /"url"\s*:\s*"([^"]+)"/g;
    let cand;
    while ((cand = urlRe.exec(html)) !== null) {
        const c = cand[1].replace(/\\\//g, "/");
        if (c.indexOf(".m3u8") >= 0 || c.indexOf(".mp4") >= 0) return c;
    }
    m = /player_data\s*=\s*(\{[\s\S]*?\})/.exec(html);
    if (m) {
        const data = tryJsonObject(m[1]);
        if (data) {
            const u = data.url || "";
            if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
        }
    }
    const ifRe = /<iframe[^>]+src="([^"]+)"/g;
    let im;
    while ((im = ifRe.exec(html)) !== null) {
        const src = im[1];
        const qi = src.indexOf("?");
        if (qi < 0) continue;
        const pairs = src.slice(qi + 1).split("&");
        for (let i = 0; i < pairs.length; i++) {
            const eq = pairs[i].indexOf("=");
            if (eq < 0) continue;
            const k = pairs[i].slice(0, eq);
            const v = pairs[i].slice(eq + 1);
            if (["url", "u", "play", "src"].indexOf(k) < 0) continue;
            let dec = "";
            try { dec = host.codec.base64Decode(v); } catch (e) { dec = ""; }
            if (dec.startsWith("http") && (dec.indexOf(".m3u8") >= 0 || dec.indexOf(".mp4") >= 0)) return dec;
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
    const raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    const page = raw.startsWith("http") ? raw : absUrl(raw);
    let url = "";
    try {
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
                    } catch (e) {
                        url = "";
                    }
                }
            }
        }
    } catch (e) {
        url = "";
    }
    if (!url) throw host.error("E_PARSE", "播放页未提取到流地址");
    if (url.startsWith("http://")) url = "https://" + url.slice("http://".length);
    const isHls = /\.m3u8($|\?)/i.test(url);
    if (isHls) {
        // master 主清单预解析到第一条子清单，播放器少跳一层；失败原样返回。
        try {
            const pl = await fetchOnce(url, page);
            if (pl && pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const lines = pl.split(/\r?\n/).map((s) => s.trim())
                    .filter((s) => s && s.charAt(0) !== "#");
                if (lines.length) url = host.url.resolve(url, lines[0]);
            }
        } catch (e) {
            // 保留主清单
        }
    }
    return {
        streams: [{
            url: url,
            format: isHls ? "hls" : "video",
            headers: {"User-Agent": UA, "Referer": page},
            name: "飞快TV",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
