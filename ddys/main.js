// 低端影视 — idj1 plugin (ported 1:1 from the builtin py spider ddys)
// Site: https://ddys.io (covers on https://img.ddys.io). The py only knows
// ddys.io; ddys.io sits behind a Cloudflare managed challenge that this
// egress (and the plugin sandbox, which cannot carry a clearance cookie)
// cannot pass, so page fetches fall back, path by path, to the official
// backup domains the site itself publishes on its homepage
// (ddys.cloud / ddys.fyi / ddys.ceo — same site, same paths, verified to
// return byte-identical API data). Item ids stay in the py canonical
// https://ddys.io/... form. When every host answers with the challenge
// page the fetch raises E_CF_REQUIRED, exactly like the host contract.
// Home items come from the JSON API /api/hot-movies, category pages are
// server-rendered HTML list pages (/{movie,series,variety,anime}[/page/N]),
// search uses /api/search-suggest, and detail pages carry the play sources
// inline as switchSource(<idx>, '<payload>', 'm3u8') calls. Exactly like
// the py, detail keeps a single line (在线播放) holding the episodes of the
// first source whose first episode answers a live m3u8 probe (falling back
// to the first source when none probes live).
// Play: an episode id is "ddys:<m3u8 url>" (the py vod_play_url form);
// playerContent in the py strips the prefix and hands the m3u8 out with
// parse=0. Here a master playlist (#EXT-X-STREAM-INF) is additionally
// pre-resolved to its first variant sub-playlist inside play.

const HOST = "https://ddys.io";
const SITE_HOSTS = ["ddys.io", "ddys.cloud", "ddys.fyi", "ddys.ceo"];
const IMG = "https://img.ddys.io";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATS = [
    ["home", "首页"],
    ["movie", "电影"],
    ["series", "剧集"],
    ["variety", "综艺"],
    ["anime", "动漫"],
];

const POSTER_RE = /<a href="\/movie\/([a-z0-9-]+)"[^>]*>\s*<img[^>]*src="([^"]+)"/g;
const TITLE_RE = /<h3[^>]*>\s*<a[^>]*>([^<]+)<\/a>/;
const META_RE = /(\d{4})\s*·\s*(电影|剧集|综艺|动漫)/;
const RATING_RE = /badge-top-right">\s*([\d.]+)/;
const SOURCE_RE = /switchSource\(\d+,\s*'([^']+)',\s*'([^']+)'\)/g;
const COVER_RE = /<img src="(https:\/\/img\.ddys\.(?:io|cloud|fyi|ceo)\/[^"]+)"/;
const DESC_RE = /<meta name="description" content="([^"]*)"/;
const TITLE_TAG_RE = /<title>([^<]+)<\/title>/;

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function normPg(pg) {
    const n = parseInt(pg, 10);
    return isFinite(n) && n >= 1 ? n : 1;
}

function unescapeHtml(s) {
    return String(s || "")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
}

function stripTags(s) {
    if (!s) return "";
    return unescapeHtml(String(s).replace(/<[^>]+>/g, "")).replace(/&nbsp;/g, " ").trim();
}

function headers(referer) {
    const h = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) h["Referer"] = referer;
    return h;
}

function isChallenge(body) {
    const t = String(body || "");
    return t.indexOf("Just a moment") >= 0 && t.indexOf("challenges.cloudflare.com") >= 0;
}

// py _http_get retries the one host up to 3 times and returns "" when every
// attempt fails. Here the attempts walk the site's own host list instead
// (ddys.io first, then its published backups): a Cloudflare challenge page
// or any other failure moves on to the next host, and when all hosts were
// challenged the error surfaces as E_CF_REQUIRED instead of empty data.
async function getText(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(referer), timeout: TIMEOUT});
            const body = resp.body || "";
            if (isChallenge(body)) return "";
            if (resp.status === 200 && body) return body;
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) host.log("ddys getText failed", url, String(lastError && lastError.message));
    return "";
}

let preferredHost = null;

async function fetchSite(path) {
    let challenged = 0;
    let lastError = null;
    const order = preferredHost
        ? [preferredHost].concat(SITE_HOSTS.filter(h => h !== preferredHost))
        : SITE_HOSTS;
    for (const siteHost of order) {
        const url = "https://" + siteHost + path;
        try {
            const resp = await host.http.get(url, {headers: headers("https://" + siteHost + "/"), timeout: TIMEOUT});
            const body = resp.body || "";
            if (isChallenge(body)) {
                challenged++;
                continue;
            }
            if (resp.status === 200 && body) {
                preferredHost = siteHost;
                return body;
            }
            lastError = new Error("HTTP " + resp.status + " from " + siteHost);
        } catch (error) {
            lastError = error;
        }
    }
    if (challenged === SITE_HOSTS.length) {
        throw host.error("E_CF_REQUIRED", "低端影视全部域名均返回 Cloudflare 人机校验页");
    }
    if (lastError) host.log("ddys fetchSite failed", path, String(lastError && lastError.message));
    return "";
}

function pathOf(url) {
    const t = String(url || "");
    const m = /^https?:\/\/[^/]+(\/.*)$/.exec(t);
    return m ? m[1] : t;
}

function absUrl(path) {
    if (!path) return "";
    if (path.indexOf("http") === 0) return path;
    if (path.charAt(0) === "/") return HOST + path;
    return HOST + "/" + path;
}

function coverOfSlug(slug) {
    return IMG + "/movies/" + slug + ".webp";
}

function slugOfUrl(url) {
    const t = String(url || "").replace(/\/+$/, "");
    return t.slice(t.lastIndexOf("/") + 1);
}

// ---------- list parsing (py _parse_list) ----------

function parseList(html) {
    const out = [];
    const seen = new Set();
    const text = html || "";
    POSTER_RE.lastIndex = 0;
    let m;
    while ((m = POSTER_RE.exec(text)) !== null) {
        const slug = m[1];
        if (seen.has(slug)) continue;
        seen.add(slug);
        const cover = m[2];
        const win = text.slice(m.index + m[0].length, m.index + m[0].length + 2000);
        const tm = TITLE_RE.exec(win);
        const title = tm ? stripTags(tm[1]) : "";
        if (!title) continue;
        let remark = "";
        const mm = META_RE.exec(win);
        if (mm) remark = mm[1] + " · " + mm[2];
        const rm = RATING_RE.exec(win);
        if (rm && rm[1] && rm[1] !== "0.0") remark = (remark + " " + rm[1]).trim();
        out.push({id: absUrl("/movie/" + slug), title: title, cover: cover, remarks: remark, tags: []});
    }
    return out;
}

// ---------- API items (py _parse_api_items) ----------

function parseApiItems(obj) {
    const out = [];
    const arr = (obj && typeof obj === "object" && Array.isArray(obj.data)) ? obj.data : [];
    for (const it of arr) {
        if (!it || typeof it !== "object") continue;
        const title = str(it.title);
        const url = str(it.url);
        if (!title || !url) continue;
        const slug = str(it.slug) || slugOfUrl(url);
        let year = it.year;
        year = (year == null || year === 0 || year === "0") ? "" : String(year);
        const typ = str(it.type);
        const rating = it.rating == null ? "" : String(it.rating);
        let remark = "";
        if (year) remark += year;
        if (typ) remark += (remark ? " · " : "") + typ;
        if (rating && rating !== "0.0") remark += (remark ? " " : "") + rating;
        out.push({id: absUrl(url), title: title, cover: coverOfSlug(slug), remarks: remark, tags: []});
    }
    return out;
}

function parseJson(text) {
    try {
        return JSON.parse(text || "{}");
    } catch (error) {
        return {};
    }
}

// ---------- sources (py _parse_source_payload / _parse_sources) ----------

function parseSourcePayload(payload, kind) {
    const out = [];
    if (kind !== "m3u8" || String(payload || "").indexOf(".m3u8") < 0) return out;
    const clean = String(payload).replace(/\\t/g, "");
    if (clean.indexOf("$") < 0) {
        const url = clean.trim();
        if (url.indexOf(".m3u8") >= 0) out.push({name: "正片", url: url});
        return out;
    }
    for (const part of clean.split("#")) {
        if (part.indexOf("$") < 0) continue;
        const idx = part.indexOf("$");
        const title = part.slice(0, idx).trim();
        const url = part.slice(idx + 1).trim();
        if (title && url.indexOf(".m3u8") >= 0) out.push({name: title, url: url});
    }
    return out;
}

function parseSources(html) {
    const sources = [];
    SOURCE_RE.lastIndex = 0;
    let m;
    const text = html || "";
    while ((m = SOURCE_RE.exec(text)) !== null) {
        const eps = parseSourcePayload(m[1], m[2]);
        if (eps.length) sources.push(eps);
    }
    return sources;
}

// py _m3u8_live: 200 and the body starts out as an m3u8 playlist.
async function m3u8Live(url, referer) {
    try {
        const resp = await host.http.get(url, {
            headers: {"User-Agent": UA, "Accept": "*/*", "Referer": referer},
            timeout: TIMEOUT,
        });
        if (resp.status !== 200) return false;
        return String(resp.body || "").indexOf("#EXTM3U") >= 0;
    } catch (error) {
        return false;
    }
}

// py _pick_source: first source whose first episode probes live, else first.
async function pickSource(sources, referer) {
    if (!sources.length) return [];
    for (const eps of sources) {
        if (eps.length && await m3u8Live(eps[0].url, referer)) return eps;
    }
    return sources[0];
}

function cleanDetailTitle(raw) {
    let t = str(raw);
    let p = t.indexOf("免费在线观看");
    if (p >= 0) t = t.slice(0, p).trim();
    p = t.indexOf(" - 低端影视");
    if (p >= 0) t = t.slice(0, p).trim();
    return t;
}

// ---------- catalog (py _catalog) ----------

async function catalog(tid, pg) {
    if (tid === "home") {
        const txt = await fetchSite("/api/hot-movies");
        return parseApiItems(parseJson(txt));
    }
    const path = pg <= 1 ? "/" + tid : "/" + tid + "/page/" + pg;
    const html = await fetchSite(path);
    return parseList(html);
}

// ---------- master playlist pre-resolve ----------

async function resolveMaster(url, streamHeaders) {
    try {
        const resp = await host.http.get(url, {headers: streamHeaders, timeout: TIMEOUT});
        if (resp.status !== 200 && resp.status !== 206) return url;
        const text = resp.body || "";
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/).map(s => s.trim());
        for (const line of lines) {
            if (line && line.charAt(0) !== "#") return host.url.resolve(url, line);
        }
        return url;
    } catch (error) {
        host.log("ddys resolveMaster failed", url, String(error && error.message));
        return url;
    }
}

// ---------- idj1 contract ----------

async function home() {
    const items = await catalog("home", 1);
    return {
        categories: CATS.map(pair => ({id: pair[0], name: pair[1]})),
        items: items,
        hasMore: false,
    };
}

async function category(arg) {
    const pg = normPg(arg && arg.page);
    const tid = str(arg && arg.id) || "home";
    const items = await catalog(tid, pg);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    const txt = await fetchSite("/api/search-suggest?q=" + encodeURIComponent(keyword));
    const items = parseApiItems(parseJson(txt)).slice(0, 60);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const nid = str(arg && arg.id);
    if (!nid) throw host.error("E_PARSE", "missing id");
    const html = await fetchSite(pathOf(nid));
    if (!html) throw host.error("E_NETWORK", "detail page fetch failed");
    const tm = TITLE_TAG_RE.exec(html);
    const title = tm ? cleanDetailTitle(tm[1]) : "";
    if (!title) throw host.error("E_PARSE", "detail has no title");
    const slug = slugOfUrl(nid);
    const cm = COVER_RE.exec(html);
    const cover = cm ? cm[1] : coverOfSlug(slug);
    const dm = DESC_RE.exec(html);
    const synopsis = dm ? stripTags(dm[1]).slice(0, 400) : "";
    const sources = parseSources(html);
    if (!sources.length) throw host.error("E_PARSE", "detail has no play sources");
    const eps = await pickSource(sources, nid);
    const episodes = eps.map(ep => ({id: "ddys:" + ep.url, name: ep.name}));
    const out = {
        id: nid,
        title: title,
        desc: synopsis,
        tags: [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
    if (cover) out.cover = cover;
    return out;
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("ddys:") === 0) raw = raw.slice(5);
    let url = "";
    if (raw.indexOf(".m3u8") >= 0) {
        url = raw.indexOf("$") >= 0 ? raw.slice(raw.lastIndexOf("$") + 1) : raw;
    } else if (raw.indexOf("http") === 0) {
        const html = await fetchSite(pathOf(raw));
        if (html) {
            const sources = parseSources(html);
            if (sources.length) {
                const eps = await pickSource(sources, raw);
                if (eps.length) url = eps[0].url;
            }
        }
    }
    if (!url) throw host.error("E_PARSE", "no stream url");
    if (url.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https");
    const streamHeaders = {"User-Agent": UA, "Referer": HOST + "/"};
    const isHls = /\.m3u8($|\?)/i.test(url);
    let finalUrl = url;
    if (isHls) finalUrl = await resolveMaster(url, streamHeaders);
    return {
        streams: [{
            url: finalUrl,
            format: isHls ? "hls" : "video",
            headers: streamHeaders,
            name: "低端影视",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
