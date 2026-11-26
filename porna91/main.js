// 91porna — idj1 plugin (rewritten from built-in py spider porna91)
// Site: https://91porna.com ; HTML pages parsed like the py version,
// playback resolves the Dean Edwards packed embed chain to an m3u8.

const HOST = "https://91porna.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    ["play", "正在播放"],
    ["now_month_hot", "热门排行榜"],
    ["original", "国产原创"],
    ["theme:1", "多P群交"],
    ["theme:12", "无码解放"],
    ["theme:5", "中文字幕"],
    ["theme:6", "制服诱惑"],
    ["theme:107", "黑人专区"],
    ["theme:7", "SM调教"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function decodeEntities(s) {
    return String(s || "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function stripTags(s) {
    return decodeEntities(String(s || "").replace(/<[^>]+>/g, ""));
}

function truncate(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n) : s;
}

function pageHeaders(referer) {
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": referer || (HOST + "/"),
    };
}

async function getText(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: pageHeaders(referer), timeout: TIMEOUT});
            if (resp && resp.body) return resp.body;
            if (resp && resp.status) lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return "";
}

async function getTextSoft(url, referer) {
    try {
        return await getText(url, referer);
    } catch (error) {
        return "";
    }
}

function attr(tag, name) {
    const marker = name + '="';
    const p = String(tag || "").indexOf(marker);
    if (p < 0) return "";
    const s = p + marker.length;
    const e = tag.indexOf('"', s);
    if (e < 0) return "";
    return decodeEntities(tag.slice(s, e));
}

// ---------- Dean Edwards packer unpack (port of py _dean_unpack) ----------

function encodeBase(n, base) {
    function digit(v) {
        if (v <= 35) return "0123456789abcdefghijklmnopqrstuvwxyz"[v];
        return String.fromCharCode(v + 29);
    }
    if (n < base) return digit(n);
    let out = "";
    while (n >= base) {
        out = digit(n % base) + out;
        n = Math.floor(n / base);
    }
    return digit(n) + out;
}

function jsUnescape(s) {
    const mapping = {n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0"};
    let out = "";
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (c !== "\\") { out += c; i += 1; continue; }
        if (i + 1 >= s.length) { out += "\\"; break; }
        const nxt = s[i + 1];
        out += (nxt in mapping) ? mapping[nxt] : nxt;
        i += 2;
    }
    return out;
}

function deanUnpack(packed) {
    if (!packed) return null;
    const m = /\}\('([\s\S]*)',(\d+),(\d+),'([\s\S]*)'\.split\('\|'\)/.exec(packed);
    if (!m) return null;
    const payload = jsUnescape(m[1]);
    const base = parseInt(m[2], 10);
    const count = parseInt(m[3], 10);
    if (!isFinite(base) || !isFinite(count)) return null;
    const keys = m[4].split("|");
    const d = {};
    for (let i = 0; i < count; i++) {
        const key = encodeBase(i, base);
        const val = i < keys.length ? keys[i] : "";
        d[key] = val ? val : key;
    }
    return payload.replace(/\w+/g, (mm) => (mm in d ? d[mm] : mm));
}

function extractPacked(html) {
    const start = String(html || "").indexOf("eval(function(p,a,c,k,e,d)");
    if (start < 0) return null;
    let after = html.slice(start);
    const end = after.indexOf("</script>");
    if (end >= 0) after = after.slice(0, end);
    return after;
}

// ---------- list parsing (port of py _cards) ----------

function parseCards(html) {
    const out = [];
    const seen = {};
    const blocks = String(html || "").split('<div class="video-item">').slice(1);
    for (let block of blocks) {
        const cut = block.indexOf('<div class="video-item">');
        if (cut >= 0) block = block.slice(0, cut);
        const hp = block.indexOf("video_key=");
        if (hp < 0) continue;
        const afterKey = block.slice(hp + 10);
        let keyEnd = afterKey.length;
        for (let i = 0; i < afterKey.length; i++) {
            const c = afterKey[i];
            if (c === '"' || c === "'" || c === "&" || c === " ") { keyEnd = i; break; }
        }
        const key = afterKey.slice(0, keyEnd);
        if (!key) continue;
        const href = block.slice(0, hp).indexOf("avdetail") >= 0
            ? HOST + "/comic/index/avdetail?video_key=" + key
            : HOST + "/comic/index/detail?video_key=" + key;
        if (seen[href]) continue;
        let title = "";
        let cover = "";
        let p = block.indexOf("<img ");
        if (p >= 0) title = attr(block.slice(p), "alt");
        if (!title) {
            p = block.indexOf("<h2");
            if (p >= 0) {
                const after = block.slice(p);
                const gt = after.indexOf(">");
                if (gt >= 0) {
                    const s = gt + 1;
                    const e = after.slice(s).indexOf("</h2>");
                    if (e >= 0) title = stripTags(after.slice(s, s + e));
                }
            }
        }
        if (!title) continue;
        if (p >= 0) {
            const img = block.slice(block.indexOf("<img ") >= 0 ? block.indexOf("<img ") : p);
            const ds = attr(img, "data-src");
            const src = attr(img, "src");
            if (ds && ds.indexOf("poster_loading") < 0) cover = ds;
            else if (src && src.indexOf("poster_loading") < 0) cover = src;
        }
        let remark = "";
        p = block.indexOf("opacity-50");
        if (p >= 0) {
            const after = block.slice(p);
            const gt = after.indexOf(">");
            if (gt >= 0) {
                const s = gt + 1;
                const e = after.slice(s).indexOf("</div>");
                if (e >= 0) remark = after.slice(s, s + e).trim();
            }
        }
        seen[href] = true;
        out.push({id: href, title: truncate(title, 90), cover: cover, remarks: remark, duration: remark, tags: []});
    }
    return out;
}

function catalogUrl(categoryId, page) {
    function withPage(base) {
        return page <= 1 ? base : base + "&page=" + page;
    }
    if (categoryId === "play" || categoryId === "now_month_hot" || categoryId === "original") {
        return withPage(HOST + "/comic/index/video?category=" + categoryId);
    }
    if (categoryId.indexOf("theme:") === 0) {
        return withPage(HOST + "/comic/av/relvideo?model=" + categoryId.slice(6) + "&type=theme&order=week");
    }
    return withPage(HOST + "/comic/index/video?category=play");
}

// ---------- idj1 contract ----------

async function home() {
    const categories = CATS.map((item) => ({id: item[0], name: item[1]}));
    const html = await getTextSoft(catalogUrl("play", 1), HOST + "/");
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "play";
    const html = await getTextSoft(catalogUrl(tid, page), HOST + "/");
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = HOST + "/comic/index/search?keyword=" + encodeURIComponent(keyword);
    const html = await getTextSoft(url, HOST + "/");
    const items = parseCards(html).slice(0, 60);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const nid = str(arg && arg.id);
    if (!nid) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    const html = await getTextSoft(nid, HOST + "/");
    if (!html) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    let title = "";
    const tp = html.indexOf("<title>");
    if (tp >= 0) {
        const s = tp + 7;
        const e = html.slice(s).indexOf("</title>");
        if (e >= 0) title = decodeEntities(html.slice(s, s + e));
    }
    if (title.indexOf(" - 91视频") >= 0) title = title.split(" - 91视频")[0].trim();
    for (const suf of [" 日本AV", " A片"]) {
        if (title.endsWith(suf)) title = title.slice(0, title.length - suf.length).trim();
    }
    if (!title) return {id: nid, title: nid, cover: "", desc: "", tags: [], lines: []};
    let cover = "";
    let m = /property="og:image"[^>]*content="([^"]+)"/.exec(html);
    if (!m) m = /content="([^"]+)"[^>]*property="og:image"/.exec(html);
    if (m) cover = decodeEntities(m[1]);
    let desc = "";
    m = /"description":"((?:[^"\\]|\\.)*)"/.exec(html);
    if (m) {
        desc = m[1];
        if (desc.indexOf("\\u") >= 0) {
            try { desc = JSON.parse('"' + desc.replace(/"/g, '\\"') + '"'); } catch (error) { /* keep raw */ }
        }
    }
    let dur = "";
    m = /property="video:duration"[^>]*content="([^"]+)"/.exec(html);
    if (!m) m = /content="([^"]+)"[^>]*property="video:duration"/.exec(html);
    if (m) {
        const total = parseInt(m[1], 10);
        if (isFinite(total) && total > 0) {
            const h = Math.floor(total / 3600);
            const mi = Math.floor((total % 3600) / 60);
            const s = total % 60;
            const pad = (v) => (v < 10 ? "0" + v : "" + v);
            dur = h > 0 ? (h + ":" + pad(mi) + ":" + pad(s)) : (mi + ":" + pad(s));
        }
    }
    const tags = [];
    let rest = html;
    while (tags.length < 10) {
        const p = rest.indexOf('property="video:tag"');
        if (p < 0) break;
        const after = rest.slice(p);
        const c = after.indexOf('content="');
        if (c >= 0) {
            const s = c + 9;
            const e = after.slice(s).indexOf('"');
            if (e >= 0) {
                const t = decodeEntities(after.slice(s, s + e));
                if (t && tags.indexOf(t) < 0) tags.push(t);
            }
        }
        rest = rest.slice(p + 1);
    }
    const lines = [];
    if (dur) lines.push("时长：" + dur);
    if (tags.length) lines.push("标签：" + tags.join("、"));
    let fullDesc = desc;
    if (lines.length) {
        if (fullDesc) fullDesc += "\n";
        fullDesc += lines.join("\n");
    }
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: truncate(fullDesc, 400),
        duration: dur,
        tags: tags,
        lines: [{
            name: "在线播放",
            episodes: [{id: nid, name: "正片"}],
        }],
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    const baseHeaders = {"User-Agent": UA, "Referer": HOST + "/"};
    if (raw.indexOf("http") === 0 && raw.indexOf(".m3u8") >= 0) {
        return {streams: [{url: raw, format: "hls", headers: baseHeaders, name: "91porna"}], expiresAt: Date.now() + 3600 * 1000};
    }
    const pageUrl = raw.split("$").pop();
    const detailHtml = await getText(pageUrl, HOST + "/");
    if (!detailHtml) throw new Error("详情页为空");
    let vid = "";
    let m = /data-video="(\d+)"/.exec(detailHtml);
    if (m) vid = m[1];
    if (!vid) {
        m = /\/comic\/index\/embed\?id=(\d+)/.exec(detailHtml);
        if (m) vid = m[1];
    }
    if (!vid) throw new Error("未找到视频 ID");
    let cdnAuth = "";
    let cdnApp = "";
    const cp = detailHtml.indexOf('id="cdn-config"');
    if (cp >= 0) {
        let tag = detailHtml.slice(cp);
        const e = tag.indexOf(">");
        if (e >= 0) tag = tag.slice(0, e);
        cdnAuth = attr(tag, "data-video_cdn_auth_value");
        cdnApp = attr(tag, "data-cdn_app");
    }
    const embedUrl = HOST + "/comic/index/embed?id=" + vid;
    const headers = {"User-Agent": UA, "Referer": embedUrl};
    if (cdnAuth) headers["x-cdn-auth"] = cdnAuth;
    if (cdnApp) headers["x-cdn-app"] = cdnApp;
    let url = "";
    // Current site chain: POST /api/videos/<id>/playback returns signed streams.
    try {
        const apiHeaders = {"User-Agent": UA, "Accept": "application/json", "Content-Type": "application/json", "Referer": embedUrl};
        let respBody = "";
        for (let attempt = 0; attempt < 2 && !respBody; attempt++) {
            try {
                const r = await host.http.post(HOST + "/api/videos/" + vid + "/playback", "{}", {headers: apiHeaders, timeout: TIMEOUT});
                if (r && r.status >= 200 && r.status < 300 && r.body) respBody = r.body;
            } catch (error) { /* retry once */ }
        }
        if (respBody) {
            const result = JSON.parse(respBody);
            const data = result && result.data ? result.data : null;
            if (data && data.streams && data.streams.main) {
                url = String(data.streams.main);
                if (data.cdn) {
                    const key = str(data.cdn.authKey) || "x-cdn-auth";
                    if (data.cdn.authValue) headers[key] = String(data.cdn.authValue);
                    if (data.cdn.app) headers["x-cdn-app"] = String(data.cdn.app);
                }
            }
        }
    } catch (error) { /* fall through to legacy packed chain */ }
    if (!url) {
        // Legacy chain from the py version: packed embed script -> embed_play.js.
        const embedHtml = await getText(embedUrl, pageUrl);
        const packed = extractPacked(embedHtml || "");
        if (!packed) throw new Error("embed 页无打包脚本");
        const unpacked = deanUnpack(packed);
        if (!unpacked) throw new Error("embed 脚本解包失败");
        m = /embed_play\.js\?img=([^"&]+)&u="\+encodeURIComponent\("([0-9a-f]+)"\)/.exec(unpacked);
        if (!m) throw new Error("embed_play 参数未找到");
        const img = m[1];
        const u = m[2];
        const t = Math.floor(Date.now() / 1000 / 2100);
        const playJs = HOST + "/index/embed_play.js?img=" + img + "&u=" + u + "&h=&t=" + t;
        const playBody = await getText(playJs, embedUrl);
        const playUnpacked = deanUnpack(playBody || "");
        if (!playUnpacked) throw new Error("embed_play 解包失败");
        m = /https:\/\/[^\s"\\]+\.m3u8[^\s"\\]*/.exec(playUnpacked);
        if (!m) throw new Error("未找到 m3u8 地址");
        url = m[0];
    }
    // Pre-resolve a master playlist to its first child playlist.
    try {
        const pl = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
        if (pl && pl.status >= 200 && pl.status < 300 && pl.body && pl.body.indexOf("#EXT-X-STREAM-INF") >= 0) {
            const lines2 = pl.body.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s.charAt(0) !== "#");
            if (lines2.length) url = new URL(lines2[0], url).href;
        }
    } catch (error) {
        // Keep the master URL; the player can still follow it.
    }
    return {streams: [{url: url, format: "hls", headers: headers, name: "91porna"}], expiresAt: Date.now() + 3600 * 1000};
}

export default {home: home, category: category, search: search, detail: detail, play: play};
