// AI淫航 — idj1 插件 v1.0.1（2026-11-25 由 TVBox py 蜘蛛 aiyinhang.py 移植）
// v1.0.1 仅改 manifest 域名清单（*.aiyinhang.top 覆盖裸域+子域、media 补
// *.hzjvlo.cn），本文件逻辑与 1.0.0 一致。
// 站点：https://www.aiyinhang.top（自建模板，无登录、无 VIP 墙，免费直看）
// 分类（与站导航 1:1，共 4 个）：AIcrdj AI成人短剧 / AIcrmj AI成人漫剧 /
//   AIhl AI换脸 / AImg AI魔改。列表 /aidj/<slug>/，翻页 /aidj/<slug>/page/N/
// 卡片：<a class="card" href="/detail/N/" title="..">，内含 img 封面
//   （media.hgpicimg.cc//upload/huangguo/*.jpg）、<span class="card-eps">集数</span>
// 详情 /detail/N/：h1 标题、img.detail-poster 海报、meta description 简介、
//   keywords 标签、选集 /play/N-1-E/
// 播放：/play/N-1-E/ 内 player_data={"url":"<mid>|<ep>","from":"huangguo"}，
//   再 GET /huangguo.php?ac=play&id=<mid>&ep=<ep> 得 {code:1,url:"/hgmedia.php?e=<base64>"}，
//   回站内 hgmedia 代理地址（内含时效 m3u8，逻辑与 py playerContent 1:1）
// 搜索：/search/<kw>-------------/（13 个横线，站方固定形态）
// 注：2026-11-25 本机出口连该站被直接断连（多次多栈重试均空回复），
//   本插件逻辑与 2026-11-07/08 已全链实测通过的 py 版 1:1，离线探针用真实抓包页验过；
//   站方若恢复可达即可用，手机终验待用户侧确认。

const SITE = "https://www.aiyinhang.top";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const FALLBACK_CATS = [
    {id: "AIcrdj", name: "AI成人短剧"},
    {id: "AIcrmj", name: "AI成人漫剧"},
    {id: "AIhl", name: "AI换脸"},
    {id: "AImg", name: "AI魔改"},
];

const TAG_STOP = {
    "AI淫航": 1, "AI成人短剧": 1, "AI成人短剧在线观看": 1, "AI原创短剧": 1,
    "成人AI短剧": 1, "AI短剧": 1, "AI漫剧": 1, "AI魔改": 1, "AI美女": 1,
    "黄果短剧": 1, "高清无码短剧": 1,
};

function str(value) {
    if (value == null) return "";
    return String(value);
}

function unescapeHtml(s) {
    return str(s)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\\\//g, "/");
}

function stripTags(s) {
    return unescapeHtml(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function absUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("/") === 0) return SITE + u;
    return SITE + "/" + u;
}

function firstMatch(text, regex, index) {
    const m = regex.exec(text);
    return m ? str(m[index == null ? 1 : index]) : "";
}

async function fetchText(url, referer) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await host.http.request({
                url: url,
                method: "GET",
                headers: {
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Referer": referer || SITE + "/home/",
                },
                timeout: TIMEOUT,
            });
            if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
            return resp.body == null ? "" : String(resp.body);
        } catch (error) {
            lastErr = error;
        }
    }
    throw lastErr || new Error("请求失败");
}

// 卡片解析（与 py _parse_cards 同口径）：按 <a class="card" 切块，块内取
// /detail/<id>/、title 属性、首个 img src、可选 card-eps 集数。
function parseCards(html) {
    const items = [];
    if (!html) return items;
    const seen = {};
    const chunks = html.split(/<a\s+class="card"\s+/i).slice(1);
    for (const chunk of chunks) {
        const vid = firstMatch(chunk, /^href="\/detail\/(\d+)\/"/i);
        if (!vid || seen[vid]) continue;
        const title = unescapeHtml(firstMatch(chunk, /title="([^"]*)"/i)).trim();
        if (!title) continue;
        seen[vid] = true;
        const cover = firstMatch(chunk, /<img[^>]*?src="([^"]+)"/i);
        const eps = unescapeHtml(firstMatch(chunk, /<span class="card-eps">([^<]*?)<\/span>/i)).trim();
        items.push({
            id: vid,
            title: title,
            cover: absUrl(cover),
            remarks: eps,
            tags: [],
        });
    }
    return items;
}

async function fetchCategories() {
    try {
        const html = await fetchText(SITE + "/home/");
        const block = firstMatch(html, /<nav[^>]*aria-label="影片分类"[^>]*>([\s\S]*?)<\/nav>/i);
        const cats = [];
        const seen = {};
        const re = /<a[^>]*?href="\/aidj\/([A-Za-z0-9]+)\/"[^>]*?>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(block)) !== null) {
            const cid = m[1];
            const name = stripTags(m[2]).replace(/^▶+/, "").trim();
            if (!name || seen[cid] || name.indexOf("查看更多") >= 0) continue;
            seen[cid] = true;
            cats.push({id: cid, name: name});
        }
        if (cats.length) return cats;
    } catch (error) {}
    return FALLBACK_CATS.slice();
}

// ---------- idj1 契约 ----------

async function home() {
    let items = [];
    try {
        const html = await fetchText(SITE + "/home/");
        items = parseCards(html);
    } catch (error) {
        items = [];
    }
    const cats = await fetchCategories();
    return {categories: cats, items: items, hasMore: false};
}

async function category(arg) {
    const page = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const tid = str(arg && arg.id);
    if (!tid) return {items: [], hasMore: false};
    const path = page <= 1 ? "/aidj/" + tid + "/" : "/aidj/" + tid + "/page/" + page + "/";
    let items = [];
    try {
        const html = await fetchText(SITE + path);
        items = parseCards(html);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const kw = encodeURIComponent(keyword).replace(/%20/g, "+");
    let items = [];
    try {
        const html = await fetchText(SITE + "/search/" + kw + "-------------/");
        items = parseCards(html);
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const nid = raw.replace(/[^0-9]/g, "");
    if (!nid) throw new Error("无效的影片 ID");
    const html = await fetchText(SITE + "/detail/" + nid + "/");
    const title = stripTags(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i));
    if (!title) throw new Error("详情为空");
    let cover = firstMatch(html, /<img[^>]*class="detail-poster"[^>]*src="([^"]+)"/i);
    if (!cover) cover = firstMatch(html, /<img[^>]*src="([^"]*?\/upload\/huangguo\/[^"]+)"/i);
    cover = absUrl(cover);
    const synopsis = unescapeHtml(firstMatch(html, /<meta name="description" content="([^"]*)"/i)).trim();
    const rawKw = unescapeHtml(firstMatch(html, /<meta name="keywords" content="([^"]*)"/i));
    const tags = [];
    for (const part of rawKw.split(",")) {
        const t = part.trim();
        if (!t || TAG_STOP[t] || t === title) continue;
        if (tags.indexOf(t) < 0) tags.push(t);
    }
    const epSet = {};
    const epRe = new RegExp('href="/play/' + nid + '-1-(\\d+)/"', "g");
    let m;
    while ((m = epRe.exec(html)) !== null) epSet[m[1]] = true;
    let epNums = Object.keys(epSet).map((x) => parseInt(x, 10)).filter((n) => isFinite(n)).sort((a, b) => a - b);
    if (!epNums.length) epNums = [1];
    const episodes = epNums.map((n) => ({id: nid + "-1-" + n, name: "第" + n + "集"}));
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: synopsis,
        tags: tags,
        lines: [{name: "在线播放", episodes: episodes}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id) || "");
    if (/^https?:\/\//i.test(raw)) {
        return {streams: [{url: raw, format: /\.m3u8($|\?)/i.test(raw) ? "hls" : "mp4", headers: {"User-Agent": UA, "Referer": SITE + "/home/"}, name: "AI淫航"}]};
    }
    const parts = raw.split("-");
    if (parts.length !== 3) throw new Error("无效的播放地址");
    const vid = parts[0], sid = parts[1], ep = parts[2];
    if (!/^\d+$/.test(vid) || !/^\d+$/.test(ep)) throw new Error("无效的播放地址");
    const playPath = "/play/" + vid + "-" + sid + "-" + ep + "/";
    const pageUrl = SITE + playPath;
    const headers = {"User-Agent": UA, "Referer": pageUrl};
    const html = await fetchText(pageUrl, pageUrl);
    const url = firstMatch(html, /player_data\s*=\s*\{.*?"url"\s*:\s*"([^"]+)"/is);
    const frm = firstMatch(html, /"from"\s*:\s*"([^"]+)"/i);
    if (!url) throw new Error("未找到可用播放地址");
    if (/\.m3u8|\.mp4/i.test(url)) {
        return {streams: [{url: url, format: /\.m3u8/i.test(url) ? "hls" : "mp4", headers: headers, name: "AI淫航"}]};
    }
    if (url.indexOf("|") < 0) throw new Error("未找到可用播放地址");
    const kv = url.split("|");
    const mid = kv[0].trim(), mep = kv[1].trim();
    if (frm !== "huangguo" || !mid || !mep) throw new Error("未找到可用播放地址");
    const body = await fetchText(SITE + "/huangguo.php?ac=play&id=" + encodeURIComponent(mid) + "&ep=" + encodeURIComponent(mep), pageUrl);
    let data = null;
    try { data = JSON.parse(body); } catch (error) {}
    if (!data || data.code !== 1) throw new Error("未找到可用播放地址");
    const proxy = str(data.url || "").trim();
    if (proxy.indexOf("/hgmedia.php?e=") !== 0) throw new Error("未找到可用播放地址");
    return {streams: [{url: SITE + proxy, format: "hls", headers: headers, name: "AI淫航"}]};
}

export default {home: home, category: category, search: search, detail: detail, play: play};
