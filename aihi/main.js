// AIHI — idj1 插件（由内置 py 蜘蛛 aihi.py 改写）
// 站点：https://aihi.cc（MacCMS 结构，HTML 直取，无登录、无签名）
// 播放：播放页里有 "url":"<id>|<ep>"，调 /huangguo.php?ac=play&id=&ep=
// 返回 JSON {code:1, url:"/huangguo.php?ac=media&t=..."}，该地址直接吐 m3u8
// （AES-128 加密分片，key 与分片都是站内相对地址，同源拉取）。
// 本站经本机出口很慢（单请求 20–55 秒），超时放宽到 60 秒、失败重试 2 次。

const HOST = "https://aihi.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

// 与原 py 完全一致的 4 个分类，不删减不合并。
const CATEGORIES = [
    {id: "1", name: "AI成人短剧"},
    {id: "2", name: "AI成人漫剧"},
    {id: "3", name: "AI换脸"},
    {id: "4", name: "AI魔改"},
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

// 对齐原 py _abs：补协议/主机，并把多余的连续斜杠压成一个（冒号后的不动）。
function abs(url) {
    if (!url) return "";
    if (url.indexOf("//") === 0) url = "https:" + url;
    else if (url.charAt(0) === "/") url = HOST + url;
    return url.replace(/([^:])\/\/+/g, "$1/");
}

// 对齐原 py _fetch：最多 2 次尝试，取最长的一份；含 </html> 即认定完整。
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

// 对齐原 py _cards：按 /voddetail/<id>/ 锚点切窗取标题、封面、备注。
function parseCards(html) {
    const cards = [];
    const seen = {};
    const re = /href="\/voddetail\/(\d+)\/"/g;
    const matches = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        matches.push({id: m[1], start: m.index});
    }
    for (let i = 0; i < matches.length; i++) {
        const vid = "voddetail/" + matches[i].id;
        if (seen[vid]) continue;
        const end = i + 1 < matches.length ? matches[i + 1].start : matches[i].start + 2000;
        const win = html.slice(matches[i].start, Math.min(end, matches[i].start + 2000));
        let am = /<img[^>]+alt="([^"]+)"/.exec(win);
        if (!am) am = /title="([^"]+)"/.exec(win);
        if (!am) continue;
        seen[vid] = true;
        const im = /<img[^>]+src="([^"]+)"/.exec(win);
        const rm = /(更新至[^<]{0,20}集|完结|连载中)/.exec(win);
        cards.push({
            id: vid,
            title: am[1].trim(),
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
    const re = /\/vodtype\/\d+-(\d+)\//g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const n = parseInt(m[1], 10);
        if (isFinite(n) && n > max) max = n;
    }
    return max;
}

async function home() {
    let items = [];
    try {
        const html = await fetchText(HOST + "/home/");
        items = parseCards(html).slice(0, 30);
    } catch (error) {
        items = [];
    }
    return {categories: CATEGORIES, items: items, hasMore: items.length >= 30};
}

async function category(arg) {
    const tid = str(arg && arg.id) || "1";
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const url = page <= 1 ? HOST + "/vodtype/" + tid + "/" : HOST + "/vodtype/" + tid + "-" + page + "/";
    let items = [];
    let total = page;
    try {
        const html = await fetchText(url);
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
        const url = HOST + "/vodsearch/-------------.html?wd=" + encodeURIComponent(keyword);
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
    const re = /href="(\/vodplay\/\d+-1-\d+\/)"[^>]*>([^<]+)<\/a>/g;
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
        lines: [{name: "AIHI", episodes: episodes}],
    };
}

async function play(arg) {
    const epId = str((arg && arg.episodeId) || (arg && arg.id)).replace(/^\/+|\/+$/g, "");
    if (!epId) throw new Error("无效的播放 ID");
    if (/\.m3u8($|\?)/i.test(epId)) {
        return {
            streams: [{url: epId, format: "hls", headers: {"User-Agent": UA, "Referer": HOST + "/"}, name: "AIHI"}],
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
            name: "AIHI",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
