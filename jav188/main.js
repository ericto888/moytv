// AV18.Live (jav188.net) - idj1 plugin, 1:1 port of the builtin py spider.
// Server-rendered HTML lists, a JSON leaks feed, and a two-step play chain:
// the player page carries segment tokens, getMv.php exchanges one segment
// for a direct HLS/mp4 URL, and getMvPreview.php serves the preview clip.

const BASE = "https://jav188.net";
const KEY = "jav188";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
    ["free", "免費", "/?cat=free"],
    ["jp", "日本", "/search.php?order=latest&s_type=jp&s_tid=37"],
    ["scate", "無碼", "/search.php?order=latest&s_type=scate&s_tid=35"],
    ["us", "歐美", "/search.php?order=latest&s_type=us&s_tid=33"],
    ["event", "獨家", "/search.php?s_type=event&s_tid=17"],
    ["vr", "VR", "/search.php?s_type=tag&s_tid=488"],
    ["zone1", "國產", "/zone_index.php?zone=1"],
    ["zone2", "卡通", "/zone_index.php?zone=2"],
    ["leaks", "黑料", "/leaks_zone.php"],
    ["topic", "主題", "/special_topic.php"],
    ["cate1", "癖好", "/category.php?cate=1"],
    ["cate2", "動作", "/category.php?cate=2"],
    ["cate3", "身材", "/category.php?cate=3"],
    ["cate4", "羞恥", "/category.php?cate=4"],
    ["cate5", "強迫", "/category.php?cate=5"],
    ["cate6", "身份", "/category.php?cate=6"],
    ["actor", "女優", "/actor_list.php"],
];

const LEAKS_LIST = "/ajax/site/get_tg_posts.php?format=json&page={page}&limit=12&sort=newest&featured=1&featured_pool=1&featured_default_sort=1";
const LEAKS_ONE = "/ajax/site/get_tg_posts.php?format=json&page=1&limit=1&sort=newest&featured=1&featured_pool=1&uuid={uuid}";

const BLOCK_RE = /<div class="item [^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
const UUID_RE = /href="\/player\.php\?uuid=([A-Za-z0-9_-]{9,12})&cat=(\d+)"/;
const UUID2_RE = /data-uuid="([A-Za-z0-9_-]{9,12})"/;
const COVER_RE = /(?:data-src|src)="(https:\/\/jav188\.net\/preview\/\d+\/[sb]\/[A-Za-z0-9_-]+-800\.jpg[^"]*)"/;
const TIME_RE = /video-time">([^<]+)</;
const TITLE_RE = /<span class="title"[^>]*>\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/;
const ALT_RE = /<img[^>]+alt='([^']+)'/;
const ACTOR_LINK_RE = /href='\/search\.php\?s_type=actor&s_tid=(\d+)' title="([^"]+)"/g;
const ACTOR_PIC_RE = /src="\.\/resources\/site_public\/actor\/([0-9a-f]+\.jpg)"/g;
const SEG_TAG_RE = /<li class="vdplay01[^>]*>/g;
const TITLE_TAG_RE = /<title>([^<|]+)/;
const IMG_URL_RE = /img_url_b\s*:\s*"([^"]+)"/;
const ACTOR_IN_PAGE_RE = /s_type=actor&s_tid=\d+[^>]*>([^<]+)</g;

function str(value) {
    if (value == null) return "";
    return String(value);
}

function clean(s) {
    if (!s) return "";
    let out = str(s)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
    while (out.indexOf("  ") >= 0) out = out.replace(/  /g, " ");
    return out.trim();
}

function normPg(pg) {
    const n = parseInt(pg, 10);
    return isFinite(n) && n >= 1 ? n : 1;
}

function catPath(tid) {
    for (const c of CATS) {
        if (c[0] === tid) return c[2];
    }
    return "/?cat=free";
}

async function rawRequest(url, headers, body, method) {
    const h = {"User-Agent": UA, "Referer": BASE + "/"};
    if (headers) {
        for (const k of Object.keys(headers)) h[k] = headers[k];
    }
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.request({
                url: url, method: method || "GET", headers: h,
                body: body || "", timeout: TIMEOUT,
            });
            if (resp) return resp;
        } catch (error) {
            lastErr = error;
        }
    }
    if (lastErr) throw lastErr;
    return {status: 0, url: url, headers: {}, body: ""};
}

async function getPage(path) {
    const url = path.indexOf("http") === 0 ? path : BASE + path;
    try {
        const resp = await rawRequest(url);
        return resp.body || "";
    } catch (error) {
        return "";
    }
}

async function leaksApi(path) {
    const url = BASE + path;
    try {
        const resp = await rawRequest(url, {
            "Referer": BASE + "/leaks_zone.php",
            "X-Requested-With": "XMLHttpRequest",
        });
        try {
            return JSON.parse(resp.body || "{}");
        } catch (error) {
            return {};
        }
    } catch (error) {
        return {};
    }
}

function parseCards(html) {
    const out = [];
    const seen = {};
    BLOCK_RE.lastIndex = 0;
    let block;
    while ((block = BLOCK_RE.exec(html || "")) !== null) {
        const b = block[1];
        let uuid = "";
        let cat = "";
        const m = UUID_RE.exec(b);
        if (m) {
            uuid = m[1];
            cat = m[2];
        } else {
            const m2 = UUID2_RE.exec(b);
            if (!m2) continue;
            uuid = m2[1];
            cat = "19";
        }
        const cm = COVER_RE.exec(b);
        if (!cm) continue;
        const cover = cm[1];
        const tm = TIME_RE.exec(b);
        if (!tm) continue;
        const timeS = clean(tm[1]);
        let title = "";
        const tm2 = TITLE_RE.exec(b);
        if (tm2) {
            title = clean(tm2[1]);
        } else {
            const am = ALT_RE.exec(b);
            if (am) title = clean(am[1]);
        }
        if (!title || seen[uuid]) continue;
        seen[uuid] = true;
        out.push({id: uuid + "|" + cat, title: title, cover: cover, remarks: timeS, tags: []});
    }
    return out;
}

function parseActresses(html) {
    const links = [];
    const pics = [];
    ACTOR_LINK_RE.lastIndex = 0;
    let m;
    while ((m = ACTOR_LINK_RE.exec(html || "")) !== null) {
        links.push([m[1], clean(m[2])]);
    }
    ACTOR_PIC_RE.lastIndex = 0;
    while ((m = ACTOR_PIC_RE.exec(html || "")) !== null) {
        pics.push(m[1]);
    }
    const out = [];
    const n = Math.min(links.length, pics.length);
    for (let i = 0; i < n; i++) {
        out.push({
            tid: links[i][0],
            name: links[i][1],
            cover: BASE + "/resources/site_public/actor/" + pics[i],
        });
    }
    return out;
}

function leaksTitle(post) {
    const msg = clean(post.message_content || "").replace(/[\r\n]+/g, " ");
    if (msg) return msg;
    return clean(post.category_tag || "");
}

function parseLeaksPosts(data) {
    const out = [];
    const posts = (data && data.posts) || [];
    if (!Array.isArray(posts)) return {items: out, hasMore: false};
    for (const post of posts) {
        const uuid = post.uuid || "";
        const cover = post.cover_url || "";
        if (!uuid || !cover) continue;
        const tag = clean(post.category_tag || "");
        const views = post.view_count || "";
        const remark = (tag + " " + views).trim();
        out.push({id: "leaks|" + uuid, title: leaksTitle(post), cover: cover, remarks: remark, tags: []});
    }
    return {items: out, hasMore: !!((data || {}).hasMore)};
}

function attrOf(tag, name) {
    const re = new RegExp(name + '="([^"]*)"');
    const m = re.exec(tag);
    return m ? m[1] : "";
}

function parseSegments(html) {
    const out = [];
    SEG_TAG_RE.lastIndex = 0;
    let m;
    while ((m = SEG_TAG_RE.exec(html || "")) !== null) {
        const tag = m[0];
        const token = attrOf(tag, "token");
        if (!/^[0-9a-f]{32}$/.test(token)) continue;
        out.push({
            index: parseInt(attrOf(tag, "index"), 10) || 0,
            ms_id: attrOf(tag, "ms_id"),
            start: attrOf(tag, "start"),
            end: attrOf(tag, "end"),
            cat_id: attrOf(tag, "cat_id"),
            token: token,
        });
    }
    return out;
}

async function getMv(uuid, pageCat, msId, start, end, token, catId) {
    await getPage("/player.php?uuid=" + uuid + "&cat=" + pageCat);
    const url = BASE + "/subpage/getMv.php?num=" + uuid + "&ms_id=" + msId +
        "&file_prefix=&start=" + start + "&end=" + end + "&cat_id=" + catId +
        "&quality=1&token=" + token + "&playall=0";
    let text = "";
    try {
        const resp = await rawRequest(url, {
            "Referer": BASE + "/player.php?uuid=" + uuid + "&cat=" + pageCat,
        });
        text = resp.body || "";
    } catch (error) {
        text = "";
    }
    let v = {};
    try {
        v = JSON.parse(text || "{}");
    } catch (error) {
        v = {};
    }
    if (!v || typeof v !== "object") return "";
    if ("loginFail" in v) return "";
    if (v.error) return "";
    return v.vurl_hls || v.vurl || "";
}

const PREVIEW_SERVER = "https://msc1.vdosl.club";
const PREVIEW_STAMP_RE = /data-preview-video-url="\/subpage\/getMvPreview\.php\?uuid=[^"&]+&v=(\d+)"/;
const OG_IMAGE_RE = /property="og:image" content="https:\/\/jav188\.net\/preview\/\d+\/[sb]\/[^"?]+\?v=(\d+)"/;

function previewStamp(html) {
    const m = PREVIEW_STAMP_RE.exec(html || "");
    if (m) return m[1];
    const m2 = OG_IMAGE_RE.exec(html || "");
    return m2 ? m2[1] : "";
}

// The py follows getMvPreview.php's 301 to PREVIEW_SERVER/video_preview_2/
// <uuid>.mp4?v=<stamp>, where the stamp is printed on the player page
// itself. Building that final URL directly avoids one extra slow hop
// (and a full mp4 download through the redirect) under the host timeout.
async function getPreview(uuid, pageCat, stamp) {
    let st = str(stamp);
    if (!st) {
        const page = await getPage("/player.php?uuid=" + uuid + "&cat=" + pageCat);
        st = previewStamp(page);
    }
    if (st) return PREVIEW_SERVER + "/video_preview_2/" + uuid + ".mp4?v=" + st;
    await getPage("/player.php?uuid=" + uuid + "&cat=" + pageCat);
    const now = Math.floor(Date.now() / 1000);
    const url = BASE + "/subpage/getMvPreview.php?uuid=" + uuid + "&v=" + now;
    let text = "";
    let final = url;
    let headers = {};
    try {
        const resp = await rawRequest(url, {
            "Referer": BASE + "/player.php?uuid=" + uuid + "&cat=" + pageCat,
        });
        text = resp.body || "";
        final = resp.url || url;
        headers = resp.headers || {};
    } catch (error) {
        text = "";
    }
    const ctype = headers["content-type"] || "";
    if (/\.mp4$/.test(final) || ctype.indexOf("video/") >= 0) return final;
    try {
        const v = JSON.parse(text || "{}");
        const u = v.url || v.vurl || v.vurl_hls || "";
        if (u) return u;
    } catch (error) {
        // fall through to the plain-text check below
    }
    if (text.trim().indexOf("http") === 0) return text.trim();
    return "";
}

async function home() {
    const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    const html = await getPage("/");
    return {categories: categories, items: parseCards(html), hasMore: false};
}

async function category(arg) {
    const tid = str(arg && arg.id) || "free";
    const pg = normPg(arg && arg.page);
    if (tid === "free") {
        if (pg > 1) return {items: [], hasMore: false};
        const html = await getPage("/");
        return {items: parseCards(html), hasMore: false};
    }
    if (tid === "leaks") {
        const data = await leaksApi(LEAKS_LIST.replace("{page}", String(pg)));
        const parsed = parseLeaksPosts(data);
        return {items: parsed.items, hasMore: parsed.hasMore};
    }
    if ((tid === "zone1" || tid === "zone2" || tid === "topic") && pg > 1) {
        return {items: [], hasMore: false};
    }
    const path = catPath(tid);
    const sep = path.indexOf("?") >= 0 ? "&" : "?";
    const html = await getPage(path + sep + "num=" + pg);
    if (tid === "actor") {
        const items = parseActresses(html).map((a) => ({
            id: "actor|" + a.tid + "|" + a.name,
            title: a.name,
            cover: a.cover,
            remarks: "",
            tags: [],
        }));
        return {items: items, hasMore: items.length >= 42};
    }
    const items = parseCards(html);
    return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const html = await getPage("/search.php?cat=hd&kw_type=key&kw=" + encodeURIComponent(keyword));
    return {items: parseCards(html), hasMore: false};
}

async function detail(arg) {
    const nid = str(arg && arg.id).trim();
    if (!nid) throw host.error("E_PARSE", "empty detail id");
    if (nid.indexOf("leaks|") === 0) {
        const uuid = nid.slice("leaks|".length);
        const data = await leaksApi(LEAKS_ONE.replace("{uuid}", encodeURIComponent(uuid)));
        const posts = (data && data.posts) || [];
        if (!posts.length) throw host.error("E_PARSE", "leaks post not found");
        const post = posts[0];
        const cover = post.cover_url || "";
        const title = leaksTitle(post);
        const tag = clean(post.category_tag || "");
        const views = post.view_count || "";
        const postId = post.id || "";
        const eps = [];
        const stills = [];
        let vidNo = 0;
        const media = post.media_list || [];
        for (let idx = 0; idx < media.length; idx++) {
            const entry = media[idx];
            const p = entry.path || "";
            if (!p) continue;
            if (entry.is_video) {
                vidNo += 1;
                let name = "影片 " + vidNo;
                if (entry.is_locked) name += "（需會員）";
                eps.push({id: "leaks|" + postId + "|" + idx, name: name});
            } else if (!entry.is_locked) {
                stills.push(p);
            }
        }
        let synopsis = title;
        if (tag) synopsis += "\n分類：" + tag;
        if (views) synopsis += "\n播放量：" + views;
        if (stills.length) synopsis += "\n本片劇照：\n" + stills.join("\n");
        return {
            id: nid, title: title, cover: cover, desc: synopsis,
            tags: tag ? [tag] : [],
            lines: [{name: "在线播放", episodes: eps}],
        };
    }
    if (nid.indexOf("actor|") === 0) {
        const rest = nid.slice("actor|".length);
        const cut = rest.indexOf("|");
        const tid = cut >= 0 ? rest.slice(0, cut) : rest;
        const name = cut >= 0 ? rest.slice(cut + 1) : tid;
        const html = await getPage("/search.php?s_type=actor&s_tid=" + tid);
        const cards = parseCards(html);
        const eps = cards.map((c) => ({id: c.id, name: c.title}));
        return {
            id: nid, title: name || tid, cover: "", desc: name || tid,
            tags: ["女優"],
            lines: [{name: "在线播放", episodes: eps}],
        };
    }
    const parts = nid.split("|");
    const uuid = parts[0] || "";
    const pageCat = parts.length > 1 ? parts[1] : "19";
    if (!uuid) throw host.error("E_PARSE", "detail id has no uuid");
    const html = await getPage("/player.php?uuid=" + uuid + "&cat=" + pageCat);
    let title = "";
    const tm = TITLE_TAG_RE.exec(html || "");
    if (tm) title = clean(tm[1]);
    let cover = "";
    const cm = IMG_URL_RE.exec(html || "");
    if (cm) cover = cm[1];
    if (!cover) cover = BASE + "/preview/50/s/" + uuid + "-800.jpg";
    const actors = [];
    ACTOR_IN_PAGE_RE.lastIndex = 0;
    let am;
    while ((am = ACTOR_IN_PAGE_RE.exec(html || "")) !== null) {
        const a = clean(am[1]);
        if (a && actors.indexOf(a) < 0) actors.push(a);
    }
    const segments = parseSegments(html);
    const stamp = previewStamp(html);
    const eps = [{
        id: uuid + "|" + pageCat + "|preview" + (stamp ? "|" + stamp : ""),
        name: "預告片",
    }];
    for (const seg of segments) {
        const name = seg.index === 1 ? "第" + seg.index + "段（免费预览）" : "第" + seg.index + "段";
        const vid = uuid + "|" + pageCat + "|" + seg.ms_id + "|" + seg.start + "|" +
            seg.end + "|" + seg.token + "|" + seg.cat_id;
        eps.push({id: vid, name: name});
    }
    if (!segments.length) {
        eps.push({id: uuid + "|" + pageCat, name: "正片"});
    }
    return {
        id: nid, title: title, cover: cover, desc: title,
        tags: actors,
        lines: [{name: "在线播放", episodes: eps}],
    };
}

async function resolveMaster(streamUrl, headers) {
    try {
        const resp = await rawRequest(streamUrl, headers);
        const text = resp.body || "";
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return streamUrl;
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s.charAt(0) !== "#");
        if (lines.length) return host.url.resolve(streamUrl, lines[0]);
    } catch (error) {
        // Keep the master URL; the player can still walk it.
    }
    return streamUrl;
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
    if (!raw) throw host.error("E_PARSE", "empty play id");
    if (raw.indexOf("leaks|") === 0) {
        const parts = raw.slice("leaks|".length).split("|");
        const postId = parts[0] || "";
        const index = parts.length > 1 ? (parseInt(parts[1], 10) || 0) : 0;
        const body = JSON.stringify({post_id: postId, index: index});
        let url = "";
        try {
            const resp = await rawRequest(BASE + "/ajax/site/get_tg_video.php", {
                "Referer": BASE + "/leaks_zone.php",
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
            }, body, "POST");
            const v = JSON.parse(resp.body || "{}");
            url = (v && v.url) || "";
        } catch (error) {
            url = "";
        }
        if (!url) throw host.error("E_PARSE", "leaks play returned no url");
        const isHls = /\.m3u8($|\?)/i.test(url);
        const headers = {"User-Agent": UA, "Referer": BASE + "/leaks_zone.php"};
        const finalUrl = isHls ? await resolveMaster(url, headers) : url;
        return {
            streams: [{
                url: finalUrl, format: isHls ? "hls" : "mp4",
                headers: headers, name: "在线播放",
            }],
            expiresAt: Date.now() + 3600 * 1000,
        };
    }
    const parts = raw.split("|");
    const uuid = parts[0] || "";
    const pageCat = parts.length > 1 ? parts[1] : "19";
    if (!uuid) throw host.error("E_PARSE", "play id has no uuid");
    let url = "";
    if (parts.length >= 3 && parts[2] === "preview") {
        url = await getPreview(uuid, pageCat, parts.length >= 4 ? parts[3] : "");
    } else if (parts.length >= 7) {
        url = await getMv(uuid, pageCat, parts[2], parts[3], parts[4], parts[5], parts[6]);
    } else {
        const html = await getPage("/player.php?uuid=" + uuid + "&cat=" + pageCat);
        const segs = parseSegments(html);
        if (segs.length) {
            const seg = segs[0];
            url = await getMv(uuid, pageCat, seg.ms_id, seg.start, seg.end, seg.token, seg.cat_id);
        }
    }
    if (!url) throw host.error("E_PARSE", "play returned no url for " + uuid);
    const headers = {
        "User-Agent": UA,
        "Referer": BASE + "/player.php?uuid=" + uuid + "&cat=" + pageCat,
    };
    const isHls = /\.m3u8($|\?)/i.test(url);
    const finalUrl = isHls ? await resolveMaster(url, headers) : url;
    return {
        streams: [{
            url: finalUrl, format: isHls ? "hls" : "mp4",
            headers: headers, name: "在线播放",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
