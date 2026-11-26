// 黄果短剧 — idj1 plugin (ported 1:1 from the builtin py spider hgdj58)
// API site: five mirror origins (a2.hgdjap2.com .. a6.hgdjap6.com), JSON
// API under /api/v1. Guest login (POST /auth/guest) yields a Bearer token
// used when an API call answers 401/403, exactly like the py. Categories
// come from /categories with a fixed "推荐" (home) entry prepended, lists
// come from /dramas/home (optionally &category_id=), search from
// /dramas/search, detail from /dramas/{id} plus /dramas/{id}/episodes.
// Covers: cover_thumb_url / cover_url are API paths whose GET returns a
// descriptor JSON; routes[0].url is the real image URL (py _resolve_cover).
// Play: POST /episodes/{eid}/play?playback_client=pc, stream URL from
// media_routes[0].url / video_url / routes[0].url / url, master playlist
// pre-resolved to its first variant inside play().

const ORIGINS = [
    "https://a2.hgdjap2.com",
    "https://a3.hgdjap3.com",
    "https://a4.hgdjap4.com",
    "https://a5.hgdjap5.com",
    "https://a6.hgdjap6.com",
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H5_ORIGIN = "https://xn---176198876-wj2q194rql3bfw9g.hgdjh58.com";
const TIMEOUT = 60000;
const PAGE_SIZE = 30;

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function toInt(value, dflt) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : dflt;
}

// ---------- device id / token (py module globals, kept in storage) ----------

function deviceId() {
    let id = "";
    try { id = host.storage.get("deviceId") || ""; } catch (e) { id = ""; }
    if (id) return id;
    const hex = host.crypto.randomHex(16);
    id = hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) +
        "-a" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
    try { host.storage.set("deviceId", id); } catch (e) { /* ignore */ }
    return id;
}

function getToken() {
    try { return host.storage.get("token") || ""; } catch (e) { return ""; }
}

function setToken(t) {
    try { host.storage.set("token", t || ""); } catch (e) { /* ignore */ }
}

function headers(extra) {
    const h = {
        "Accept": "application/json",
        "X-Device-Id": deviceId(),
        "X-Client-Platform": "h5",
        "User-Agent": UA,
    };
    const token = getToken();
    if (token) h["Authorization"] = "Bearer " + token;
    if (extra) for (const k of Object.keys(extra)) h[k] = extra[k];
    return h;
}

// One raw request with retries; returns {status, body} and never throws on
// HTTP status (the py returns (status, text) the same way).
async function rawRequest(method, url, body) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            let resp;
            if (method === "POST") {
                resp = await host.http.post(url, body || "", {headers: headers({"Content-Type": "application/json"}), timeout: TIMEOUT});
            } else {
                resp = await host.http.get(url, {headers: headers(), timeout: TIMEOUT});
            }
            return {status: resp.status, body: resp.body || ""};
        } catch (error) {
            lastError = error;
        }
    }
    throw host.error("E_NETWORK", "请求失败 " + url + ": " + (lastError && lastError.message));
}

function parseJson(text) {
    try {
        const v = JSON.parse(text);
        return (v && typeof v === "object") ? v : {};
    } catch (e) {
        return {};
    }
}

// py _guest_login: POST each origin /api/v1/auth/guest until a token lands.
async function guestLogin() {
    const rkB64 = host.codec.convert(host.crypto.randomHex(32), "hex", "base64");
    const rk = rkB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const body = JSON.stringify({requestKey: rk, automatic: true, guestDeviceKey: deviceId()});
    for (const origin of ORIGINS) {
        let r;
        try {
            r = await rawRequest("POST", origin + "/api/v1/auth/guest", body);
        } catch (e) {
            continue;
        }
        if (r.status !== 200) continue;
        const v = parseJson(r.body);
        let token = str(v.token);
        if (!token && v.data && typeof v.data === "object") token = str(v.data.token);
        if (token) {
            setToken(token);
            return true;
        }
    }
    return false;
}

// py _api_get: walk origins (a network failure on one mirror falls
// through to the next, like the py's (0, "") return); on 401/403 do a
// guest login and retry once.
async function apiGet(path) {
    for (const origin of ORIGINS) {
        let r;
        try {
            r = await rawRequest("GET", origin + "/api/v1" + path);
        } catch (e) {
            continue;
        }
        if (r.status === 200) return parseJson(r.body);
        if (r.status === 401 || r.status === 403) {
            if (await guestLogin()) {
                try {
                    const r2 = await rawRequest("GET", origin + "/api/v1" + path);
                    if (r2.status === 200) return parseJson(r2.body);
                } catch (e) { /* next origin */ }
            }
        }
    }
    return {};
}

// py _api_post: same walk, returns {status, json, origin} (origin is the
// mirror that answered; play needs it to absolutize relative media paths).
async function apiPost(path, body) {
    let lastError = null;
    for (const origin of ORIGINS) {
        let r;
        try {
            r = await rawRequest("POST", origin + "/api/v1" + path, body || "");
        } catch (e) {
            lastError = e;
            continue;
        }
        if (r.status === 200) return {status: r.status, json: parseJson(r.body), origin: origin};
        if (r.status === 401 || r.status === 403) {
            if (await guestLogin()) {
                try {
                    const r2 = await rawRequest("POST", origin + "/api/v1" + path, body || "");
                    if (r2.status !== 0) return {status: r2.status, json: parseJson(r2.body), origin: origin};
                } catch (e) { lastError = e; }
            }
        }
    }
    if (lastError) throw lastError;
    return {status: 0, json: {}, origin: ORIGINS[0]};
}

function absolutize(u, origin) {
    if (!u) return "";
    if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) return u;
    return origin + (u.charAt(0) === "/" ? u : "/" + u);
}

// ---------- covers (py _descriptor_url / _resolve_cover) ----------

// The descriptor carries several routes for the same cover (R2 first,
// origin second, like the py's routes[0] choice). Some CDNs block some
// networks, so the first time a cover is resolved the routes are probed
// once and the first fetchable route index is cached for the process;
// the py default (routes[0]) is kept whenever probing finds nothing.
let coverRouteIdx = null;

async function probeCoverRoute(urls) {
    for (let i = 0; i < urls.length; i++) {
        try {
            const resp = await host.http.get(urls[i], {
                headers: {"User-Agent": UA, "Range": "bytes=0-15"},
                timeout: TIMEOUT,
            });
            if ((resp.status === 200 || resp.status === 206) && (resp.body || "").length > 0) return i;
        } catch (e) { /* try next route */ }
    }
    return 0;
}

async function descriptorUrl(v, origin) {
    const routes = (v && typeof v === "object") ? v.routes : null;
    if (!Array.isArray(routes) || !routes.length) return "";
    const urls = [];
    for (const r of routes) {
        if (r && typeof r === "object" && str(r.url)) urls.push(absolutize(str(r.url), origin));
    }
    if (!urls.length) return "";
    if (coverRouteIdx === null) {
        coverRouteIdx = await probeCoverRoute(urls);
    }
    const idx = Math.min(coverRouteIdx, urls.length - 1);
    return urls[idx];
}

async function resolveCover(thumb) {
    if (!thumb) return "";
    let path = String(thumb);
    if (path.indexOf("http://") === 0 || path.indexOf("https://") === 0) {
        // py treats the thumb as an API path; a full URL without the API
        // prefix can only be a direct image address, hand it out as-is.
        const idx = path.indexOf("/api/v1/");
        if (idx < 0) return path;
        path = path.slice(idx + "/api/v1".length);
    } else if (path.indexOf("/api/v1/") === 0) {
        path = path.slice("/api/v1".length);
    } else if (path.charAt(0) !== "/") {
        path = "/" + path;
    }
    for (const origin of ORIGINS) {
        let r;
        try {
            r = await rawRequest("GET", origin + "/api/v1" + path);
        } catch (e) {
            continue;
        }
        if (r.status === 200) {
            const u = await descriptorUrl(parseJson(r.body), origin);
            if (u) return u;
        }
    }
    return "";
}

// py _cards: build fields first, then resolve covers in parallel batches
// of 8 (the py used a thread pool of 8).
async function cards(items) {
    const fields = [];
    for (const v of items || []) {
        if (!v || typeof v !== "object") continue;
        const did = str(v.id);
        const title = str(v.title);
        if (!did || !title) continue;
        const thumb = v.cover_thumb_url || v.cover_url || "";
        const ep = toInt(v.episode_count, 0);
        fields.push({did: did, title: title, thumb: thumb, remark: ep > 0 ? (ep + "集") : ""});
    }
    const covers = new Array(fields.length).fill("");
    for (let i = 0; i < fields.length; i += 8) {
        const batch = fields.slice(i, i + 8);
        const got = await Promise.all(batch.map(f => resolveCover(f.thumb).catch(() => "")));
        for (let j = 0; j < batch.length; j++) covers[i + j] = got[j];
    }
    return fields.map((f, i) => {
        const item = {id: f.did, title: f.title, remarks: f.remark, tags: []};
        if (covers[i]) item.cover = covers[i];
        return item;
    });
}

// ---------- categories (py _categories, cached per process like the py) ----------

let catsCache = null;

async function categories() {
    if (catsCache) return catsCache;
    const v = await apiGet("/categories");
    const cats = [{id: "home", name: "推荐"}];
    const list = (v && Array.isArray(v.list)) ? v.list : [];
    for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const cid = str(item.id);
        const name = str(item.name);
        if (cid && name) cats.push({id: cid, name: name});
    }
    catsCache = cats;
    return cats;
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
        host.log("hgdj58 resolveMaster failed", url, String(error && error.message));
        return url;
    }
}

// ---------- idj1 contract ----------

async function home() {
    const cats = await categories();
    const v = await apiGet("/dramas/home?page=1&page_size=" + PAGE_SIZE + "&order=hot");
    const items = await cards((v && Array.isArray(v.list)) ? v.list : []);
    return {categories: cats, items: items, hasMore: false};
}

async function category(arg) {
    let pg = toInt(arg && arg.page, 1);
    if (pg < 1) pg = 1;
    const tid = str(arg && arg.id) || "home";
    let path = "/dramas/home?page=" + pg + "&page_size=" + PAGE_SIZE + "&order=hot";
    if (tid !== "home") path += "&category_id=" + encodeURIComponent(tid);
    const v = await apiGet(path);
    const items = await cards((v && Array.isArray(v.list)) ? v.list : []);
    const total = toInt(v && v.total, 0);
    const hasMore = total > 0 ? (pg * PAGE_SIZE < total) : (items.length >= PAGE_SIZE);
    return {items: items, hasMore: hasMore};
}

async function search(arg) {
    let pg = toInt(arg && arg.page, 1);
    if (pg < 1) pg = 1;
    const keyword = str(arg && arg.keyword);
    const v = await apiGet("/dramas/search?q=" + encodeURIComponent(keyword) + "&page=" + pg + "&page_size=" + PAGE_SIZE);
    const items = await cards((v && Array.isArray(v.list)) ? v.list : []);
    return {items: items, hasMore: items.length >= PAGE_SIZE};
}

function normId(value) {
    let s = str(value);
    if (s.indexOf("$") >= 0) {
        const tail = s.split("$")[1];
        if (tail) s = tail;
    }
    if (s.indexOf(",") >= 0) s = s.split(",")[0];
    return s.trim();
}

async function detail(arg) {
    const did = normId(arg && arg.id);
    if (!did) throw host.error("E_PARSE", "missing id");
    const v = await apiGet("/dramas/" + encodeURIComponent(did));
    if (!v || typeof v !== "object" || !str(v.title)) {
        throw host.error("E_PARSE", "detail has no title for id " + did);
    }
    const title = str(v.title);
    let synopsis = str(v.description);
    if (!synopsis) synopsis = title;
    const cover = await resolveCover(v.cover_url || v.cover_thumb_url || "");
    const catName = str(v.category);
    const tags = Array.isArray(v.tags) ? v.tags.map(t => str(t)).filter(t => t) : [];
    const epCount = toInt(v.episode_count, 0);
    const playCount = toInt(v.play_count, 0);
    let remark = "";
    if (epCount > 0) remark = epCount + "集";
    if (playCount > 0) remark = (remark ? remark + " | " : "") + playCount + "播放";
    let content = synopsis;
    if (catName) content += "\n分类：" + catName;
    if (tags.length) content += "\n标签：" + tags.join(" ");
    if (cover) content += "\n本片剧照：\n" + cover;
    const ev = await apiGet("/dramas/" + encodeURIComponent(did) + "/episodes");
    const episodes = [];
    const elist = (ev && Array.isArray(ev.list)) ? ev.list : [];
    for (const e of elist) {
        if (!e || typeof e !== "object") continue;
        const eid = str(e.id);
        if (!eid) continue;
        const number = toInt(e.number, 0);
        const etitle = str(e.title);
        let name;
        if (number === 0) name = "预告";
        else if (etitle) name = etitle;
        else name = "第" + number + "集";
        if (e.locked) {
            const access = str(e.access_type);
            const coin = toInt(e.coin_price, 0);
            if (access === "paid" && coin > 0) name += "（" + coin + "金币）";
            else name += "（VIP）";
        }
        // Episode id is self-contained: drama id + ":" + episode id,
        // exactly the tail of the py "name$did:eid" play string.
        episodes.push({id: did + ":" + eid, name: name});
    }
    if (!episodes.length) episodes.push({id: did + ":" + did, name: "正片"});
    const out = {
        id: did,
        title: title,
        desc: content,
        tags: tags,
        lines: [{name: "在线播放", episodes: episodes}],
    };
    if (cover) out.cover = cover;
    if (remark) out.remarks = remark;
    return out;
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (!raw) throw host.error("E_PARSE", "missing episode id");
    let url = raw;
    let ep = raw;
    if (raw.indexOf("$") >= 0) {
        const tail = raw.split("$")[1] || "";
        if (tail.indexOf("http") === 0) url = tail;
        else { url = ""; ep = tail; }
    }
    const streamHeaders = {"User-Agent": UA, "Referer": H5_ORIGIN + "/"};
    if (url.indexOf("http") === 0) {
        if (url.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https: " + url.slice(0, 80));
        const direct = await resolveMaster(url, streamHeaders);
        return {streams: [{url: direct, format: "hls", headers: streamHeaders, name: "黄果短剧"}]};
    }
    let eid = ep;
    if (eid.indexOf(":") >= 0) eid = eid.split(":")[1];
    const res = await apiPost("/episodes/" + encodeURIComponent(eid) + "/play?playback_client=pc", "");
    const v = res.json || {};
    // Candidate stream URLs in the py's priority order: media_routes in
    // listed order, then video_url, then routes, then url. The site now
    // hands them out as relative /api/v1 media paths, so each one is
    // absolutized against the mirror that answered the play call.
    const candidates = [];
    const pushCand = (u) => {
        const a = absolutize(str(u), res.origin);
        if (a && candidates.indexOf(a) < 0) candidates.push(a);
    };
    if (Array.isArray(v.media_routes)) {
        for (const r of v.media_routes) if (r && typeof r === "object") pushCand(r.url);
    }
    pushCand(v.video_url);
    if (Array.isArray(v.routes)) {
        for (const r of v.routes) if (r && typeof r === "object") pushCand(r.url);
    }
    pushCand(v.url);
    if (!candidates.length) {
        throw host.error("E_PARSE", "play returned no stream url (status " + res.status + ") for episode " + eid);
    }
    for (const cand of candidates) {
        if (cand.indexOf("https://") !== 0) {
            throw host.error("E_PARSE", "stream is not https: " + cand.slice(0, 80));
        }
    }
    // The routes differ only in the CDN that serves their segments, and a
    // CDN may block the current network while another passes: verify each
    // candidate's playlist plus first segment and take the first line
    // that fully passes. If none passes here, fall back to the py's first
    // candidate (another network may reach it).
    let firstResolved = "";
    for (const cand of candidates) {
        const resolved = await verifyLine(cand, streamHeaders);
        if (resolved && resolved.ok) {
            return {streams: [{url: resolved.url, format: "hls", headers: streamHeaders, name: "黄果短剧"}]};
        }
        if (resolved && resolved.url && !firstResolved) firstResolved = resolved.url;
    }
    const fallback = firstResolved || (await resolveMaster(candidates[0], streamHeaders));
    const isHls = /\.m3u8($|\?)/i.test(fallback);
    return {streams: [{url: fallback, format: isHls ? "hls" : "video", headers: streamHeaders, name: "黄果短剧"}]};
}

// Fetch a candidate playlist; when it is a master playlist resolve to the
// first variant (task rule), then Range-check the first segment.
// Returns {ok, url} — url is the (possibly variant-resolved) playlist.
async function verifyLine(url, streamHeaders) {
    let text = "";
    try {
        const resp = await host.http.get(url, {headers: streamHeaders, timeout: TIMEOUT});
        if (resp.status !== 200 && resp.status !== 206) return {ok: false, url: url};
        text = resp.body || "";
    } catch (e) {
        return {ok: false, url: url};
    }
    if (text.indexOf("#EXTM3U") < 0) return {ok: false, url: url};
    let playlistUrl = url;
    if (text.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const lines = text.split(/\r?\n/).map(s => s.trim());
        for (const line of lines) {
            if (line && line.charAt(0) !== "#") {
                playlistUrl = host.url.resolve(url, line);
                break;
            }
        }
        try {
            const resp2 = await host.http.get(playlistUrl, {headers: streamHeaders, timeout: TIMEOUT});
            if (resp2.status !== 200 && resp2.status !== 206) return {ok: false, url: playlistUrl};
            text = resp2.body || "";
            if (text.indexOf("#EXTM3U") < 0) return {ok: false, url: playlistUrl};
        } catch (e) {
            return {ok: false, url: playlistUrl};
        }
    }
    const segLine = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#")[0];
    if (!segLine) return {ok: false, url: playlistUrl};
    const segUrl = host.url.resolve(playlistUrl, segLine);
    try {
        const segHeaders = Object.assign({}, streamHeaders, {"Range": "bytes=0-1023"});
        const seg = await host.http.get(segUrl, {headers: segHeaders, timeout: TIMEOUT});
        const ok = (seg.status === 200 || seg.status === 206) && (seg.body || "").length > 0;
        return {ok: ok, url: playlistUrl};
    } catch (e) {
        return {ok: false, url: playlistUrl};
    }
}

export default {home: home, category: category, search: search, detail: detail, play: play};
