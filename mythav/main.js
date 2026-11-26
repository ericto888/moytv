// MythAV - idj1 plugin (rewritten from the built-in py spider mythav)
// Site: https://sdyoof.asia ; pages may arrive hex-encoded and are decoded
// the same way the py spider did (longest hex run >= 1000 chars).

const HOST = "https://sdyoof.asia";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    ["chinese-subtitle", "中文字幕"],
    ["bdsm", "主奴调教"],
    ["sex-only", "直接开啪"],
    ["insult", "凌辱快感"],
    ["uniform", "制服诱惑"],
    ["roleplay", "角色剧情"],
    ["private-cam", "盗摄偷拍"],
    ["uncensored", "无码解放"],
    ["pov", "男友视角"],
    ["groupsex", "多P群交"],
    ["pantyhose", "丝袜美腿"],
    ["lesbian", "女同性恋"],
];

const ALL_CATS = [["latest", "最新上传"]]
    .concat(CATS.map((c) => ["cat:" + c[0], c[1]]))
    .concat([["guochan", "国产传媒"], ["tags", "标签"]]);

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) && n >= 1 ? n : fallback;
}

function pageHeaders() {
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": HOST + "/zh/",
    };
}

function decodeEntities(s) {
    let out = String(s || "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&ndash;/g, "–")
        .replace(/&mdash;/g, "—");
    for (let i = 0; i < 32; i++) {
        const m = /&#(\d{1,7});/.exec(out);
        if (!m) break;
        let rep = "";
        try { rep = String.fromCodePoint(parseInt(m[1], 10)); } catch (e) { break; }
        out = out.slice(0, m.index) + rep + out.slice(m.index + m[0].length);
    }
    return out.trim();
}

function stripTags(s) {
    return decodeEntities(String(s || "").replace(/<[^>]+>/g, ""));
}

function decodePage(body) {
    const text = String(body || "");
    let bestStart = 0;
    let bestLen = 0;
    let i = 0;
    const n = text.length;
    const isHex = (c) => (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
    while (i < n) {
        if (isHex(text[i])) {
            const start = i;
            while (i < n && isHex(text[i])) i++;
            if (i - start > bestLen) { bestLen = i - start; bestStart = start; }
        } else {
            i++;
        }
    }
    if (bestLen >= 1000 && bestLen % 2 === 0) {
        const hex = text.slice(bestStart, bestStart + bestLen);
        try {
            let latin1 = "";
            for (let k = 0; k + 2 <= hex.length; k += 2) {
                latin1 += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
            }
            try {
                return host.codec.convert(latin1, "latin1", "utf8");
            } catch (e) {
                return latin1;
            }
        } catch (e) {
            // fall through to raw body
        }
    }
    return text;
}

const pageCache = new Map();

async function httpGet(url) {
    if (pageCache.has(url)) return pageCache.get(url);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: pageHeaders(), timeout: TIMEOUT});
            if (resp && resp.status === 200 && resp.body) {
                const decoded = decodePage(resp.body);
                if (pageCache.size >= 4) pageCache.delete(pageCache.keys().next().value);
                pageCache.set(url, decoded);
                return decoded;
            }
            if (resp && resp.status === 200) return "";
            lastError = new Error("HTTP " + (resp ? resp.status : "?"));
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return "";
}

async function httpGetSoft(url) {
    try {
        return await httpGet(url);
    } catch (e) {
        return "";
    }
}

function fixCover(url) {
    const u = str(url);
    if (!u) return u;
    const m = /\/base\/([A-Za-z0-9+/=_-]+)\.cache/.exec(u);
    if (m) {
        try {
            const decoded = host.codec.base64Decode(m[1].replace(/-/g, "+").replace(/_/g, "/"), {to: "utf8"});
            if (decoded && decoded.indexOf("http") === 0) return decoded;
        } catch (e) {
            // keep the cache url when decoding fails
        }
    }
    return u;
}

function parseCards(html) {
    const out = [];
    const seen = {};
    const blocks = String(html || "").split('<article class="video-card">');
    for (let b = 1; b < blocks.length; b++) {
        let block = blocks[b];
        const end = block.indexOf("</article>");
        if (end >= 0) block = block.slice(0, end);
        let path = "";
        let p = block.indexOf('href="/zh/video?id=');
        if (p >= 0) {
            const s = p + 6;
            const e = block.indexOf('"', s);
            if (e >= 0) path = block.slice(s, e);
        }
        if (!path) {
            p = block.indexOf('href="/zh/guochan/play/');
            if (p >= 0) {
                const s = p + 6;
                const e = block.indexOf('"', s);
                if (e >= 0) path = block.slice(s, e);
            }
        }
        if (!path) continue;
        const vid = HOST + path;
        if (seen[vid]) continue;
        let cover = "";
        p = block.indexOf('<img src="');
        if (p >= 0) {
            const s = p + 10;
            const e = block.indexOf('"', s);
            if (e >= 0) cover = block.slice(s, e);
        }
        let remark = "";
        p = block.indexOf('<span class="duration">');
        if (p >= 0) {
            const s = p + 23;
            const e = block.indexOf("</span>", s);
            if (e >= 0) remark = block.slice(s, e).trim();
        }
        let title = "";
        p = block.indexOf("<h3>");
        if (p >= 0) {
            const after = block.slice(p);
            const e = after.indexOf("</h3>");
            if (e >= 0) title = stripTags(after.slice(0, e));
        }
        if (title.length > 90) title = title.slice(0, 90);
        if (!title) continue;
        seen[vid] = true;
        out.push({id: vid, title: title, cover: fixCover(cover), remarks: remark, duration: remark, tags: []});
    }
    return out;
}

function parseTags(html) {
    const out = [];
    const seen = {};
    const blocks = String(html || "").split('<a href="/zh/tags/');
    for (let b = 1; b < blocks.length; b++) {
        const block = blocks[b];
        const e = block.indexOf('"');
        if (e < 0) continue;
        const slug = block.slice(0, e);
        if (!slug || seen[slug]) continue;
        let name = "";
        let p = block.indexOf("<b># ");
        if (p >= 0) {
            const s = p + 5;
            const e2 = block.indexOf("</b>", s);
            if (e2 >= 0) name = decodeEntities(block.slice(s, e2).trim());
        }
        if (!name) continue;
        let count = "";
        p = block.indexOf("<small>");
        if (p >= 0) {
            const s = p + 7;
            const e2 = block.indexOf("</small>", s);
            if (e2 >= 0) count = block.slice(s, e2).trim();
        }
        seen[slug] = true;
        out.push({
            id: "folder@/zh/tags/" + slug,
            title: name,
            cover: "",
            remarks: count ? count + " 部影片" : "",
            tags: [],
        });
    }
    return out;
}

function withPage(base, page) {
    if (page <= 1) return base;
    if (base.indexOf("?") >= 0) return base + "&p=" + page;
    return base + "?p=" + page;
}

function catalogUrl(tid, page) {
    if (tid === "latest") return withPage(HOST + "/zh/latest-updates", page);
    if (tid === "guochan") return withPage(HOST + "/zh/guochan/category/43996?name=%E5%9B%BD%E4%BA%A7%E4%BC%A0%E5%AA%92", page);
    if (tid === "tags") return HOST + "/zh/tags";
    if (tid.indexOf("cat:") === 0) return withPage(HOST + "/zh/categories/" + tid.slice(4), page);
    if (tid.indexOf("tag:") === 0) return withPage(HOST + "/zh/tags/" + tid.slice(4), page);
    return withPage(HOST + "/zh/latest-updates", page);
}

async function home() {
    const categories = ALL_CATS.map((c) => ({id: c[0], name: c[1]}));
    const html = await httpGetSoft(HOST + "/zh/latest-updates");
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = intValue(arg && arg.page, 1);
    const tid = str(arg && arg.id) || "latest";
    if (tid.indexOf("folder@") === 0) {
        let url = HOST + tid.slice(7);
        if (page > 1) url += "?p=" + page;
        const items = parseCards(await httpGetSoft(url));
        return {items: items, hasMore: items.length > 0};
    }
    if (tid === "tags") {
        const items = parseTags(await httpGetSoft(HOST + "/zh/tags"));
        return {items: items, hasMore: false};
    }
    const items = parseCards(await httpGetSoft(catalogUrl(tid, page)));
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = HOST + "/zh/search?text=" + encodeURIComponent(keyword);
    const items = parseCards(await httpGetSoft(url)).slice(0, 60);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    if (!raw) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    if (raw.indexOf("folder@") === 0 || raw.indexOf("tag:") === 0) {
        return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    }
    const pageUrl = raw.split("$").pop();
    const html = await httpGetSoft(pageUrl);
    if (!html) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    let title = "";
    const p = html.indexOf("<h1>");
    if (p >= 0) {
        const after = html.slice(p + 4);
        const e = after.indexOf("</h1>");
        if (e >= 0) title = stripTags(after.slice(0, e));
    }
    if (!title) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    let cover = "";
    let m = /property="og:image"[^>]*content="([^"]+)"/.exec(html);
    if (!m) m = /content="([^"]+)"[^>]*property="og:image"/.exec(html);
    if (m) cover = fixCover(decodeEntities(m[1]));
    let synopsis = "";
    m = /"duration":"PT([0-9HMS]+)"/.exec(html);
    if (m) {
        let secs = 0;
        let num = "";
        const flush = (c) => {
            const v = parseInt(num, 10) || 0;
            if (c === "H") secs += v * 3600;
            else if (c === "M") secs += v * 60;
            else if (c === "S") secs += v;
            num = "";
        };
        for (const c of m[1]) {
            if (c >= "0" && c <= "9") num += c;
            else flush(c);
        }
        const hh = String(Math.floor(secs / 3600)).padStart(2, "0");
        const mm = String(Math.floor(secs / 60) % 60).padStart(2, "0");
        const ss = String(secs % 60).padStart(2, "0");
        synopsis = "时长：" + hh + ":" + mm + ":" + ss;
    }
    const genres = [];
    const gp = html.indexOf('"genre":[');
    if (gp >= 0) {
        const rest = html.slice(gp + 9);
        const e = rest.indexOf("]");
        if (e >= 0) {
            for (const t of rest.slice(0, e).split(",")) {
                const g = decodeEntities(t.trim().replace(/^"|"$/g, ""));
                if (g) genres.push(g);
            }
        }
    }
    if (genres.length) {
        if (synopsis) synopsis += "\n";
        synopsis += "标签：" + genres.join("、");
    }
    return {
        id: raw,
        title: title,
        cover: cover,
        desc: synopsis,
        tags: genres,
        lines: [{
            name: "在线播放",
            episodes: [{id: pageUrl, name: "正片"}],
        }],
    };
}

async function resolveMaster(masterUrl, headers) {
    // Pre-resolve a master playlist to its first variant sub-playlist.
    try {
        const resp = await host.http.get(masterUrl, {headers: headers, timeout: TIMEOUT});
        if (!resp || resp.status !== 200 || !resp.body) return masterUrl;
        const text = String(resp.body);
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return masterUrl;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
                for (let j = i + 1; j < lines.length; j++) {
                    const cand = lines[j].trim();
                    if (cand && cand.indexOf("#") !== 0) {
                        if (cand.indexOf("http") === 0) return cand;
                        if (cand.indexOf("/") === 0) {
                            const om = /^https?:\/\/[^/]+/.exec(masterUrl);
                            return (om ? om[0] : "") + cand;
                        }
                        return masterUrl.slice(0, masterUrl.lastIndexOf("/") + 1) + cand;
                    }
                }
            }
        }
    } catch (e) {
        // keep the master url when pre-resolving fails
    }
    return masterUrl;
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    const headers = {"User-Agent": UA, "Referer": HOST + "/zh/", "Origin": HOST, "Accept": "*/*"};
    if (raw.indexOf("http") === 0 && raw.indexOf(".m3u8") >= 0) {
        const sub = await resolveMaster(raw, {"User-Agent": UA, "Referer": HOST + "/zh/"});
        return {streams: [{url: sub, format: "hls", headers: headers, name: "MythAV"}], expiresAt: Date.now() + 3600 * 1000};
    }
    const pageUrl = raw.split("$").pop();
    const html = await httpGet(pageUrl);
    let url = "";
    let m = /"url":"(https:\/\/[^"]+\.m3u8[^"]*)"/.exec(html || "");
    if (m) url = m[1];
    if (!url) {
        m = /"contentUrl":"([^"]+\.m3u8[^"]*)"/.exec(html || "");
        if (m) url = m[1];
    }
    if (!url) throw new Error("未找到播放地址");
    url = url.replace(/\\\//g, "/");
    headers["Referer"] = pageUrl;
    const sub = await resolveMaster(url, {"User-Agent": UA, "Referer": pageUrl});
    return {streams: [{url: sub, format: "hls", headers: headers, name: "MythAV"}], expiresAt: Date.now() + 3600 * 1000};
}

export default {home: home, category: category, search: search, detail: detail, play: play};
