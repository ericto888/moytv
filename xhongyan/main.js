// X红颜 — idj1 插件（由内置 py 蜘蛛 xhongyan.py 改写，1:1）
// 站点：https://xhongyan.com，MacCMS 结构，服务端 HTML 直出，无接口、无加密签名。
// 分类从首页导航实时解析（/vod/type/id/N.html），与原 py 完全一致，原 py 无旗标过滤、不删减。
// 列表卡片是播放页锚点 <a href="/index.php/vod/play/id/N/sid/1/nid/1.html">，
// 标题取 span.title / title 属性 / alt，封面取 background-image / data-original / data-src / src。
// 详情页取 <title>、/upload/vod/ 海报、meta description、页内 sid 线路列表；
// 播放页 var player_data={...} 的 url 字段即本站签名 mp4 直链（相对路径补本站域名）。
// 播放只依赖 User-Agent/Referer 两个头，不依赖 Cookie/Authorization（宿主会剥离那类头，本链不需要）。
// 本机出口慢（单请求常 20-55 秒）：超时 58 秒、最多 3 次尝试（与原 py 一致），拿到完整 HTML 即返回。

const BASE = "https://xhongyan.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;
const ATTEMPTS = 3;

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function unescapeHtml(s) {
    return str(s)
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\\\//g, "/")
        .trim();
}

function stripTags(s) {
    return str(s).replace(/<[^>]+>/g, "");
}

function fixUrl(raw) {
    const u = str(raw).trim();
    if (!u) return "";
    if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("/") === 0) return BASE + u;
    return BASE + "/" + u;
}

// ---------- HTTP：与原 py 一致，最多 3 次尝试，完整 HTML 立即返回，否则留最长的一份 ----------

async function fetchText(url) {
    let best = "";
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
            const resp = await host.http.get(url, {
                headers: {
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Referer": BASE + "/",
                },
                timeout: TIMEOUT,
            });
            if (resp.status === 200 && resp.body) {
                if (resp.body.length > best.length) best = resp.body;
                if (resp.body.indexOf("</html>") >= 0) return resp.body;
            }
        } catch (error) {
            host.log("fetch fail", url, str(error && error.message));
        }
    }
    return best;
}

function fetchPath(path) {
    if (str(path).indexOf("http") === 0) return fetchText(path);
    return fetchText(BASE + path);
}

// ---------- 解析（与原 py 正则一一对应） ----------

const NAV_RE = /<a[^>]*href="\/(?:index\.php)?\/vod\/type\/id\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g;
const ANCHOR_RE = /<a[^>]*href="\/index\.php\/vod\/play\/id\/(\d+)\/sid\/1\/nid\/1\.html"[^>]*>([\s\S]*?)<\/a>/g;
const DUR_RE = /(\d+:\d{2}(?::\d{2})?)/;

function parseNav(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    let m;
    NAV_RE.lastIndex = 0;
    while ((m = NAV_RE.exec(html)) !== null) {
        const tid = m[1].trim();
        const name = unescapeHtml(stripTags(m[2])).trim();
        if (!tid || !name || seen[tid]) continue;
        seen[tid] = true;
        out.push({id: tid, name: name});
    }
    return out;
}

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    let m;
    ANCHOR_RE.lastIndex = 0;
    while ((m = ANCHOR_RE.exec(html)) !== null) {
        const vid = m[1].trim();
        if (!vid || seen[vid]) continue;
        const tag = m[0];
        const inner = m[2];
        let title = "";
        let tm = /<span class="title">([^<]+)<\/span>/.exec(inner);
        if (tm) title = unescapeHtml(tm[1]);
        if (!title) {
            tm = /title="([^"]+)"/.exec(tag);
            if (tm) title = unescapeHtml(tm[1]);
        }
        if (!title) {
            tm = /alt="([^"]+)"/.exec(tag);
            if (tm) title = unescapeHtml(tm[1]);
        }
        if (!title) {
            const clean = inner.replace(/<!--[\s\S]*?-->/g, " ");
            title = unescapeHtml(stripTags(clean)).replace(/\s+/g, " ").trim();
            const dm0 = DUR_RE.exec(title);
            if (dm0) title = title.replace(dm0[1], "").trim();
        }
        let cover = "";
        let cm = /background-image:\s*url\((?:&quot;|"|&quot;)?([^)"']+)/.exec(tag);
        if (!cm) cm = /data-original="([^"]+)"/.exec(tag);
        if (!cm) cm = /data-src="([^"]+)"/.exec(tag);
        if (!cm) cm = /src="([^"]+)"/.exec(tag);
        if (cm) cover = fixUrl(cm[1].replace(/&quot;/g, "").replace(/&#34;/g, "").trim());
        if (cover.indexOf("lazyload.gif") >= 0) cover = "";
        if (!title) continue;
        let remark = "";
        let dm = /id="Duration">(\d+:\d{2}(?::\d{2})?)/.exec(inner);
        if (!dm) dm = DUR_RE.exec(inner);
        if (dm) remark = dm[1];
        seen[vid] = true;
        out.push({
            id: vid,
            title: title,
            cover: cover,
            remarks: remark,
            duration: remark,
            tags: [],
        });
    }
    return out;
}

function parsePlayer(html) {
    if (!html) return null;
    const m = /var player_data=(\{[\s\S]*?\})\s*<\/script>/.exec(html);
    if (!m) return null;
    try {
        return JSON.parse(m[1]);
    } catch (error) {
        return null;
    }
}

// ---------- idj1 契约 ----------

async function home() {
    const html = await fetchPath("/");
    const categories = parseNav(html);
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    let tid = str(arg && arg.id).trim();
    const page = Math.max(1, intValue(arg && arg.page, 1));
    if (!tid) {
        const html = await fetchPath("/");
        const cats = parseNav(html);
        if (cats.length) tid = cats[0].id;
        else return {items: [], hasMore: false};
    }
    const path = page <= 1
        ? "/index.php/vod/type/id/" + tid + ".html"
        : "/index.php/vod/type/id/" + tid + "/page/" + page + ".html";
    const html = await fetchPath(path);
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const kw = encodeURIComponent(keyword).replace(/%20/g, "+");
    const html = await fetchPath("/index.php/vod/search.html?wd=" + kw);
    const items = parseCards(html);
    return {items: items, hasMore: false};
}

async function detail(arg) {
    const nid = str(arg && arg.id).replace(/\D/g, "");
    if (!nid) throw new Error("无效的影片 ID");
    const html = await fetchPath("/index.php/vod/detail/id/" + nid + ".html");
    const empty = {id: nid, title: "", cover: "", desc: "", tags: [], lines: []};
    if (!html) return empty;
    let title = "";
    const tm = /<title[^>]*>([\s\S]*?)<\/title>/.exec(html);
    if (tm) {
        title = unescapeHtml(stripTags(tm[1])).trim();
        if (title.indexOf("详情介绍") >= 0) title = title.split("详情介绍")[0].trim();
    }
    if (!title) return empty;
    let cover = "";
    const pm = /<img[^>]*src="(\/upload\/vod\/[^"]+)"/.exec(html);
    if (pm) cover = fixUrl(pm[1]);
    let desc = "";
    const dm = /<meta name="description"[^>]*content="([^"]+)"/.exec(html);
    if (dm) {
        desc = unescapeHtml(dm[1]);
        if (desc.slice(-3) === "剧情:") desc = desc.slice(0, desc.length - 3).trim();
    }
    const parts = [];
    const seenSid = {};
    const sidRe = /\/index\.php\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/1\.html/g;
    let sm;
    while ((sm = sidRe.exec(html)) !== null) {
        if (sm[1] !== nid) continue;
        if (!seenSid[sm[2]]) {
            seenSid[sm[2]] = true;
            parts.push(sm[2]);
        }
    }
    parts.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    if (!parts.length) parts.push("1");
    if (!cover) {
        let kw = title.split(/\s+/)[0] || "";
        if (!kw) kw = title.slice(0, 12);
        if (kw.length > 20) kw = kw.slice(0, 20);
        if (kw) {
            try {
                const sh = await fetchPath("/index.php/vod/search.html?wd=" + encodeURIComponent(kw).replace(/%20/g, "+"));
                if (sh) {
                    for (const item of parseCards(sh)) {
                        if (item.id === nid) {
                            cover = item.cover;
                            break;
                        }
                    }
                }
            } catch (error) {
                cover = "";
            }
        }
    }
    const episodes = parts.map((sid, i) => ({
        id: nid + ":" + sid,
        name: parts.length === 1 ? "播放" : "第" + (i + 1) + "部",
    }));
    return {
        id: nid,
        title: title,
        cover: cover,
        desc: desc,
        remarks: parts.length > 1 ? "共" + parts.length + "部" : "",
        tags: [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id) || "").trim();
    if (raw.indexOf("$") >= 0) raw = raw.slice(raw.indexOf("$") + 1);
    const headers = {"User-Agent": UA, "Referer": BASE + "/"};
    if (!raw) throw new Error("无效的播放 ID");
    if (raw.indexOf("http") === 0) {
        return {
            streams: [{url: raw, format: /\.m3u8($|\?)/i.test(raw) ? "hls" : "mp4", headers: headers, name: "X红颜"}],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    let nid = raw;
    let sid = "1";
    if (raw.indexOf(":") >= 0) {
        const pair = raw.split(":");
        nid = pair[0];
        sid = pair[1] || "1";
    }
    nid = nid.replace(/\D/g, "");
    sid = sid.replace(/\D/g, "") || "1";
    if (!nid) throw new Error("无效的播放 ID");
    const html = await fetchPath("/index.php/vod/play/id/" + nid + "/sid/" + sid + "/nid/1.html");
    const player = parsePlayer(html);
    let url = player && typeof player.url === "string" ? player.url : "";
    url = fixUrl(unescapeHtml(url));
    if (!url) throw new Error("未找到播放地址");
    return {
        streams: [{url: url, format: /\.m3u8($|\?)/i.test(url) ? "hls" : "mp4", headers: headers, name: "X红颜"}],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
