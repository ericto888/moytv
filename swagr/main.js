// SWAG resource collection - idj1 plugin (rewritten from built-in py spider swagr)
// Site: http://zi.ri511.xyz - server-rendered HTML.
// Categories: 3 tabs (hot/latest/rec) parsed from the home tab sections,
// plus streamer categories scraped live from /category, with the py
// fallback streamer list when the scrape returns nothing.
// Detail page embeds a trailer mp4 in <video src="...">; play returns it
// directly (parse=0 in the py original). If a stream URL is an m3u8 master
// playlist, play resolves it to the first variant playlist first.

const BASE = "http://zi.ri511.xyz";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const TABS = [["hot", "热门"], ["latest", "最新"], ["rec", "推荐"]];

const FALLBACK_STREAMERS = [
    ["135", "琳琳"], ["123", "小媛"], ["32", "愛子"], ["167", "吴夢夢"],
    ["194", "princessdolly"], ["107", "灣灣"], ["52", "chinh"], ["161", "Mio"],
    ["169", "沐沐"], ["85", "菲菲"], ["46", "candybaby"], ["89", "funnyg"],
    ["3", "貝拉"], ["241", "aprillady"], ["149", "芊芊"], ["132", "黎兒"],
    ["239", "娃娃"], ["160", "minicat"],
];

const RE_CARD = /<a href="\/category\/(\d+)\/(\d+)">[\s\S]*?<img[^>]*alt="([^"]*)"[^>]*data-src="([^"]+)"/g;
const RE_STREAMER = /<a href="\/category\/(\d+)">([^<]{1,30})<\/a>/g;
const RE_DUR = /fa-clock-o"><\/i>\s*([^<\s]+)/;

const pageCache = {};
const PAGE_TTL = 120000;
let catsCache = null;
let catsTs = 0;

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function unescapeHtml(s) {
    if (!s) return "";
    return str(s)
        .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/\\\//g, "/");
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return BASE + u;
    return u;
}

function titleFromAlt(alt) {
    const t = unescapeHtml(str(alt).trim());
    const pos = t.indexOf("-swag-");
    if (pos >= 0) {
        const rest = t.slice(pos + 6).trim();
        if (rest) return rest;
    }
    return t;
}

async function httpGet(url) {
    const headers = {
        "User-Agent": UA,
        "Referer": BASE,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp && resp.status === 200 && resp.body && resp.body.trim()) return resp.body;
            if (resp && resp.body && resp.body.trim() && attempt === 2) return resp.body;
        } catch (error) {
            // retry sequentially, matching the py original (3 attempts)
        }
    }
    return "";
}

async function page(url) {
    const hit = pageCache[url];
    if (hit && Date.now() - hit[0] < PAGE_TTL) return hit[1];
    const body = await httpGet(url);
    if (body) {
        if (Object.keys(pageCache).length > 60) {
            for (const k of Object.keys(pageCache)) delete pageCache[k];
        }
        pageCache[url] = [Date.now(), body];
    }
    return body;
}

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    RE_CARD.lastIndex = 0;
    let m;
    while ((m = RE_CARD.exec(html)) !== null) {
        const key = m[1] + "/" + m[2];
        if (seen[key]) continue;
        seen[key] = true;
        const title = titleFromAlt(m[3]);
        if (!title) continue;
        const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 800);
        const dm = RE_DUR.exec(tail);
        out.push({id: key, title: title, cover: fixUrl(m[4]), remarks: dm ? dm[1].trim() : "", tags: []});
    }
    return out;
}

function tabSections(html) {
    const m = /<dl class="tab-bd">([\s\S]*?)<\/dl>/.exec(html || "");
    if (!m) return [];
    const out = [];
    const re = /<dd[^>]*>([\s\S]*?)<\/dd>/g;
    let d;
    while ((d = re.exec(m[1])) !== null) out.push(d[1]);
    return out;
}

function parseStreamers(html) {
    const out = [];
    const seen = {};
    RE_STREAMER.lastIndex = 0;
    let m;
    while ((m = RE_STREAMER.exec(html || "")) !== null) {
        const sid = m[1];
        const name = unescapeHtml(m[2].trim());
        if (!name || seen[sid]) continue;
        seen[sid] = true;
        out.push(["s" + sid, name]);
    }
    return out;
}

function fallbackCats() {
    const out = TABS.slice();
    for (const s of FALLBACK_STREAMERS) out.push(["s" + s[0], s[1]]);
    return out;
}

async function getCats() {
    if (catsCache && Date.now() - catsTs < PAGE_TTL) return catsCache;
    const out = TABS.slice();
    const html = await page(BASE + "/category");
    const streamers = html ? parseStreamers(html) : [];
    if (!streamers.length) {
        catsCache = fallbackCats();
    } else {
        for (const s of streamers) out.push(s);
        catsCache = out;
    }
    catsTs = Date.now();
    return catsCache;
}

async function categoryItems(tid, pg) {
    const tabIds = TABS.map(t => t[0]);
    const idx = tabIds.indexOf(tid);
    if (idx >= 0) {
        const html = await page(BASE + "/?a=11&t=sys");
        const sections = tabSections(html);
        const items = idx < sections.length ? parseCards(sections[idx]) : [];
        return {items: items, hasMore: false};
    }
    if (!tid || tid.charAt(0) !== "s") return {items: [], hasMore: false};
    const sid = tid.slice(1);
    const url = pg <= 1 ? BASE + "/category/" + sid : BASE + "/category/" + sid + "?page=" + pg;
    const html = await page(url);
    const items = parseCards(html);
    let hasMore;
    const tm = /page_total\s*=\s*(\d+)/.exec(html || "");
    if (!items.length) hasMore = false;
    else if (tm) hasMore = pg < parseInt(tm[1], 10);
    else hasMore = items.length >= 24;
    return {items: items, hasMore: hasMore};
}

async function fetchDetail(key) {
    const d = {title: "", cover: "", trailer: "", actor: "", content: "", remarks: ""};
    const html = await page(BASE + "/category/" + key);
    if (!html) return d;
    const vm = /<video[^>]*src="([^"]+)"/.exec(html);
    if (vm) d.trailer = unescapeHtml(vm[1]);
    const tm = /<div class="online-title">\s*([\s\S]*?)\s*<\/div>/.exec(html);
    if (tm) d.title = unescapeHtml(tm[1].trim());
    const pm = /<video[^>]*poster="([^"]+)"/.exec(html);
    if (pm) d.cover = fixUrl(pm[1]);
    const viewsM = /(\d[\d.]*[wk])/.exec(html);
    const views = viewsM ? viewsM[1] : "";
    const durM = /(\d+分\d+秒)/.exec(html);
    const duration = durM ? durM[1] : "";
    if (views && duration) d.remarks = views + " " + duration;
    else d.remarks = views || duration;
    const parts = [];
    const re = /<p[^>]*>([^<]{6,200})<\/p>/g;
    let pm2;
    while ((pm2 = re.exec(html)) !== null) {
        const t = unescapeHtml(pm2[1].trim());
        if (!t) continue;
        if (["下载", "会员", "VIP", "百度", "解压", "提取", "存储"].some(w => t.indexOf(w) >= 0)) continue;
        if (parts.indexOf(t) < 0) parts.push(t);
        if (parts.length >= 5) break;
    }
    d.content = parts.join(" ");
    const am = /<h3 class="f-18">([^<]+?)\s*\//.exec(html);
    if (am) d.actor = unescapeHtml(am[1].trim());
    return d;
}

async function resolveMaster(url, headers) {
    try {
        const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
        if (!resp || !resp.body || resp.body.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = resp.body.split(/\r?\n/).map(s => s.trim()).filter(s => s);
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].charAt(0) !== "#") {
                        try { return new URL(lines[j], url).href; } catch (e) { return url; }
                    }
                }
            }
        }
    } catch (error) {
        // keep the master URL when pre-resolving fails
    }
    return url;
}

async function home() {
    const cats = await getCats();
    let items = [];
    try {
        items = (await categoryItems(cats[0][0], 1)).items;
    } catch (error) {
        items = [];
    }
    return {
        categories: cats.map(c => ({id: c[0], name: c[1]})),
        items: items,
        hasMore: false,
    };
}

async function category(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "hot";
    const r = await categoryItems(tid, pg);
    return {items: r.items, hasMore: r.hasMore};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const html = await page(BASE + "/search?content=" + encodeURIComponent(keyword));
    return {items: parseCards(html), hasMore: false};
}

async function detail(arg) {
    let key = str(arg && arg.id).trim();
    if (Array.isArray(arg && arg.id)) key = str(arg.id[0] || "");
    if (!key) throw new Error("invalid id");
    const d = await fetchDetail(key);
    if (!d.title || !d.trailer) {
        return {id: key, title: d.title || key, cover: d.cover, desc: d.content, tags: [], lines: []};
    }
    const tags = d.actor ? [d.actor] : [];
    return {
        id: key,
        title: d.title,
        cover: d.cover,
        desc: d.content,
        tags: tags,
        remarks: d.remarks,
        lines: [{name: "在线播放", episodes: [{id: d.trailer, name: "预告片"}]}],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || "";
    const headers = {"User-Agent": UA, "Referer": BASE + "/"};
    let url = raw;
    if (!/^https?:\/\//i.test(url)) {
        const d = await fetchDetail(raw);
        url = d.trailer;
    }
    if (!url) throw new Error("no playable url");
    const isHls = /\.m3u8($|\?)/i.test(url);
    if (isHls) url = await resolveMaster(url, headers);
    return {
        streams: [{
            url: url,
            format: isHls ? "hls" : "mp4",
            headers: headers,
            name: "在线播放",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
