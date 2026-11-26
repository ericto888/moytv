// AI污短剧 — idj1 插件（由内置 py 蜘蛛 aiwu.py 改写）
// 站点：https://aiwu.ai-wu.cc（HTML 直取，无登录、无签名）
// 播放：播放页里有 "url":"<id>|<ep>"，调 /huangguo.php?ac=play&id=&ep=
// 返回 JSON {code:1, url:"/huangguo.php?ac=media&t=..."}，拼主机即 m3u8 直链。
// 本站经本机出口很慢（单请求 20–55 秒），超时放宽到 60 秒、失败重试 2 次。

const HOST = "https://aiwu.ai-wu.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

// 与原 py 完全一致的 4 个分类（type_id 原样），不删减不合并。
const CATEGORIES = [
    {id: "aidj/crdj", name: "AI成人短剧"},
    {id: "aidj/crmj", name: "AI成人漫剧"},
    {id: "aidj/aihl", name: "AI换脸"},
    {id: "aidj/aimg", name: "AI魔改"},
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

// 对齐原 py _abs。
function abs(url) {
    if (!url) return "";
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.charAt(0) === "/") return HOST + url;
    return url;
}

// 对齐原 py _fetch：多次尝试取最长的一份；含 </html> 即认定完整。
async function fetchText(url, referer) {
    let best = "";
    let lastError = null;
    for (let i = 0; i < 2; i++) {
        try {
            const resp = await host.http.get(url, {
                headers: {
                    "User-Agent": UA,
                    "Referer": referer || (HOST + "/"),
                    "Accept": "text/html,application/xhtml+xml,*/*",
                },
                timeout: TIMEOUT,
            });
            if (resp.status < 200 || resp.status >= 300) {
                lastError = new Error("HTTP " + resp.status);
                continue;
            }
            const text = str(resp.body);
            if (text.length > best.length) best = text;
            if (text.indexOf("</html>") >= 0) return text;
        } catch (error) {
            lastError = error;
        }
    }
    if (best) return best;
    throw lastError || new Error("页面拉取失败");
}

// 对齐原 py _cards：nf-card 锚点取 /detail/<id>/、nf-card-title、img、nf-badge。
function parseCards(html) {
    const cards = [];
    const seen = {};
    const re = /<a class="nf-card"[^>]*href="\/detail\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const vid = "detail/" + m[1];
        if (seen[vid]) continue;
        const block = m[2];
        const tm = /class="nf-card-title">([^<]+)<\/div>/.exec(block);
        if (!tm) continue;
        seen[vid] = true;
        const im = /<img[^>]+src="([^"]+)"/.exec(block);
        const rm = /class="nf-badge">([^<]+)</.exec(block);
        cards.push({
            id: vid,
            title: tm[1].trim(),
            cover: im ? abs(im[1]) : "",
            remarks: rm ? rm[1].trim() : "",
            duration: "",
            tags: [],
        });
    }
    return cards;
}

function pageCount(html, cur) {
    let max = cur;
    const re = /\/page\/(\d+)\//g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const n = parseInt(m[1], 10);
        if (isFinite(n) && n > max) max = n;
    }
    return max;
}

function pageUrl(path, page) {
    const base = HOST + "/" + path.replace(/^\/+|\/+$/g, "") + "/";
    if (page <= 1) return base;
    return base + "page/" + page + "/";
}

async function home() {
    let items = [];
    try {
        const html = await fetchText(HOST + "/browse/");
        items = parseCards(html).slice(0, 30);
    } catch (error) {
        items = [];
    }
    return {categories: CATEGORIES, items: items, hasMore: items.length >= 30};
}

async function category(arg) {
    const tid = str(arg && arg.id) || "aidj/crdj";
    const page = Math.max(1, intValue(arg && arg.page, 1));
    let items = [];
    let total = page;
    try {
        const html = await fetchText(pageUrl(tid, page));
        items = parseCards(html);
        total = pageCount(html, page);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: page < total};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let items = [];
    try {
        const url = HOST + "/search/-------------/?wd=" + encodeURIComponent(keyword);
        const html = await fetchText(url);
        items = parseCards(html);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const vid = str(arg && arg.id).replace(/^\/+|\/+$/g, "");
    if (!vid) throw new Error("无效的影片 ID");
    const url = HOST + "/" + vid + "/";
    const html = await fetchText(url);
    const tm = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);
    const title = tm ? tm[1].trim() : vid;
    const pm = /property="og:image" content="([^"]+)"/.exec(html);
    const dm = /meta name="description" content="([^"]+)"/.exec(html);
    const episodes = [];
    const seen = {};
    const re = /href="(\/play\/\d+-1-\d+\/)"[^>]*>([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (seen[m[1]]) continue;
        seen[m[1]] = true;
        const nm = /-(\d+)\/?$/.exec(m[1]);
        episodes.push({
            id: m[1].replace(/^\/+|\/+$/g, ""),
            name: nm ? "第" + nm[1] + "集" : (m[2].trim() || "正片"),
        });
    }
    if (!episodes.length) episodes.push({id: vid, name: "正片"});
    return {
        id: vid,
        title: title,
        cover: pm ? abs(pm[1]) : "",
        desc: dm ? dm[1].trim() : "",
        tags: [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
}

async function play(arg) {
    const epId = str((arg && arg.episodeId) || (arg && arg.id)).replace(/^\/+|\/+$/g, "");
    if (!epId) throw new Error("无效的播放 ID");
    if (/\.m3u8($|\?)/i.test(epId)) {
        return {
            streams: [{url: epId, format: "hls", headers: {"User-Agent": UA, "Referer": HOST + "/"}, name: "在线播放"}],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const page = HOST + "/" + epId + "/";
    const html = await fetchText(page, HOST + "/");
    const m = /"url":"(\d+)\|(\d+)"/.exec(html);
    if (!m) throw new Error("播放页未找到播放令牌");
    const api = HOST + "/huangguo.php?ac=play&id=" + m[1] + "&ep=" + m[2];
    const resp = await host.http.get(api, {
        headers: {
            "User-Agent": UA,
            "Referer": page,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/plain, */*",
        },
        timeout: TIMEOUT,
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error("播放接口 HTTP " + resp.status);
    let data;
    try {
        data = JSON.parse(str(resp.body));
    } catch (error) {
        throw new Error("播放接口响应不是 JSON");
    }
    if (!data || data.code !== 1 || !data.url) throw new Error("播放接口未返回地址");
    const streamUrl = abs(HOST + str(data.url));
    return {
        streams: [{
            url: streamUrl,
            format: "hls",
            headers: {"User-Agent": UA, "Referer": page},
            name: "在线播放",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
