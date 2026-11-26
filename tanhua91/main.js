// tanhua91 (91 tanhua / jiuse) - idj1 plugin, rewritten 1:1 from the py spider.
// Three mirror hosts are tried in order, two attempts each, mirroring the
// original _http_get. Detail pages carry data-src play URLs; HLS candidates
// are validated against the claimed duration exactly like the py version
// (vnotice marker / playlist shorter than half the claimed duration is
// rejected, embed page tried as alternative, js10 preview as last fallback).

const HOSTS = [
    "https://www.91tanhua196.sbs",
    "https://www.91tanhua301.sbs",
    "https://www.91tanhua326.sbs",
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PREVIEW_URL = "https://cdn2.jiuse2.cloud/hlsd/js10/index.m3u8";
const TIMEOUT = 58000;

const CATS = [
    ["v-latest", "最近更新"],
    ["v-hd", "高清视频"],
    ["v-recent-favorite", "最近加精"],
    ["v-hot-list", "当前最热"],
    ["v-recent-rating", "最近得分"],
    ["v-ori", "91原创"],
    ["v-long-list", "10分钟以上"],
    ["v-longer-list", "20分钟以上"],
    ["v-month-discuss", "本月讨论"],
    ["v-top-favorite", "本月收藏"],
    ["v-most-favorite", "收藏最多"],
    ["v-top-list", "本月最热"],
    ["v-top-last", "上月最热"],
    ["k-top-rated", "最高评分"],
    ["k-latest-updates", "最近更新"],
    ["k-most-popular", "最受欢迎"],
    ["k-europe-america", "欧美"],
    ["k-chinese", "国产"],
    ["k-fornication", "乱伦"],
    ["k-japan-korea", "日韩"],
    ["k-anime", "动漫"],
    ["k-homosexual", "同性"],
    ["k-hd", "高清AV"],
    ["k-sm", "SM专区"],
    ["k-jijin", "片商集锦"],
    ["k-guodong", "果冻传媒"],
    ["k-xingkong", "星空传媒"],
    ["k-madou", "麻豆传媒"],
    ["k-tianmei", "天美传媒"],
    ["k-jingdong", "精东影业"],
    ["k-swag", "台湾SWAG"],
    ["k-tuzi", "兔子先生"],
    ["k-mitao", "蜜桃传媒"],
    ["k-huangjia", "皇家华人"],
    ["d-all", "精品"],
    ["d-orig", "原创"],
    ["d-repost", "转发"],
    ["d-sponsor", "赞助"],
    ["s-swag", "SWAG"],
    ["s-madou", "麻豆"],
];

const K_SORTS = ["top-rated", "latest-updates", "most-popular"];

function str(v) {
    if (v == null) return "";
    return String(v).trim();
}

function unescapeHtml(s) {
    if (!s) return "";
    return String(s)
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function stripTags(s) {
    if (!s) return "";
    return String(s).replace(/<[^>]+>/g, "").trim();
}

function fixUrl(raw) {
    const u = unescapeHtml(str(raw));
    if (!u) return "";
    if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("/") === 0) return HOSTS[0] + u;
    return u;
}

function pageHeaders() {
    return {
        "User-Agent": UA,
        "Referer": HOSTS[0],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    };
}

async function fetchOnce(url) {
    const resp = await host.http.get(url, {headers: pageHeaders(), timeout: TIMEOUT});
    if (resp.status === 200 && resp.body) return resp.body;
    if (resp.body) return resp.body;
    throw new Error("HTTP " + resp.status);
}

async function httpGet(path) {
    for (const h of HOSTS) {
        const url = h + path;
        for (let i = 0; i < 2; i++) {
            try {
                return await fetchOnce(url);
            } catch (e) {
                // try next attempt / host, like the py version
            }
        }
    }
    return "";
}

async function httpGetAbs(url) {
    const headers = {"User-Agent": UA, "Referer": HOSTS[0]};
    for (let i = 0; i < 2; i++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp.status === 200 && resp.body) return resp.body;
        } catch (e) {
            // retry once
        }
    }
    return "";
}

function parseCards(html) {
    const out = [];
    const seen = {};
    if (!html) return out;
    const blocks = String(html).split('<div class="video-elem">');
    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const hm = block.match(/<a[^>]*class="display d-block"[^>]*href="([^"]+)"/);
        const href = hm ? hm[1].trim() : "";
        if (!href || seen[href]) continue;
        seen[href] = true;
        if (!(href.indexOf("/video/") === 0 || href.indexOf("/videos/") === 0 || href.indexOf("/vod/") === 0)) continue;
        const tm = block.match(/<a[^>]*class="title[^"]*"[^>]*href="[^"]+">([^<]+)<\/a>/);
        const title = tm ? unescapeHtml(tm[1].trim()) : "";
        if (!title) continue;
        const cm = block.match(/background-image:\s*url\(["']?([^)'"]+)/);
        let cover = cm ? fixUrl(cm[1]) : "";
        if (!cover) {
            const im = block.match(/<img[^>]*class="img"[^>]*src="([^"]+)"/) || block.match(/<img[^>]*src="([^"]+)"/);
            if (im) cover = fixUrl(im[1]);
        }
        const dm = block.match(/<small class="layer">([^<]+)<\/small>/);
        const remark = dm ? dm[1].trim() : "";
        out.push({id: href, title: title, cover: cover, remarks: remark});
    }
    return out;
}

function stripComments(html) {
    return String(html || "").replace(/<!--[\s\S]*?-->/g, "");
}

function parseTabs(html, prefix) {
    const out = [];
    const seen = {};
    const re = /data-href="([^"]+)"[^>]*>([^<]+)<\/div>/g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        const href = m[1].trim();
        const name = m[2].trim();
        if (href.indexOf(prefix) !== 0 || !name || seen[href]) continue;
        seen[href] = true;
        out.push([href, name]);
    }
    return out;
}

function parseKSorts(html) {
    const out = [];
    const seen = {};
    const re = /<a[^>]*href="\/videos\/([a-z-]+)\/\d+"[^>]*>([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        const slug = m[1].trim();
        const name = m[2].trim();
        if (K_SORTS.indexOf(slug) < 0 || !name || seen[slug]) continue;
        seen[slug] = true;
        out.push([slug, name]);
    }
    return out;
}

function catalogRoute(tid, pg) {
    pg = Math.max(pg, 1);
    if (tid.indexOf("v-") === 0) {
        const slug = tid.slice(2);
        const base = "/video/category/" + slug;
        const path = pg <= 1 ? base : base + "/" + pg;
        return [path, base + "/" + (pg + 1)];
    }
    if (tid.indexOf("k-") === 0) {
        const slug = tid.slice(2);
        if (K_SORTS.indexOf(slug) >= 0) {
            const base = "/videos/" + slug;
            return [base + "/" + pg, base + "/" + (pg + 1)];
        }
        const base = "/videos/categories/" + slug;
        const path = pg <= 1 ? base : base + "/" + pg;
        return [path, base + "/" + (pg + 1)];
    }
    if (tid.indexOf("d-") === 0) {
        const slug = tid.slice(2);
        let filt;
        if (slug === "all") filt = "";
        else if (slug === "orig") filt = "/%E5%8E%9F%E5%88%9B";
        else if (slug === "repost") filt = "/%E8%BD%AC%E5%8F%91";
        else if (slug === "sponsor") filt = "/%E8%B5%9E%E5%8A%A9";
        else return null;
        const path = pg <= 1 ? "/vod" + filt : "/vod" + filt + "?page=" + pg;
        return [path, "/vod" + filt + "?page=" + (pg + 1)];
    }
    if (tid.indexOf("s-") === 0) {
        const slug = tid.slice(2);
        if (slug !== "swag" && slug !== "madou") return null;
        return ["/" + slug + "?keywords=" + slug + "&page=" + pg,
                "/" + slug + "?keywords=" + slug + "&page=" + (pg + 1)];
    }
    return null;
}

async function fetchCats() {
    const out = [];
    const seen = {};
    const htmlV = await httpGet("/video");
    if (htmlV) {
        for (const pair of parseTabs(stripComments(htmlV), "/video/category/")) {
            const slug = pair[0].slice("/video/category/".length).replace(/^\/+|\/+$/g, "");
            if (slug === "nonpaid") continue;
            const cid = "v-" + slug;
            if (!seen[cid]) { seen[cid] = true; out.push([cid, pair[1]]); }
        }
    }
    const htmlK = await httpGet("/videos");
    if (htmlK) {
        const live = stripComments(htmlK);
        for (const pair of parseKSorts(live)) {
            const cid = "k-" + pair[0];
            if (!seen[cid]) { seen[cid] = true; out.push([cid, pair[1]]); }
        }
        for (const pair of parseTabs(live, "/videos/categories/")) {
            const slug = pair[0].slice("/videos/categories/".length).replace(/^\/+|\/+$/g, "");
            const cid = "k-" + slug;
            if (!seen[cid]) { seen[cid] = true; out.push([cid, pair[1]]); }
        }
    }
    if (out.length < 10) return CATS.slice();
    const extra = [["d-all", "精品"], ["d-orig", "原创"], ["d-repost", "转发"], ["d-sponsor", "赞助"], ["s-swag", "SWAG"], ["s-madou", "麻豆"]];
    for (const pair of extra) {
        if (!seen[pair[0]]) { seen[pair[0]] = true; out.push(pair); }
    }
    return out;
}

async function categoryPage(tid, pg) {
    const route = catalogRoute(tid, pg);
    if (!route) return {items: [], hasMore: false};
    const html = await httpGet(route[0]);
    const items = parseCards(html);
    const nxt = route[1];
    const hasMore = items.length > 0 && (String(html || "").indexOf(nxt) >= 0 || String(html || "").indexOf(nxt.replace(/&/g, "&amp;")) >= 0);
    return {items: items, hasMore: hasMore};
}

function metaContent(html, attr, value) {
    const re = new RegExp('<meta[^>]*' + attr + '="' + value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"[^>]*content="([^"]+)"');
    const m = re.exec(html || "");
    return m ? unescapeHtml(m[1].trim()) : "";
}

function isoDurationSecs(html) {
    const m = /"duration":\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?"/.exec(html || "");
    if (!m) return null;
    let total = 0;
    if (m[1]) total += parseFloat(m[1]) * 3600;
    if (m[2]) total += parseFloat(m[2]) * 60;
    if (m[3]) total += parseFloat(m[3]);
    return total > 0 ? total : null;
}

function parsePlaylist(text) {
    if (!text || text.indexOf("#EXTM3U") < 0) return null;
    const notice = text.indexOf("__vnotice") >= 0;
    let total = 0;
    let n = 0;
    const re = /#EXTINF:([\d.]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        total += parseFloat(m[1]);
        n++;
    }
    if (n === 0) {
        if (text.indexOf(".m3u8") >= 0) return [null, notice];
        return [0, notice];
    }
    return [total, notice];
}

async function playlistInfo(url) {
    const txt = await httpGetAbs(url);
    if (!txt) return null;
    return parsePlaylist(txt);
}

function playlistPlayable(info, claimed) {
    if (info === null) return true;
    const total = info[0];
    const notice = info[1];
    if (notice) return false;
    if (total !== null && claimed !== null && claimed !== undefined) return total >= claimed * 0.5;
    return true;
}

function playUrlOf(html) {
    const m = /data-src="([^"]+)"/.exec(html || "");
    return m ? fixUrl(m[1]) : "";
}

async function embedPlayUrl(detailPath) {
    const parts = detailPath.replace(/\/+$/, "").split("/");
    const hexid = parts[parts.length - 1];
    if (!hexid) return "";
    let embed;
    if (detailPath.indexOf("/video/view") >= 0) embed = "/video/embed/" + hexid;
    else if (detailPath.indexOf("/vod/view/") >= 0) embed = "/vod/embed/" + hexid;
    else return "";
    const html = await httpGet(embed);
    return html ? playUrlOf(html) : "";
}

async function resolveHls(url, detailPath, claimed) {
    if (url.indexOf("/hlsd/js10/") >= 0) return url;
    const info = await playlistInfo(url);
    if (info === null) return url;
    if (playlistPlayable(info, claimed)) return url;
    const alt = await embedPlayUrl(detailPath);
    if (alt && alt !== url) {
        const info2 = await playlistInfo(alt);
        if (info2 === null) return alt;
        if (playlistPlayable(info2, claimed)) return alt;
    }
    return null;
}

async function previewFallback() {
    const info = await playlistInfo(PREVIEW_URL);
    if (info !== null && playlistPlayable(info, null)) return PREVIEW_URL;
    return null;
}

async function mp4Alive(url) {
    const headers = {"User-Agent": UA, "Referer": HOSTS[0], "Range": "bytes=0-0"};
    for (let i = 0; i < 2; i++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: 15000});
            return resp.status !== 404 && resp.status !== 410;
        } catch (e) {
            return true;
        }
    }
    return true;
}

async function home() {
    const cats = await fetchCats();
    let items = [];
    try {
        const r = await categoryPage(cats[0][0], 1);
        items = r.items;
    } catch (e) {
        items = [];
    }
    return {
        categories: cats.map(function (c) { return {id: c[0], name: c[1]}; }),
        items: items,
        hasMore: false,
    };
}

async function category(arg) {
    const pg = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const tid = str(arg && arg.id);
    const r = await categoryPage(tid, pg);
    return {items: r.items, hasMore: r.hasMore};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const url = "/search?keywords=" + encodeURIComponent(keyword) + "&page=1";
    const html = await httpGet(url);
    return {items: parseCards(html), hasMore: false};
}

async function detail(arg) {
    let sid = str(arg && arg.id).replace(/^\/+/, "");
    if (!sid) throw host.error("E_PARSE", "tanhua91 detail: empty id");
    const html = await httpGet("/" + sid);
    if (!html) throw host.error("E_NETWORK", "tanhua91 detail page fetch failed");
    const claimed = isoDurationSecs(html);
    let title = metaContent(html, "property", "og:title");
    if (!title) {
        const tm = /<title[^>]*>([\s\S]*?)<\/title>/.exec(html);
        if (tm) {
            title = unescapeHtml(stripTags(tm[1]));
            if (title.indexOf(" - ") >= 0) title = title.split(" - ")[0].trim();
        }
    }
    const cover = metaContent(html, "property", "og:image:secure_url") || metaContent(html, "property", "og:image");
    const actor = metaContent(html, "name", "twitter:creator");
    const keywords = metaContent(html, "name", "keywords");
    let synopsis = metaContent(html, "property", "og:description") || title;
    if (actor) synopsis += "\n作者：" + actor;
    if (keywords) synopsis += "\n标签：" + keywords;
    const playUrl = playUrlOf(html);
    if (!title || !playUrl) throw host.error("E_PARSE", "tanhua91 detail: no title or play url");
    const eps = [];
    if (sid.indexOf("video/viewhd/") === 0) {
        eps.push({id: playUrl, name: "高清预览"});
        const hexid = sid.split("/").pop();
        const sdHtml = await httpGet("/video/view/" + hexid);
        if (sdHtml) {
            const sdUrl = playUrlOf(sdHtml);
            if (sdUrl) {
                const sdClaimed = isoDurationSecs(sdHtml) || claimed;
                const ok = await resolveHls(sdUrl, "/video/view/" + hexid, sdClaimed);
                if (ok) eps.push({id: ok, name: "标清全片"});
            }
        }
    } else if (playUrl.indexOf(".m3u8") >= 0) {
        const ok = await resolveHls(playUrl, "/" + sid, claimed);
        if (ok) {
            eps.push({id: ok, name: "在线播放"});
        } else {
            const pv = await previewFallback();
            if (pv) eps.push({id: pv, name: "在线播放"});
            else throw host.error("E_PARSE", "tanhua91 detail: play url rejected and no preview fallback");
        }
    } else if (playUrl.indexOf(".mp4") >= 0) {
        if (await mp4Alive(playUrl)) {
            eps.push({id: playUrl, name: "在线播放"});
        } else {
            const pv = await previewFallback();
            if (pv) eps.push({id: pv, name: "在线播放"});
            else throw host.error("E_PARSE", "tanhua91 detail: mp4 dead and no preview fallback");
        }
    } else {
        eps.push({id: playUrl, name: "在线播放"});
    }
    const tags = keywords ? keywords.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
    return {
        id: "/" + sid,
        title: title,
        cover: cover,
        desc: synopsis,
        tags: tags,
        lines: [{name: "在线播放", episodes: eps}],
    };
}

async function resolveMaster(url) {
    try {
        const txt = await httpGetAbs(url);
        if (!txt || txt.indexOf("#EXTM3U") < 0) return url;
        const lines = txt.split(/\r?\n/);
        let best = "";
        let bestBw = -1;
        let pendingBw = 0;
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
                const bm = /BANDWIDTH=(\d+)/.exec(line);
                pendingBw = bm ? parseInt(bm[1], 10) : 0;
            } else if (line && line.charAt(0) !== "#") {
                if (line.indexOf(".m3u8") >= 0) {
                    const child = new URL(line, url).href;
                    if (pendingBw >= bestBw) { bestBw = pendingBw; best = child; }
                    pendingBw = 0;
                } else {
                    return url;
                }
            }
        }
        return best || url;
    } catch (e) {
        return url;
    }
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id) || "");
    if (raw.indexOf("$") >= 0) raw = raw.split("$").slice(1).join("$");
    const headers = {"User-Agent": UA, "Referer": HOSTS[0] + "/"};
    if (raw.indexOf("http") !== 0) throw host.error("E_PARSE", "tanhua91 play: no direct url");
    let url = raw;
    const isHls = /\.m3u8($|\?)/i.test(url);
    if (isHls) url = await resolveMaster(url);
    return {
        streams: [{
            url: url,
            format: isHls ? "hls" : "mp4",
            headers: headers,
            name: "在线播放",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
