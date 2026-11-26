// hongluo - idj1 plugin (rewritten from the built-in py spider hongluo)
// Site: https://hongluo.co - catalog JSON API + series HTML pages, no login.
// Categories are 1:1 with the py spider (10 entries, api genre in traditional
// Chinese mapped to the display id/name). The py spider has no extra flag
// filter, so none is added. Timeout 60s, 3 attempts (slow site).

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const HOST = "https://hongluo.co";

const CATS = [
    {id: "all", name: "全部", api: ""},
    {id: "xianxia-fantasy", name: "仙侠玄幻", api: "仙俠玄幻"},
    {id: "urban-romance", name: "都市情感", api: "都市情感"},
    {id: "fantasy-superpowers", name: "奇幻异能", api: "奇幻異能"},
    {id: "costume-palace", name: "古装宫廷", api: "古裝宮廷"},
    {id: "mystery-crime", name: "悬疑犯罪", api: "懸疑犯罪"},
    {id: "college-life", name: "大学校园", api: "大學校園"},
    {id: "family-drama", name: "家庭剧情", api: "家庭劇情"},
    {id: "workplace-business", name: "职场商战", api: "職場商戰"},
    {id: "supernatural-thriller", name: "灵异惊悚", api: "靈異驚悚"},
];

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }
function normPg(pg) { const n = intValue(pg, 1); return n >= 1 ? n : 1; }
function normId(ids) {
    if (Array.isArray(ids)) ids = ids.length ? ids[0] : "";
    return str(ids).trim();
}
function stripTags(s) {
    if (!s) return "";
    let t = str(s).replace(/<[^>]+>/g, " ");
    t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
    return t.replace(/\s+/g, " ").trim();
}
function absUrl(u) {
    u = str(u).trim().replace(/&amp;/g, "&");
    if (!u) return "";
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    if (u.startsWith("/")) return HOST + u;
    return HOST + "/" + u;
}
function coverOf(poster) {
    const u = absUrl(poster);
    if (!u) return u;
    return u + (u.indexOf("?") >= 0 ? "&w=240" : "?w=240");
}
function apiCategory(cid) {
    for (let i = 0; i < CATS.length; i++) if (CATS[i].id === cid) return CATS[i].api;
    return "";
}
function displayGenre(apiGenre) {
    for (let i = 0; i < CATS.length; i++) if (CATS[i].api === apiGenre) return CATS[i].name;
    return apiGenre || "";
}
function catalogUrl(cid) {
    const api = apiCategory(cid);
    if (!api) return HOST + "/api/catalog";
    return HOST + "/api/catalog?category=" + encodeURIComponent(api);
}

async function httpGet(url, accept) {
    const headers = {"User-Agent": UA, "Accept": accept || "application/json", "Referer": HOST + "/zh-hans/"};
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp && resp.body) return resp.body;
            if (resp) return resp.body || "";
        } catch (e) { lastErr = e; }
    }
    if (lastErr) throw lastErr;
    return "";
}
async function getJson(url) {
    try {
        const txt = await httpGet(url, "application/json");
        return JSON.parse(txt || "{}");
    } catch (e) { return {}; }
}
async function getHtml(url) {
    try { return await httpGet(url, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"); }
    catch (e) { return ""; }
}

function parseSeriesItems(data) {
    const out = [];
    const series = data && Array.isArray(data.series) ? data.series : null;
    if (!series) return out;
    for (let i = 0; i < series.length; i++) {
        const s = series[i];
        const slug = str(s.slug || "").trim();
        if (!slug) continue;
        const title = s.originalTitle || s.title || "";
        if (!title) continue;
        const cover = coverOf(s.posterUrl || "");
        const genre = displayGenre(s.category || "");
        const total = s.totalEpisodes || 0;
        const free = s.freeEpisodes || 0;
        const bits = [];
        if (genre) bits.push(genre);
        if (total) bits.push(total + "集");
        if (free) bits.push("免费" + free + "集");
        out.push({id: slug, title: str(title), cover: cover, remarks: bits.join(" · "), duration: "", tags: genre ? [genre] : []});
    }
    return out;
}

async function home() {
    const data = await getJson(catalogUrl("all"));
    const items = parseSeriesItems(data);
    return {categories: CATS.map(c => ({id: c.id, name: c.name})), items: items, hasMore: false};
}

async function category(arg) {
    const pg = normPg(arg && arg.page);
    if (pg > 1) return {items: [], hasMore: false, page: pg, pagecount: 0};
    const tid = normId(arg && arg.id) || "all";
    const data = await getJson(catalogUrl(tid));
    const items = parseSeriesItems(data);
    return {items: items, hasMore: false, page: pg, pagecount: 0};
}

async function search(arg) {
    const pg = normPg(arg && arg.page);
    const key = str(arg && arg.keyword);
    const data = await getJson(HOST + "/api/catalog?q=" + encodeURIComponent(key));
    const items = parseSeriesItems(data);
    return {items: items, hasMore: false, page: pg, pagecount: 0};
}

async function detail(arg) {
    const nid = normId(arg && arg.id);
    if (!nid) throw host.error("E_PARSE", "empty id");
    const html = await getHtml(HOST + "/zh-hans/series/" + encodeURIComponent(nid));
    let title = "";
    let m = /<h1[^>]*>([^<]+)<\/h1>/.exec(html || "");
    if (m) title = stripTags(m[1]);
    if (!title) {
        const p = (html || "").indexOf("<title>");
        if (p >= 0) {
            const after = html.slice(p + 7);
            const e = after.indexOf("</title>");
            if (e >= 0) {
                title = stripTags(after.slice(0, e));
                const seps = ["｜", "|"];
                for (let i = 0; i < seps.length; i++) {
                    const q = title.indexOf(seps[i]);
                    if (q >= 0) { title = title.slice(0, q).trim(); break; }
                }
            }
        }
    }
    if (!title) throw host.error("E_PARSE", "detail title not found");
    let cover = "";
    m = /property="og:image" content="([^"]+)"/.exec(html || "");
    if (m) cover = m[1];
    let desc = "";
    m = /name="description" content="([^"]*)"/.exec(html || "");
    if (m) desc = m[1];
    let genre = "";
    m = /"genre":"([^"]+)"/.exec(html || "");
    if (m) genre = displayGenre(m[1]);
    const eps = [];
    const seen = {};
    let freeCount = 0;
    const epRe = /<a href="[^"]*\/ep-(\d+)">第\s*\d+\s*集：([^<]+)<\/a>\s*·\s*<!-- -->([^<]+)<!-- -->\s*·\s*约\s*(\d+)\s*分钟/g;
    let cap;
    while ((cap = epRe.exec(html || "")) !== null) {
        const n = intValue(cap[1], 0);
        if (!n || seen[n]) continue;
        seen[n] = true;
        const epTitle = cap[2].trim();
        const access = cap[3].trim();
        const minutes = intValue(cap[4], 0);
        const isFree = access.indexOf("免费") >= 0;
        if (isFree) freeCount += 1;
        let label = "第" + n + "集：" + epTitle;
        if (minutes > 0) label += "·约" + minutes + "分钟";
        if (!isFree) label += "·VIP";
        eps.push({n: n, id: nid + ":" + n, name: label});
    }
    eps.sort((a, b) => a.n - b.n);
    if (!eps.length) eps.push({n: 1, id: nid + ":1", name: "第1集"});
    const bits = [];
    if (genre) bits.push(genre);
    bits.push("共 " + eps.length + " 集");
    if (freeCount > 0) bits.push("免费 " + freeCount + " 集");
    return {
        id: nid, title: title, cover: cover, desc: desc,
        year: "", area: "", remarks: bits.join(" · "),
        actor: "", director: "", tags: genre ? [genre] : [],
        lines: [{name: "在线播放", episodes: eps.map(e => ({id: e.id, name: e.name}))}],
    };
}

async function play(arg) {
    const raw = normId((arg && arg.episodeId) || (arg && arg.id));
    const header = {"User-Agent": UA, "Referer": HOST + "/zh-hans/"};
    if (raw.indexOf(".mp4") >= 0) {
        return {streams: [{url: raw, format: "video", headers: header, name: "红裸短剧"}], expiresAt: Date.now() + 3600 * 1000};
    }
    let sid = raw, ep = 1;
    const ci = raw.indexOf(":");
    if (ci >= 0) { sid = raw.slice(0, ci); ep = intValue(raw.slice(ci + 1), 1); }
    if (!sid) throw host.error("E_PARSE", "empty series id");
    const epUrl = HOST + "/zh-hans/series/" + encodeURIComponent(sid) + "/ep-" + ep;
    const html = await getHtml(epUrl);
    let src = "";
    let m = /<video[^>]*src="([^"]+)"/.exec(html || "");
    if (m) src = m[1];
    if (!src) {
        m = /"contentUrl":"([^"]+)"/.exec(html || "");
        if (m) src = m[1];
    }
    // The seo-video mp4 in the page is a placeholder (404 on fetch). The real
    // stream is granted by /api/play/<ep_id>; ep_id comes from that mp4 name.
    // Fallback: /api/series/<slug> episode list (canWatch) -> same grant call.
    // Final fallback keeps the page mp4, matching the base spider behaviour.
    let url = "";
    let epId = "";
    if (src) {
        const em = /ep_[a-z0-9]+_\d+/.exec(src);
        if (em) epId = em[0];
    }
    if (epId) {
        const grant = await getJson(HOST + "/api/play/" + epId);
        if (grant && typeof grant.url === "string" && grant.url.startsWith("http")) url = grant.url;
    }
    if (!url && !epId) {
        const data = await getJson(HOST + "/api/series/" + encodeURIComponent(sid));
        const eps = data && data.series && Array.isArray(data.series.episodes) ? data.series.episodes : [];
        let can = false;
        for (let i = 0; i < eps.length; i++) {
            if (intValue(eps[i].number, 0) === ep) {
                epId = str(eps[i].id || "");
                can = !!eps[i].canWatch;
                break;
            }
        }
        if (epId && can) {
            const grant = await getJson(HOST + "/api/play/" + epId);
            if (grant && typeof grant.url === "string" && grant.url.startsWith("http")) url = grant.url;
        }
    }
    if (!url) url = absUrl(src);
    if (!url) throw host.error("E_PARSE", "play source not found");
    const isHls = /\.m3u8($|\?)/i.test(url);
    if (isHls) {
        try {
            const pl = await httpGet(url, "*/*");
            if (pl && pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const lines = pl.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
                if (lines.length) url = host.url.resolve(url, lines[0]);
            }
        } catch (e) { /* keep master playlist */ }
    }
    return {streams: [{url: url, format: isHls ? "hls" : "video", headers: {"User-Agent": UA, "Referer": epUrl}, name: "红裸短剧"}], expiresAt: Date.now() + 3600 * 1000};
}

export default {home: home, category: category, search: search, detail: detail, play: play};
