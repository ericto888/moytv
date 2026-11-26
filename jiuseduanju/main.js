// jiuseduanju - idj1 plugin (rewritten 1:1 from the builtin py spider jiuseduanju)
// Site: https://www.jiuseai.top/aa (MacCMS-style HTML pages, no encryption).
// Categories come from the live navigation on the index page, falling back
// to the builtin CATS table from the py spider when parsing yields nothing.
// Cards link straight to play pages; detail and play both read the
// player_aaaa JSON block on the play page. The handed-out stream URL is a
// master playlist when it carries variants, pre-resolved to a sub-playlist
// inside play (fallback to the original URL on any failure).
// The site is slow from this network, so the timeout is widened to 58s
// with 3 attempts per fetch, mirroring the py spider.

const BASE = "https://www.jiuseai.top/aa";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    ["2", "精品推荐"],
    ["3", "国产精品"],
    ["4", "主播秀色"],
    ["5", "日本无码"],
    ["6", "欧美情色"],
    ["7", "自拍偷拍"],
    ["8", "日本片商"],
    ["9", "剧情介绍"],
    ["10", "网曝系列"],
    ["11", "同性恋"],
    ["12", "探花嫖娼"],
    ["13", "国产人妻"],
    ["14", "国产SM"],
    ["15", "国产丝袜"],
    ["16", "麻豆传媒"],
    ["17", "国产乱伦"],
    ["62", "国产主播"],
    ["63", "欧美劲爆"],
    ["64", "自拍偷拍"],
    ["65", "群P换妻"],
    ["66", "吃瓜黑料"],
    ["67", "酒店探花"],
    ["68", "直播裸聊"],
    ["69", "反差母狗"],
    ["70", "国产传媒"],
    ["71", "野战车震"],
    ["72", "SM调教"],
    ["73", "家庭乱伦"],
    ["74", "百合女同"],
    ["75", "学生空姐"],
    ["76", "撸管必看"],
    ["77", "偷情少妇"],
    ["44", "偷拍自拍"],
    ["45", "国产大制作"],
    ["46", "乱伦毁三观"],
    ["47", "主播女网红"],
    ["48", "黑料网曝"],
    ["49", "淫乱学生妹"],
    ["50", "FC2"],
    ["51", "会所技师"],
    ["52", "国产推荐"],
    ["53", "探花约炮"],
    ["54", "韩国直播"],
    ["55", "国产直播"],
    ["56", "淫妻绿帽"],
    ["57", "重口猎奇"],
    ["58", "东京热"],
    ["59", "一本道"],
    ["19", "精品推荐"],
    ["20", "国产色情"],
    ["21", "主播直播"],
    ["22", "自拍偷拍"],
    ["23", "Cosplay"],
    ["24", "素人自拍"],
    ["25", "台湾辣妹"],
    ["26", "韩国御姐"],
    ["27", "唯美港姐"],
    ["28", "剧情介绍"],
    ["29", "多人多P"],
    ["30", "91探花"],
    ["31", "网红流出"],
    ["32", "野外露出"],
    ["33", "古装扮演"],
    ["34", "女优系列"],
    ["35", "可爱学生"],
    ["36", "风情旗袍"],
    ["37", "兽耳系列"],
    ["38", "瑜伽裤"],
    ["39", "闷骚护士"],
    ["40", "网曝门"],
    ["41", "传媒出品"],
    ["42", "女同性恋"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function headers(referer) {
    return {"User-Agent": UA, "Referer": referer || (BASE + "/")};
}

function unescapeHtml(s) {
    return String(s || "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'");
}

function cleanText(s) {
    return unescapeHtml(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// ---------- HTTP (py _http_get: 3 attempts, non-empty body wins) ----------

async function getText(url, referer) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(referer), timeout: TIMEOUT});
            if (resp && resp.body && String(resp.body).trim()) return String(resp.body);
        } catch (error) {
            // fall through to the next attempt, like the py spider
        }
    }
    return "";
}

// ---------- HTML parsing (same patterns as the py spider) ----------

function parseCategories(html) {
    const out = [];
    const seen = {};
    const re = /href="\/aa\/index\.php\/vod\/type\/id\/(\d+)\.html"[^>]*>\s*<text>([^<]+)<\/text>/g;
    let m;
    const text = String(html || "");
    while ((m = re.exec(text)) !== null) {
        const cid = m[1];
        const name = unescapeHtml(m[2].trim());
        if (!name || name === "更多" || seen[cid]) continue;
        seen[cid] = true;
        out.push([cid, name]);
    }
    return out;
}

async function loadCats() {
    const html = await getText(BASE + "/index.php/index/index.html");
    const cats = parseCategories(html);
    return cats.length ? cats : CATS;
}

function parseCards(html) {
    const out = [];
    const seen = {};
    const text = String(html || "");
    const re = /<a href="\/aa\/index\.php\/vod\/play\/id\/(\d+)\/sid\/1\/nid\/1\.html"[^>]*>\s*<img[^>]*data-original="([^"]+)"/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const vid = m[1];
        if (seen[vid]) continue;
        const cover = m[2].trim();
        const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 3000);
        const tm = tail.match(/<h3 class="video-title">[\s\S]*?<text>([^<]+)<\/text>/);
        const title = tm ? unescapeHtml(tm[1].trim()) : "";
        if (!title) continue;
        seen[vid] = true;
        out.push({id: vid, title: title, cover: cover, remarks: "", tags: []});
    }
    return out;
}

function parsePlayerAaaa(html) {
    const text = String(html || "");
    const start = text.indexOf("player_aaaa=");
    if (start < 0) return null;
    const rest = text.slice(start + "player_aaaa=".length);
    const brace = rest.indexOf("{");
    if (brace < 0) return null;
    let depth = 0;
    let end = -1;
    for (let i = brace; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === "{") depth += 1;
        else if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }
    if (end < 0) return null;
    try {
        return JSON.parse(rest.slice(brace, end));
    } catch (error) {
        return null;
    }
}

function playPageUrl(videoId) {
    const s = str(videoId);
    let vid = s;
    const marker = "/vod/play/id/";
    const pos = s.indexOf(marker);
    if (pos >= 0) {
        const rest = s.slice(pos + marker.length);
        let digits = "";
        for (let i = 0; i < rest.length; i++) {
            const ch = rest[i];
            if (ch >= "0" && ch <= "9") digits += ch;
            else break;
        }
        vid = digits || s;
    } else {
        vid = s.replace("/aa/index.php/vod/play/id/", "").replace("/vod/play/id/", "")
            .replace(/\.html$/, "").replace(/\/$/, "");
        vid = vid.split("/sid/")[0];
    }
    return BASE + "/index.php/vod/play/id/" + vid + "/sid/1/nid/1.html";
}

// ---------- idj1 contract ----------

async function home() {
    const cats = await loadCats();
    const tid = cats.length ? cats[0][0] : "2";
    const html = await getText(BASE + "/index.php/vod/type/id/" + tid + ".html");
    const items = parseCards(html);
    return {
        categories: cats.map((c) => ({id: c[0], name: c[1]})),
        items: items,
        hasMore: items.length > 0,
    };
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "2";
    let url;
    if (page <= 1) url = BASE + "/index.php/vod/type/id/" + tid + ".html";
    else url = BASE + "/index.php/vod/type/id/" + tid + "/page/" + page + ".html";
    const html = await getText(url);
    const items = parseCards(html);
    const hasMore = items.length > 0 &&
        String(html || "").indexOf("/vod/type/id/" + tid + "/page/" + (page + 1) + ".html") >= 0;
    return {items: items, hasMore: hasMore};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/index.php/vod/search.html?wd=" + encodeURIComponent(keyword);
    const html = await getText(url);
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    if (!raw) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const url = playPageUrl(raw);
    const html = await getText(url);
    if (!html) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const player = parsePlayerAaaa(html);
    if (!player) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const vod = (player.vod_data && typeof player.vod_data === "object") ? player.vod_data : {};
    const title = str(vod.vod_name);
    if (!title) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const genre = str(vod.vod_class);
    let cover = "";
    const cm = String(html).match(/data-original="([^"]*?\/upload\/vod\/[^"]+)"/);
    if (cm) cover = cm[1];
    return {
        id: raw,
        title: title,
        cover: cover,
        desc: "",
        tags: genre ? [genre] : [],
        lines: [{
            name: "在线播放",
            episodes: [{id: url, name: "立即播放"}],
        }],
    };
}

async function resolveMaster(streamUrl, referer) {
    try {
        const resp = await host.http.get(streamUrl, {headers: headers(referer), timeout: TIMEOUT});
        const text = resp && resp.body ? String(resp.body) : "";
        if (!text || text.indexOf("#EXTM3U") < 0) return streamUrl;
        const lines = text.split(/\r?\n/);
        let best = "";
        let bestBw = -1;
        let first = "";
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
                let bw = 0;
                const bm = line.match(/BANDWIDTH=(\d+)/);
                if (bm) bw = parseInt(bm[1], 10);
                for (let j = i + 1; j < lines.length; j++) {
                    const uri = lines[j].trim();
                    if (!uri) continue;
                    if (uri.charAt(0) === "#") break;
                    if (!first) first = uri;
                    if (bw > bestBw) {
                        bestBw = bw;
                        best = uri;
                    }
                    break;
                }
            }
        }
        const chosen = best || first;
        if (!chosen) return streamUrl;
        return host.url.resolve(streamUrl, chosen);
    } catch (error) {
        return streamUrl;
    }
}

async function play(arg) {
    const rawInput = str((arg && arg.episodeId) || (arg && arg.id));
    if (!rawInput) throw new Error("invalid play id");
    const raw = rawInput.split("$").pop().trim();
    if (raw.endsWith(".m3u8")) {
        return {
            streams: [{
                url: raw,
                format: "hls",
                headers: {"User-Agent": UA},
                name: "jiuseduanju",
            }],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const url = playPageUrl(raw);
    const html = await getText(url);
    const player = html ? parsePlayerAaaa(html) : null;
    let stream = "";
    if (player && typeof player === "object") stream = str(player.url);
    if (!stream) throw new Error("no stream url in play page");
    const isHls = /\.m3u8($|\?)/i.test(stream);
    let finalUrl = stream;
    if (isHls) finalUrl = await resolveMaster(stream, url);
    return {
        streams: [{
            url: finalUrl,
            format: isHls ? "hls" : "mp4",
            headers: {"User-Agent": UA, "Referer": url},
            name: "jiuseduanju",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
