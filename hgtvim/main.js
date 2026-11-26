// 黄果短剧HGTV — idj1 plugin (ported 1:1 from the builtin py spider hgtvim)
// Site: https://hgtv.im, server-rendered HTML. The 14 fixed categories are
// the py CATS verbatim (incl. the synthetic "home" entry); list cards,
// detail JSON-LD fields, episode discovery and search reuse the py logic.
// Play mirrors the py playerContent: fetch /watch/{sid}_{ep}.html, take its
// data-src (default /play/{sid}_{ep}.html), fetch that URL and use the final
// redirect target / inline playlist / first m3u8 in the body. A master
// playlist is pre-resolved to its first variant inside play().
// The py kept a cookie jar across the watch->play hops and sent the cookies
// to the play URL (the play endpoint answers 403 without the session
// cookies). The plugin cannot send Cookie headers itself, but the host
// keeps a per-plugin cookie jar automatically, so the session cookies set
// by the home/detail/watch responses are attached to the play request the
// same way. Verified live: with the jar the play endpoint returns the
// inline master playlist; without it, 403.

const HOST = "https://hgtv.im";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATS = [
    ["home", "首页"],
    ["3", "经典魔改"],
    ["10", "家庭伦理"],
    ["2", "都市爱情"],
    ["17", "特殊趣味"],
    ["11", "校园记忆"],
    ["1", "古装玄幻"],
    ["6", "现代惊悚"],
    ["13", "域外传奇"],
    ["4", "经典动漫"],
    ["5", "AI演示"],
    ["12", "特殊口味"],
    ["9", "异能穿越"],
    ["68", "二次元区"],
];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function pageHeaders(referer) {
    return {"User-Agent": UA, "Referer": referer || (HOST + "/")};
}

async function getResp(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: pageHeaders(referer), timeout: TIMEOUT});
            if (resp.status === 200 || resp.status === 206) return resp;
            // py _http returns the error body for HTTPError; other statuses
            // are retried, then surfaced.
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw host.error("E_NETWORK", "请求失败 " + url + ": " + (lastError && lastError.message));
    return {status: 0, url: url, headers: {}, body: ""};
}

async function getText(url, referer) {
    const resp = await getResp(url, referer);
    return resp.body || "";
}

// ---------- py helpers ----------

function unescapeHtml(t) {
    if (!t) return "";
    t = String(t)
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
    t = t.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
    t = t.replace(/&#[xX]([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)));
    return t;
}

function clean(t) {
    if (!t) return "";
    t = String(t).replace(/<[^>]+>/g, " ");
    return unescapeHtml(t).replace(/\s+/g, " ").trim();
}

function fixUrl(u) {
    if (!u) return "";
    u = unescapeHtml(String(u).replace(/\\\//g, "/")).trim();
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("http") === 0) return u;
    if (u.charAt(0) === "/") return HOST + u;
    return HOST + "/" + u;
}

// py _jld: first "key":" value with backslash-escape handling.
function jld(html, key) {
    const marker = '"' + key + '":"';
    const p = (html || "").indexOf(marker);
    if (p < 0) return "";
    let i = p + marker.length;
    let out = "";
    while (i < html.length) {
        const c = html.charAt(i);
        if (c === "\\") {
            if (i + 1 < html.length) { out += html.charAt(i + 1); i += 2; continue; }
            break;
        }
        if (c === '"') break;
        out += c;
        i++;
    }
    return out;
}

function og(html, prop) {
    const marker = 'property="' + prop + '"';
    const p = (html || "").indexOf(marker);
    if (p < 0) return "";
    const after = html.slice(p);
    const c = after.indexOf('content="');
    if (c < 0) return "";
    const s = c + 9;
    const e = after.slice(s).indexOf('"');
    return e >= 0 ? after.slice(s, s + e) : "";
}

function metaName(html, name) {
    const marker = 'name="' + name + '"';
    const p = (html || "").indexOf(marker);
    if (p < 0) return "";
    const after = html.slice(p);
    const c = after.indexOf('content="');
    if (c < 0) return "";
    const s = c + 9;
    const e = after.slice(s).indexOf('"');
    return e >= 0 ? after.slice(s, s + e) : "";
}

function attr(block, name) {
    const marker = name + '="';
    const p = (block || "").indexOf(marker);
    if (p < 0) return "";
    const s = p + marker.length;
    const e = block.slice(s).indexOf('"');
    return e >= 0 ? block.slice(s, s + e) : "";
}

function tagText(block, tag) {
    const p = (block || "").indexOf("<" + tag);
    if (p < 0) return "";
    const after = block.slice(p);
    let s = after.indexOf(">");
    if (s < 0) return "";
    s += 1;
    const close = "</" + tag + ">";
    let e = after.slice(s).indexOf(close);
    if (e < 0) e = after.length - s;
    return clean(after.slice(s, s + e));
}

function spanText(block, cls) {
    const marker = 'class="' + cls + '"';
    const p = (block || "").indexOf(marker);
    if (p < 0) return "";
    const after = block.slice(p);
    let s = after.indexOf(">");
    if (s < 0) return "";
    s += 1;
    let e = after.slice(s).indexOf("<");
    if (e < 0) e = after.length - s;
    return clean(after.slice(s, s + e));
}

function countText(block) {
    const p = (block || "").indexOf('class="count"');
    if (p < 0) return "";
    const after = block.slice(p);
    let s = after.indexOf(">");
    if (s < 0) return "";
    s += 1;
    const rest = after.slice(s);
    const end = rest.indexOf("</div>");
    const seg = end >= 0 ? rest.slice(0, end) : rest;
    const b = seg.indexOf("<b>");
    if (b >= 0) {
        const s2 = b + 3;
        const e2 = seg.slice(s2).indexOf("</b>");
        if (e2 >= 0) return clean(seg.slice(s2, s2 + e2));
    }
    return clean(seg);
}

// py _parse_cards: split on <article class="card".
function parseCards(html) {
    const out = [];
    const blocks = (html || "").split('<article class="card"').slice(1);
    for (let block of blocks) {
        const end = block.indexOf("</article>");
        if (end >= 0) block = block.slice(0, end);
        const m = /href="\/drama\/(\d+)\.html"/.exec(block);
        if (!m) continue;
        const vid = m[1];
        const title = tagText(block, "h3");
        if (!title) continue;
        const cover = fixUrl(attr(block, "src"));
        const bits = [];
        for (const v of [spanText(block, "card-score"), spanText(block, "heat"), countText(block)]) {
            if (v) bits.push(v);
        }
        const item = {id: vid, title: title, remarks: bits.join(" · "), tags: []};
        if (cover) item.cover = cover;
        out.push(item);
    }
    return out;
}

function catalogUrl(tid, pg) {
    if (tid === "home" || tid === "") {
        return pg <= 1 ? (HOST + "/index.html") : (HOST + "/page/" + pg + ".html");
    }
    const base = HOST + "/category/" + tid + ".html";
    return pg <= 1 ? base : (HOST + "/category/" + tid + "-p" + pg + ".html");
}

function normPg(pg) {
    const n = parseInt(pg, 10);
    return isFinite(n) && n >= 1 ? n : 1;
}

// ---------- idj1 contract ----------

async function home() {
    const html = await getText(catalogUrl("home", 1), HOST + "/");
    return {
        categories: CATS.map(pair => ({id: pair[0], name: pair[1]})),
        items: parseCards(html),
        hasMore: false,
    };
}

async function category(arg) {
    const pg = normPg(arg && arg.page);
    let tid = str(arg && arg.id) || "home";
    if (!CATS.some(pair => pair[0] === tid)) tid = "home";
    const html = await getText(catalogUrl(tid, pg), HOST + "/");
    const items = parseCards(html);
    // py reports pagecount 0 (unknown); hasMore approximated by a full page.
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const pg = normPg(arg && arg.page);
    const keyword = str(arg && arg.keyword);
    let html = await getText(HOST + "/search/" + encodeURIComponent(keyword) + ".html", HOST + "/");
    const p = html.indexOf('<div class="cards t4-list">');
    if (p >= 0) {
        const rest = html.slice(p);
        const end = rest.indexOf("<section");
        if (end >= 0) html = rest.slice(0, end);
    }
    const items = parseCards(html);
    return {items: items, hasMore: false, page: pg};
}

async function detail(arg) {
    const nid = str(arg && arg.id).replace(/^hgtvim:/, "").split(":")[0];
    if (!nid) throw host.error("E_PARSE", "missing id");
    const html = await getText(HOST + "/drama/" + nid + ".html", HOST + "/");
    let title = jld(html, "name") || og(html, "og:title");
    const cut = title.indexOf(" - 黄果TV");
    if (cut >= 0) title = title.slice(0, cut);
    title = clean(title);
    if (!title) throw host.error("E_PARSE", "detail has no title");
    const cover = fixUrl(jld(html, "image") || og(html, "og:image"));
    const desc = clean(jld(html, "description") || metaName(html, "description") || og(html, "og:description"));
    const genre = clean(jld(html, "genre"));
    const seen = new Set();
    let eps = [];
    const watchRe = /href="\/watch\/(\d+)_(\d+)\.html"/g;
    let m;
    while ((m = watchRe.exec(html)) !== null) {
        if (m[1] === nid) {
            const n = parseInt(m[2], 10);
            if (!seen.has(n)) { seen.add(n); eps.push(n); }
        }
    }
    if (!eps.length) {
        const epRe = /"episodeNumber":(\d+)/g;
        while ((m = epRe.exec(html)) !== null) {
            const n = parseInt(m[1], 10);
            if (!seen.has(n)) { seen.add(n); eps.push(n); }
        }
    }
    if (!eps.length) {
        const tm = /"numberOfEpisodes":(\d+)/.exec(html);
        if (tm) {
            const total = parseInt(tm[1], 10);
            if (total > 0) eps = Array.from({length: total}, (_, i) => i + 1);
        }
    }
    if (!eps.length) eps = [1];
    eps.sort((a, b) => a - b);
    const episodes = eps.map(n => ({id: "hgtvim:" + nid + ":" + n, name: "第" + n + "集"}));
    const out = {
        id: nid,
        title: title,
        desc: desc,
        tags: genre ? [genre] : [],
        remarks: genre ? (genre + " · 共 " + eps.length + " 集") : ("共 " + eps.length + " 集"),
        lines: [{name: "在线播放", episodes: episodes}],
    };
    if (cover) out.cover = cover;
    return out;
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (!raw) throw host.error("E_PARSE", "missing episode id");
    if (raw.indexOf(".m3u8") >= 0 || raw.indexOf(".mp4") >= 0) {
        if (raw.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https");
        return {streams: [{url: raw, format: raw.indexOf(".m3u8") >= 0 ? "hls" : "mp4", headers: {"User-Agent": UA, "Referer": HOST + "/"}, name: "黄果短剧HGTV"}]};
    }
    const parts = raw.replace(/^hgtvim:/, "").split(":");
    const sid = parts[0] || "";
    let ep = parseInt(parts[1], 10);
    if (!isFinite(ep)) ep = 1;
    if (!sid) throw host.error("E_PARSE", "missing series id");
    const watchUrl = HOST + "/watch/" + sid + "_" + ep + ".html";
    const watchHtml = await getText(watchUrl, HOST + "/");
    let playPath = "/play/" + sid + "_" + ep + ".html";
    const dm = /data-src="([^"]+)"/.exec(watchHtml || "");
    if (dm && dm[1]) playPath = dm[1];
    const playUrl = fixUrl(playPath);
    const streamHeaders = {"User-Agent": UA, "Referer": watchUrl};
    let streamUrl = "";
    let isHls = true;
    try {
        const resp = await host.http.get(playUrl, {
            headers: {"User-Agent": UA, "Accept": "application/vnd.apple.mpegurl, */*", "Referer": watchUrl},
            timeout: TIMEOUT,
        });
        const final = resp.url || playUrl;
        const body = resp.body || "";
        if (final.indexOf(".m3u8") >= 0 || final.indexOf(".mp4") >= 0) {
            streamUrl = final;
            isHls = final.indexOf(".m3u8") >= 0;
        } else if (body.replace(/^\s+/, "").indexOf("#EXTM3U") === 0) {
            // Inline playlist: pre-resolve a master to its first variant.
            streamUrl = playUrl;
            if (body.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const lines = body.split(/\r?\n/).map(s => s.trim());
                for (const line of lines) {
                    if (line && line.charAt(0) !== "#") {
                        streamUrl = host.url.resolve(playUrl, line);
                        break;
                    }
                }
            }
        } else {
            const m2 = /https?:\/\/[^\s"'<>]+\.m3u8/.exec(body);
            if (m2) streamUrl = m2[0];
        }
    } catch (error) {
        host.log("hgtvim play fetch failed", playUrl, String(error && error.message));
    }
    if (!streamUrl) streamUrl = playUrl;
    if (streamUrl.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https: " + streamUrl.slice(0, 80));
    // If play() did not already see the playlist body, pre-resolve a master.
    if (isHls && streamUrl === playUrl) {
        // already handled inline above when the body was a playlist
    } else if (isHls) {
        try {
            const resp = await host.http.get(streamUrl, {headers: streamHeaders, timeout: TIMEOUT});
            const text = resp.body || "";
            if ((resp.status === 200 || resp.status === 206) && text.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const lines = text.split(/\r?\n/).map(s => s.trim());
                for (const line of lines) {
                    if (line && line.charAt(0) !== "#") {
                        streamUrl = host.url.resolve(streamUrl, line);
                        break;
                    }
                }
            }
        } catch (error) {
            host.log("hgtvim resolveMaster failed", streamUrl, String(error && error.message));
        }
    }
    return {
        streams: [{
            url: streamUrl,
            format: isHls ? "hls" : "mp4",
            headers: streamHeaders,
            name: "黄果短剧HGTV",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
