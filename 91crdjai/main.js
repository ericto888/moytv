// 91成人短剧 — idj1 plugin (ported 1:1 from the builtin py spider 91crdjai)
// Site: https://91crdjai.com, server-rendered HTML. Four fixed channels
// (duanju/manju/zhenrenju/shipin) exactly like the py CHANNELS; list cards,
// detail episodes and search reuse the py regexes verbatim.
// Play: the py regexed the play page for a "src" m3u8; the site now leaves
// "src" empty in the SSR HTML and fills it from
// POST /api/videos/{vid}/episodes/{ep}/playback (endpoint template is
// embedded in the play page as "playbackEndpoint"). play() tries the py
// page regexes first, then that POST ({} JSON body), and pre-resolves a
// master playlist to its first variant sub-playlist.
// Covers: the py served covers through localProxy because pic.qnlycc.cn
// bytes are AES-CBC encrypted (key/iv in crypto-worker.js); the plugin host
// has no binary fetch or image transform, so covers are handed out as the
// raw absolute URLs (same limitation as other ports of this py family).

const BASE = "https://91crdjai.com";
const UA = "Mozilla/5.0 (Linux; Android 14; HarmonyOS; HUAWEI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const TIMEOUT = 60000;

const CHANNELS = [
    ["duanju", "成人短剧"],
    ["manju", "成人漫剧"],
    ["zhenrenju", "真人剧"],
    ["shipin", "成人视频"],
];
const CH_RE = "(?:duanju|manju|zhenrenju|shipin)";
const BOILER = "本页提供剧情简介、作品资料、标签与完整选集，点击选集进入播放页。";

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function headers() {
    return {"User-Agent": UA, "Referer": BASE + "/"};
}

async function getText(url) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(), timeout: TIMEOUT});
            if (resp.status === 200 || resp.status === 206) return resp.body || "";
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw host.error("E_NETWORK", "请求失败 " + url + ": " + (lastError && lastError.message));
    return "";
}

async function postJson(url, bodyText) {
    let lastError = null;
    const h = headers();
    h["Content-Type"] = "application/json";
    h["Accept"] = "application/json";
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.post(url, bodyText, {headers: h, timeout: TIMEOUT});
            if (resp.status === 200 || resp.status === 206) return resp.body || "";
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw host.error("E_NETWORK", "请求失败 " + url + ": " + (lastError && lastError.message));
    return "";
}

// ---------- py helpers (_clean / _abs / _fix_url) ----------

function clean(t) {
    if (!t) return "";
    t = String(t).replace(/<[^>]+>/g, " ");
    t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
    t = t.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
    t = t.replace(/&#[xX]([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)));
    return t.replace(/\s+/g, " ").trim();
}

function absUrl(u) {
    if (!u) return "";
    u = String(u).trim();
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return BASE + u;
    return u;
}

function fixUrl(u) {
    if (!u) return "";
    u = String(u).replace(/&amp;/g, "&");
    u = u.replace(/\\u0026/g, "&").replace(/\\u002F/g, "/").replace(/\\u002f/g, "/");
    return u;
}

// ---------- cards (py _cards, verbatim pattern) ----------

function cards(src) {
    const out = [];
    const seen = new Set();
    const pat = new RegExp('<a[^>]*href="(/' + CH_RE + '/\\d+-[^"/]+/)"[^>]*>([\\s\\S]*?)</a>', "g");
    let m;
    while ((m = pat.exec(src || "")) !== null) {
        const path = m[1];
        if (seen.has(path)) continue;
        seen.add(path);
        const body = m[2];
        let name = "";
        const am = /alt="([^"]+)"/.exec(body);
        if (am) name = clean(am[1]);
        if (!name) continue;
        let pic = "";
        const pm = /(?<![-\w])data-src="([^"]+)"/.exec(body);
        if (pm) pic = absUrl(fixUrl(pm[1]));
        const item = {id: path, title: name, remarks: "", tags: []};
        if (pic) item.cover = pic;
        out.push(item);
    }
    return out;
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
            if (line && line.charAt(0) !== "#") {
                return host.url.resolve(url, line);
            }
        }
        return url;
    } catch (error) {
        host.log("91crdjai resolveMaster failed", url, String(error && error.message));
        return url;
    }
}

// ---------- idj1 contract ----------

async function home() {
    const src = await getText(BASE + "/");
    return {
        categories: CHANNELS.map(pair => ({id: pair[0], name: pair[1]})),
        items: cards(src),
        hasMore: false,
    };
}

async function category(arg) {
    let tid = str(arg && arg.id) || "duanju";
    if (["duanju", "manju", "zhenrenju", "shipin"].indexOf(tid) < 0) tid = "duanju";
    let pg = parseInt(arg && arg.page, 10);
    if (!isFinite(pg) || pg < 1) pg = 1;
    const url = pg === 1 ? (BASE + "/" + tid + "/") : (BASE + "/" + tid + "/page/" + pg + "/");
    const src = await getText(url);
    const items = cards(src);
    let pagecount = pg;
    const pageRe = new RegExp("/" + tid + "/page/(\\d+)/", "g");
    let pm;
    while ((pm = pageRe.exec(src)) !== null) {
        const n = parseInt(pm[1], 10);
        if (isFinite(n) && n > pagecount) pagecount = n;
    }
    return {items: items, hasMore: pg < pagecount};
}

async function search(arg) {
    let pg = parseInt(arg && arg.page, 10);
    if (!isFinite(pg) || pg < 1) pg = 1;
    // py: search only serves page 1.
    if (pg !== 1) return {items: [], hasMore: false};
    const keyword = str(arg && arg.keyword);
    const src = await getText(BASE + "/search/" + encodeURIComponent(keyword) + "/");
    return {items: cards(src), hasMore: false};
}

async function detail(arg) {
    const path = str(arg && arg.id);
    if (!path) throw host.error("E_PARSE", "missing id");
    const url = path.indexOf("http") === 0 ? path : (BASE + (path.charAt(0) === "/" ? path : "/" + path));
    const src = await getText(url);
    let name = "";
    let pic = "";
    const im = /<img[^>]*class="p-img"[^>]*>/.exec(src);
    if (im) {
        const tag = im[0];
        const am = /alt="([^"]+)"/.exec(tag);
        if (am) name = clean(am[1]);
        const pm = /(?<![-\w])data-src="([^"]+)"/.exec(tag);
        if (pm) pic = absUrl(fixUrl(pm[1]));
    }
    if (!name) {
        const tm = /<title[^>]*>([\s\S]*?)<\/title>/.exec(src);
        if (tm) name = clean(tm[1]).split(" - ")[0];
    }
    if (!name) throw host.error("E_PARSE", "detail has no title");
    let content = "";
    const dm = /<meta name="description"[^>]*content="([^"]+)"/.exec(src);
    if (dm) content = clean(dm[1]).split(BOILER).join("").trim();
    const bits = [];
    const sm = /<dt>状态<\/dt>\s*<dd>([\s\S]*?)<\/dd>/.exec(src);
    const jm = /<dt>集数<\/dt>\s*<dd>([\s\S]*?)<\/dd>/.exec(src);
    if (sm) bits.push(clean(sm[1]));
    if (jm) bits.push(clean(jm[1]));
    const remarks = bits.join(" ");
    let basePath = path.charAt(0) === "/" ? path : "/" + path;
    if (basePath.charAt(basePath.length - 1) !== "/") basePath += "/";
    const epPat = new RegExp('<a[^>]*href="(' + basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '\\d+/)"[^>]*>([\\s\\S]*?)</a>', "g");
    const seen = new Set();
    const eps = [];
    let em;
    while ((em = epPat.exec(src)) !== null) {
        const epUrl = em[1];
        const txt = clean(em[2]);
        if (!/^\d+$/.test(txt)) continue;
        if (seen.has(epUrl)) continue;
        seen.add(epUrl);
        eps.push([parseInt(txt, 10), epUrl]);
    }
    eps.sort((a, b) => a[0] - b[0]);
    const episodes = eps.map(pair => ({id: pair[1], name: "第" + pair[0] + "集"}));
    if (!episodes.length) throw host.error("E_PARSE", "detail has no episodes");
    const out = {
        id: path,
        title: name,
        desc: content,
        tags: [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
    if (pic) out.cover = pic;
    if (remarks) out.remarks = remarks;
    return out;
}

async function play(arg) {
    const ep = str((arg && arg.episodeId) || (arg && arg.id));
    if (!ep) throw host.error("E_PARSE", "missing episode id");
    const url = ep.indexOf("http") === 0 ? ep : (BASE + (ep.charAt(0) === "/" ? ep : "/" + ep));
    const streamHeaders = {"User-Agent": UA, "Referer": BASE + "/"};
    const src = await getText(url);
    let m3u8 = "";
    // py playerContent regex chain, verbatim order.
    let jm = /"src"\s*:\s*"([^"]*\.m3u8[^"]*)"/.exec(src);
    if (jm) m3u8 = fixUrl(jm[1]);
    if (!m3u8) {
        jm = /"src"\s*:\s*"([^"]+)"/.exec(src);
        if (jm) {
            const cand = fixUrl(jm[1]);
            if (cand.indexOf(".m3u8") >= 0) m3u8 = cand;
        }
    }
    if (!m3u8) {
        const all = src.match(/https?:\/\/[^\s"'<>]*\.m3u8[^\s"'<>]*/g) || [];
        for (const raw of all) {
            const cand = fixUrl(raw);
            if (cand.indexOf("hls") >= 0 || cand.indexOf("videos") >= 0) { m3u8 = cand; break; }
        }
        if (!m3u8 && all.length) m3u8 = fixUrl(all[0]);
    }
    // Site's current chain: SSR leaves "src" empty; the real stream comes
    // from the playback API whose template the page embeds as
    // "playbackEndpoint":"/api/videos/{vid}/episodes/__EP__/playback".
    if (!m3u8) {
        let endpoint = "";
        const em = /"playbackEndpoint"\s*:\s*"([^"]+)"/.exec(src);
        if (em) endpoint = fixUrl(em[1]);
        if (!endpoint) {
            const pm = /\/(?:duanju|manju|zhenrenju|shipin)\/(\d+)-[^/]+\/(\d+)\//.exec(ep);
            if (pm) endpoint = "/api/videos/" + pm[1] + "/episodes/__EP__/playback";
        }
        if (endpoint) {
            const epNumM = /\/(\d+)\/?$/.exec(ep);
            const epNum = epNumM ? epNumM[1] : "1";
            const apiUrl = BASE + endpoint.replace("__EP__", epNum);
            const body = await postJson(apiUrl, "{}");
            let data = null;
            try { data = JSON.parse(body); } catch (error) { data = null; }
            const streams = data && data.data && data.data.streams;
            if (streams) {
                m3u8 = fixUrl(str(streams.main) || str(streams.preview) || str(streams.hevc));
            }
        }
    }
    if (!m3u8) throw host.error("E_PARSE", "no m3u8 found for episode " + ep);
    if (m3u8.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https: " + m3u8.slice(0, 80));
    const finalUrl = await resolveMaster(m3u8, streamHeaders);
    return {
        streams: [{
            url: finalUrl,
            format: "hls",
            headers: streamHeaders,
            name: "91成人短剧",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
