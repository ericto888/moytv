// JPTT - idj1 plugin (rewritten from built-in py spider jptt)
// Site: https://jptt.tv ; HTML pages, detail page carries an m3u8 source.

const BASE = "https://jptt.tv";
const UA = "Mozilla/5.0 (Linux; Android 14; HarmonyOS; HUAWEI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    ["t7", "720p", "tid", "7"],
    ["t15", "巨乳", "tid", "15"],
    ["t3", "AV女優片", "tid", "3"],
    ["t2", "中出", "tid", "2"],
    ["t21", "HD", "tid", "21"],
    ["t471", "HD高畫質", "tid", "471"],
    ["t9", "素人", "tid", "9"],
    ["t278", "中文", "tid", "278"],
    ["t16", "人妻", "tid", "16"],
    ["t212", "無碼片", "tid", "212"],
    ["t95", "熟女", "tid", "95"],
    ["t34", "口交", "tid", "34"],
    ["f93", "瑪丹娜", "fid", "93"],
    ["f1", "SOD", "fid", "1"],
    ["f31", "MOODYZ", "fid", "31"],
    ["f1203", "FC2高清版", "fid", "1203"],
    ["f2", "HMN WORKS", "fid", "2"],
];

const CATMAP = {};
for (const c of CATS) CATMAP[c[0]] = [c[2], c[3]];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function headers(referer) {
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": referer || (BASE + "/"),
    };
}

async function getText(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(referer), timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
            if (resp.body) return resp.body;
            lastError = new Error("HTTP " + resp.status);
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

function unescapeHtml(s) {
    return String(s || "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
}

function cleanText(t) {
    if (!t) return "";
    return unescapeHtml(String(t).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function fixUrl(raw) {
    const u = str(raw);
    if (!u) return "";
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASE + u;
    return u;
}

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    const linkRe = /<a href="https?:\/\/jptt\.tv\/video\/([^"]+)">/g;
    let m;
    while ((m = linkRe.exec(html)) !== null) {
        const code = str(m[1]);
        if (!code || seen[code]) continue;
        const body = html.slice(m.index + m[0].length, m.index + m[0].length + 1500);
        let title = "";
        let cover = "";
        let im = body.match(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/);
        if (im) {
            cover = fixUrl(im[1]);
            title = unescapeHtml(str(im[2]));
        }
        if (!cover) {
            im = body.match(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"/);
            if (im) {
                title = unescapeHtml(str(im[1]));
                cover = fixUrl(im[2]);
            }
        }
        if (!title) {
            const hm = body.match(/<h[35][^>]*>([\s\S]*?)<\/h[35]>/);
            if (hm) title = unescapeHtml(cleanText(hm[1]));
        }
        if (!title) continue;
        const dm = body.match(/p_duration">([^<]+)</);
        const remark = dm ? str(dm[1]) : "";
        seen[code] = true;
        out.push({
            id: "/video/" + code,
            title: title,
            cover: cover,
            remarks: remark,
            duration: remark,
            tags: [],
        });
    }
    return out;
}

async function catalog(tid) {
    const entry = CATMAP[tid] || ["tid", "15"];
    const url = BASE + "/tag_list?" + entry[0] + "=" + entry[1];
    const html = await getTextSoft(url, BASE + "/");
    return parseCards(html);
}

async function home() {
    const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    const items = await catalog(CATS[0][0]);
    return {categories: categories, items: items, hasMore: false};
}

async function category(arg) {
    const tid = str(arg && arg.id) || CATS[0][0];
    const items = await catalog(tid);
    return {items: items, hasMore: false};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/search?kw=" + encodeURIComponent(keyword);
    const html = await getTextSoft(url, BASE + "/");
    return {items: parseCards(html), hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    if (!raw) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    let url;
    if (raw.startsWith("http")) url = raw;
    else if (raw.startsWith("/")) url = BASE + raw;
    else url = BASE + "/" + raw;
    const html = await getTextSoft(url, BASE + "/");
    if (!html) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    let title = "";
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (h1) title = unescapeHtml(cleanText(h1[1]));
    if (!title) {
        const og = html.match(/<meta property="og:title"[^>]*content="([^"]+)"/);
        if (og) title = unescapeHtml(str(og[1]));
    }
    let cover = "";
    const ogi = html.match(/<meta property="og:image"[^>]*content="([^"]+)"/);
    if (ogi) cover = fixUrl(ogi[1]);
    let synopsis = "";
    const desc = html.match(/<meta name="description"[^>]*content="([^"]+)"/);
    if (desc) synopsis = unescapeHtml(str(desc[1]));
    let m3u8 = "";
    const sm = html.match(/<source[^>]*data-src="([^"]+\.m3u8[^"]*)"/);
    if (sm) m3u8 = fixUrl(sm[1]);
    if (!title || !m3u8) return {id: raw, title: title || raw, cover: cover, desc: synopsis, tags: [], lines: []};
    return {
        id: raw,
        title: title,
        cover: cover,
        desc: synopsis,
        tags: [],
        lines: [{
            name: "在线播放",
            episodes: [{id: m3u8, name: "播放"}],
        }],
    };
}

async function resolveMaster(url, hdrs) {
    try {
        const resp = await host.http.get(url, {headers: hdrs, timeout: TIMEOUT});
        const text = resp && resp.body ? String(resp.body) : "";
        if (!text.includes("#EXTM3U")) return url;
        if (!text.includes("#EXT-X-STREAM-INF")) return url;
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
        if (!lines.length) return url;
        return new URL(lines[0], url).href;
    } catch (error) {
        return url;
    }
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (!raw.startsWith("http")) throw new Error("无效的播放 ID");
    const hdrs = {"User-Agent": UA, "Referer": BASE + "/"};
    const finalUrl = await resolveMaster(raw, hdrs);
    return {
        streams: [{
            url: finalUrl,
            format: "hls",
            headers: hdrs,
            name: "JPTT",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
