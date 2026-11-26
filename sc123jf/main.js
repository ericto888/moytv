// 老牛影视 — idj1 插件（由内置 py 蜘蛛 sc123jf 改写）
// 站点：https://www.sc123jf.com，纯 HTML 正则提取（与原 py 同一套规则），
// 无登录、无付费墙。分类与原 py 写死的 23 个分类完全一致（原 py 无旗标过滤）。
// 列表/详情/搜索/播放 URL 与正则全部照搬原 py。
// 本机出口慢：单请求超时 60 秒、失败重试 3 次（与原 py 一致）。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const HOST = "https://www.sc123jf.com";

const CATS = [
    ["1", "电影"], ["2", "电视剧"], ["3", "动漫"], ["4", "综艺"],
    ["5", "动作片"], ["6", "喜剧片"], ["7", "科幻片"], ["8", "恐怖片"],
    ["9", "爱情片"], ["10", "剧情片"], ["11", "战争片"], ["12", "记录片"],
    ["13", "悬疑片"], ["14", "动画片"], ["19", "大陆剧"], ["20", "欧美剧"],
    ["21", "香港剧"], ["22", "韩国剧"], ["23", "台湾剧"], ["24", "日本剧"],
    ["25", "海外剧"], ["26", "泰国剧"], ["27", "短剧"],
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function unescapeHtml(s) {
    let out = str(s);
    if (!out) return "";
    out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)));
    out = out.replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)));
    out = out.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
    return out;
}

// 原 py _txt：去标签 + 反转义 + 折叠空白
function txt(s) {
    if (!s) return "";
    return unescapeHtml(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// 原 py _abs
function absUrl(url) {
    const u = str(url).trim();
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return HOST + u;
    if (u.startsWith("http")) return u;
    return HOST + "/" + u.replace(/^\/+/, "");
}

// ---------- HTTP（原 py _http_get：重试 3 次，取最长响应，见 </html> 即返回） ----------

async function getText(url, referer) {
    const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (referer) headers["Referer"] = referer;
    let best = "";
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp.body) {
                if (resp.body.length > best.length) best = resp.body;
                if (resp.status === 200 && resp.body.indexOf("</html>") >= 0) return resp.body;
            }
        } catch (error) {
            // 超时 / 网络错误：换连接重试
        }
    }
    return best;
}

// ---------- 解析（照搬原 py） ----------

// 原 py _cards：遍历 <a ...> 标签，href=/sc1view/数字.html、
// 同标签内 title= 与 data-original= 均须存在，后 500 字内 pic-text 作备注
function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    const tagRe = /<a\s[^>]*>/g;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
        const tag = m[0];
        const hm = /href="\/sc1view\/(\d+)\.html"/.exec(tag);
        if (!hm) continue;
        const vid = hm[1];
        if (seen[vid]) continue;
        const tm = /title="([^"]+)"/.exec(tag);
        const pm = /data-original="([^"]+)"/.exec(tag);
        if (!tm || !pm) continue;
        seen[vid] = true;
        const windowText = html.slice(tagRe.lastIndex, tagRe.lastIndex + 500);
        const rm = /pic-text[^>]*>([^<]+)</.exec(windowText);
        out.push({
            id: vid,
            title: txt(tm[1]),
            cover: absUrl(pm[1]),
            remarks: rm ? txt(rm[1]) : "",
            duration: "",
            tags: [],
        });
    }
    return out;
}

// 原 py _label：字段名[：:] 后一段 </p> 内，优先取链接文本
function label(html, names) {
    for (let i = 0; i < names.length; i++) {
        const re = new RegExp(names[i] + "[：:]\\s*([\\s\\S]{0,300}?)</p>");
        const m = re.exec(html || "");
        if (m) {
            const links = [];
            const linkRe = /<a[^>]*>([^<]+)<\/a>/g;
            let lm;
            while ((lm = linkRe.exec(m[1])) !== null) links.push(lm[1]);
            if (links.length) {
                return links.map((x) => txt(x)).filter((x) => x).join(" / ");
            }
            return txt(m[1]);
        }
    }
    return "";
}

// 原 py _parse_detail
function parseDetail(html, vid) {
    let title = "";
    let m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html || "");
    if (m) title = txt(m[1]);
    if (!title) {
        m = /<title[^>]*>([^<]+)<\/title>/.exec(html || "");
        if (m) title = txt(m[1]).split("_")[0].replace(/^[《》\s]+|[《》\s]+$/g, "").trim();
    }
    let pic = "";
    let pm = /property="og:image" content="([^"]+)"/.exec(html || "");
    if (pm) pic = pm[1];
    if (!pic) {
        pm = /data-original="(https?:\/\/[^"]+)"/.exec(html || "");
        if (pm) pic = pm[1];
    }
    let desc = "";
    let dm = /content__desc">([\s\S]*?)<\/div>/.exec(html || "");
    if (dm) desc = txt(dm[1]);
    if (!desc) {
        dm = /<meta name="description" content="([^"]+)"/.exec(html || "");
        if (dm) desc = txt(dm[1]);
    }
    const tabs = [];
    const tabRe = /href="#(playlist\d+)"[^>]*>([^<]{1,20})</g;
    let tm2;
    while ((tm2 = tabRe.exec(html || "")) !== null) tabs.push(tm2);
    const tabNames = tabs.map((t) => txt(t[2])).filter((n) => n);
    const groups = {};
    const order = [];
    const playRe = /href="\/sc1play\/(\d+)-(\d+)-(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g;
    let em;
    while ((em = playRe.exec(html || "")) !== null) {
        const sid = em[2];
        const nid = em[3];
        let lab = txt(em[4]) || ("第" + nid + "集");
        const parts = lab.split(/\s+/).filter((x) => x);
        if (parts.length > 1 && parts.every((x) => x === parts[0])) lab = parts[0];
        if (!groups[sid]) {
            groups[sid] = {};
            order.push(sid);
        }
        const key = sid + "|" + nid;
        const epUrl = HOST + "/sc1play/" + em[1] + "-" + sid + "-" + nid + ".html";
        if (!(key in groups[sid])) {
            groups[sid][key] = {nid: parseInt(nid, 10) || 0, name: lab, id: epUrl};
        } else if (groups[sid][key].name === "立即播放" && lab && lab !== "立即播放") {
            groups[sid][key].name = lab;
        }
    }
    const lines = [];
    order.forEach((sid, idx) => {
        const eps = Object.keys(groups[sid]).map((k) => groups[sid][k])
            .sort((a, b) => a.nid - b.nid)
            .map((e) => ({id: e.id, name: e.name}));
        if (!eps.length) return;
        const name = idx < tabNames.length ? tabNames[idx] : ("线路" + (idx + 1));
        lines.push({name: name, episodes: eps});
    });
    if (!lines.length) {
        lines.push({
            name: "在线播放",
            episodes: [{id: HOST + "/sc1play/" + vid + "-0-0.html", name: "正片"}],
        });
    }
    return {
        id: vid,
        title: title || vid,
        cover: pic,
        desc: desc,
        year: "",
        area: label(html || "", ["地区", "产地"]),
        remarks: "",
        actor: label(html || "", ["主演", "演员"]),
        director: label(html || "", ["导演"]),
        typeName: label(html || "", ["类型", "分类"]),
        tags: [],
        lines: lines,
    };
}

// 原 py _extract_stream：先 m3u8 后 mp4，取页面内第一个
function extractStream(html) {
    if (!html) return "";
    let m = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/.exec(html);
    if (m) return m[0].replace(/,+$/, "").replace(/'+$/, "");
    m = /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/.exec(html);
    if (m) return m[0].replace(/,+$/, "").replace(/'+$/, "");
    return "";
}

// ---------- idj1 契约 ----------

async function home() {
    const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    const html = await getText(HOST + "/", HOST + "/");
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id).replace(/\D/g, "") || "1";
    const url = HOST + "/sc1type/" + tid + "-" + page + ".html";
    const html = await getText(url, HOST + "/");
    const items = parseCards(html);
    // 原 py _pagecount：页面内 /sc1type/tid-页码.html 的最大页码
    let pagecount = page;
    const numRe = new RegExp("/sc1type/" + tid + "-(\\d+)\\.html", "g");
    let nm;
    while ((nm = numRe.exec(html || "")) !== null) {
        const n = parseInt(nm[1], 10);
        if (n > pagecount) pagecount = n;
    }
    return {items: items, hasMore: page < pagecount && items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const url = HOST + "/search.html?searchword=" + encodeURIComponent(keyword);
    const items = parseCards(await getText(url, HOST + "/"));
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    const m = /(\d+)/.exec(rawId);
    if (!m) throw new Error("无效的影片 ID");
    const vid = m[1];
    const html = await getText(HOST + "/sc1view/" + vid + ".html", HOST + "/");
    if (!html) return {id: vid, title: vid, cover: "", desc: "", tags: [], lines: []};
    return parseDetail(html, vid);
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
    let page = raw.startsWith("http") ? raw : HOST + (raw.startsWith("/") ? raw : "/" + raw);
    if (page.indexOf("/sc1play/") < 0) {
        const m = /(\d+)/.exec(raw);
        if (!m) throw new Error("无效的播放 ID");
        page = HOST + "/sc1play/" + m[1] + "-0-0.html";
    }
    const html = await getText(page, HOST + "/");
    let playUrl = extractStream(html);
    if (!playUrl) throw new Error("未找到可用的播放地址");
    playUrl = playUrl.replace(/&amp;/g, "&");
    const isHls = /\.m3u8($|\?)/i.test(playUrl);
    if (isHls) {
        // 主列表先解析到第一条子列表再返回，播放器少跳一层（多跳易超时）；
        // 解析失败就原样返回主列表，不影响播放。
        try {
            const pl = await getText(playUrl, page);
            if (pl && pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const lines = pl.split(/\r?\n/).map((s) => s.trim())
                    .filter((s) => s && s.charAt(0) !== "#");
                if (lines.length) playUrl = host.url.resolve(playUrl, lines[0]);
            }
        } catch (error) {
            // 保留主列表
        }
    }
    return {
        streams: [{
            url: playUrl,
            format: isHls ? "hls" : "video",
            headers: {"User-Agent": UA, "Referer": page},
            name: "老牛影视",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
