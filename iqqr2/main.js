// iQQTV (iqqr2.org) - idj1 plugin, rewritten 1:1 from the py spider iqqr2.
// Categories match the py exactly: jp / cn / free (no additions, no removals).
// The py playerContent returns an empty url; the real guest stream is set by
// the site player script on player.php, so play() re-fetches the player page
// and extracts the stream the same way the page does. This is the user's own
// site: free/guest playback is a short preview only - nothing here tries to
// bypass the VIP wall, the preview stream is returned as-is.

const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const BASE = "https://iqqr2.org";
const TIMEOUT = 58000;

const CATEGORIES = [
    ["jp", "日本"],
    ["cn", "國產"],
    ["free", "免費"],
];

const RE_CARD = /player\.php\?uuid=([A-Za-z0-9]+)(?:&amp;|&)cat=(\d+)/g;
const RE_TOTAL = /共\s*(\d+)\s*部/;
const RE_H1 = /<h1[^>]*>([\s\S]*?)<\/h1>/;
const RE_TAG = /s_type=tag&s_tid=\d+[^>]*>([^<]+)<\/a>/g;
const RE_M3U8 = /https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*/g;
const RE_MP4 = /https?:\/\/[^\s"'<>]+?\.mp4(?:\?[^\s"'<>]*)?/g;

function str(value) {
    if (value == null) return "";
    return String(value);
}

function intValue(value, fallback) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : fallback;
}

function txt(s) {
    if (!s) return "";
    return str(s)
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function escRe(s) {
    return str(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function httpGet(url, referer, tries) {
    const headers = {
        "User-Agent": UA,
        "Referer": referer || (BASE + "/"),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    };
    const attempts = tries || 3;
    let lastBody = "";
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
            if (resp && resp.body) {
                lastBody = resp.body;
                if (resp.status >= 200 && resp.status < 400) return resp.body;
            }
        } catch (error) {
            // sequential retries only, never parallel bursts
        }
    }
    return lastBody;
}

function listUrl(tid, pg) {
    if (tid === "jp") return BASE + "/search.php?order=latest&s_type=jp&s_tid=37&num=" + pg;
    if (tid === "cn") return BASE + "/zone_index.php?zone=1";
    if (tid === "free") return BASE + "/?cat=free";
    return BASE + "/search.php?order=latest&s_type=jp&s_tid=37&num=" + pg;
}

function coverFor(html, uuid) {
    const re = new RegExp("https://(?:iqqr2\\.org|iqqbl\\.com|iqqtv\\.net)/preview/[^\"' ]*" + escRe(uuid) + "-800\\.jpg[^\"' ]*");
    const m = re.exec(html || "");
    return m ? m[0].replace(/&amp;/g, "&") : "";
}

function parseCards(html) {
    const out = [];
    if (!html) return out;
    const seen = {};
    RE_CARD.lastIndex = 0;
    let m;
    while ((m = RE_CARD.exec(html)) !== null) {
        const uuid = m[1];
        const cat = m[2];
        if (seen[uuid]) continue;
        seen[uuid] = true;
        const cover = coverFor(html, uuid);
        let title = uuid;
        const tm = new RegExp("<a[^>]*player\\.php\\?uuid=" + escRe(uuid) + "[^>]*>([\\s\\S]*?)</a>").exec(html);
        if (tm) {
            const t = txt(tm[1]);
            if (t && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) title = t;
        }
        if (title === uuid) {
            const am = new RegExp("player\\.php\\?uuid=" + escRe(uuid) + "[\\s\\S]{0,1200}?alt=['\"]([^'\"]+)['\"]").exec(html);
            if (am && txt(am[1])) title = txt(am[1]);
        }
        let dur = "";
        const dm = new RegExp(escRe(uuid) + "[^<]{0,2000}?(\\d{1,2}:\\d{2}:\\d{2}|\\d{1,2}:\\d{2})").exec(html);
        if (dm) dur = dm[1];
        if (!dur) {
            const seg = html.slice(m.index, m.index + 1600);
            const dt = /data-time="(\d+)"/.exec(seg);
            if (dt) {
                const sec = intValue(dt[1], 0);
                if (sec > 0) {
                    const pad = (n) => (n < 10 ? "0" + n : "" + n);
                    dur = Math.floor(sec / 3600) + ":" + pad(Math.floor((sec % 3600) / 60)) + ":" + pad(sec % 60);
                }
            }
        }
        out.push({id: uuid + "|" + cat, title: title, cover: cover, remarks: dur, duration: dur, tags: []});
    }
    return out;
}

function totalOf(html) {
    const pm = RE_TOTAL.exec(html || "");
    return pm ? intValue(pm[1], 0) : 0;
}

function pagecountOf(total, tid) {
    if (tid === "cn" || tid === "free") return 1;
    if (total > 0) return Math.floor((total + 47) / 48);
    return 1;
}

async function home() {
    const categories = CATEGORIES.map((item) => ({id: item[0], name: item[1]}));
    const html = await httpGet(listUrl("jp", 1));
    const items = parseCards(html);
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "jp";
    const html = await httpGet(listUrl(tid, pg));
    const items = parseCards(html);
    const total = totalOf(html);
    return {items: items, hasMore: pg < pagecountOf(total, tid)};
}

async function search(arg) {
    const pg = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const url = BASE + "/search.php?kw_type=key&kw=" + encodeURIComponent(keyword) + "&num=" + pg;
    const html = await httpGet(url);
    const items = parseCards(html);
    const total = totalOf(html);
    const pagecount = total > 0 ? Math.floor((total + 47) / 48) : 1;
    return {items: items, hasMore: pg < pagecount};
}

function splitId(id) {
    const parts = str(id).split("|");
    return {uuid: parts[0] || "", cat: parts[1] || "19"};
}

async function detail(arg) {
    const parsed = splitId(arg && arg.id);
    if (!parsed.uuid) throw new Error("invalid video id");
    const url = BASE + "/player.php?uuid=" + parsed.uuid + "&cat=" + parsed.cat;
    const html = await httpGet(url);
    let title = parsed.uuid;
    const tm = RE_H1.exec(html || "");
    if (tm && txt(tm[1])) title = txt(tm[1]);
    const cover = coverFor(html, parsed.uuid);
    const tags = [];
    RE_TAG.lastIndex = 0;
    let gm;
    while ((gm = RE_TAG.exec(html || "")) !== null) {
        const t = txt(gm[1]);
        if (t && tags.indexOf(t) < 0) tags.push(t);
    }
    const lines = [{name: "在线播放", episodes: [{id: str(arg && arg.id), name: "全片"}]}];
    return {
        id: str(arg && arg.id),
        title: title,
        cover: cover,
        desc: tags.length ? tags.join(",") : "",
        tags: tags,
        lines: lines,
    };
}

function resolveRel(base, rel) {
    rel = str(rel).trim();
    if (!rel) return base;
    if (/^https?:\/\//i.test(rel)) return rel;
    if (rel.indexOf("//") === 0) return "https:" + rel;
    if (rel.indexOf("/") === 0) {
        const m = /^(https?:\/\/[^/]+)/i.exec(base || "");
        return m ? m[1] + rel : rel;
    }
    const cut = str(base).split("?")[0];
    const idx = cut.lastIndexOf("/");
    return (idx >= 0 ? cut.slice(0, idx + 1) : "") + rel;
}

async function resolveMaster(url, headers) {
    let current = url;
    for (let level = 0; level < 2; level++) {
        let body = "";
        try {
            const resp = await host.http.get(current, {headers: headers, timeout: TIMEOUT});
            if (resp && resp.body) body = resp.body;
        } catch (error) {
            break;
        }
        if (!body || body.indexOf("#EXT-X-STREAM-INF") < 0) break;
        const lines = body.split(/\r?\n/).map((s) => s.trim()).filter((s) => s);
        let child = "";
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].indexOf("#") !== 0) { child = lines[j]; break; }
                }
                break;
            }
        }
        if (!child) break;
        current = resolveRel(current, child);
    }
    return current;
}

async function play(arg) {
    const rawId = str((arg && arg.episodeId) || (arg && arg.id));
    const parsed = splitId(rawId);
    if (!parsed.uuid) throw new Error("invalid play id");
    const pageUrl = BASE + "/player.php?uuid=" + parsed.uuid + "&cat=" + parsed.cat;
    const html = await httpGet(pageUrl);
    const headers = {"User-Agent": UA, "Referer": BASE + "/"};
    let streamUrl = "";
    let format = "";
    // Primary path, exactly what the site player does for guests: the
    // player page carries one element flagged is_free_preview="true";
    // clicking it calls subpage/getMv.php with that element's attributes
    // and the JSON answer holds vurl / vurl_hls (the free preview stream
    // the server grants to guests). Paid parts are never requested.
    if (html) {
        const tagM = /<[a-z]+[^>]*is_free_preview="true"[^>]*>/.exec(html);
        if (tagM) {
            const tag = tagM[0];
            const attr = (name) => {
                const am = new RegExp(name + "=\"([^\"]*)\"").exec(tag);
                return am ? am[1] : "";
            };
            const q = "num=" + encodeURIComponent(parsed.uuid)
                + "&ms_id=" + encodeURIComponent(attr("ms_id"))
                + "&file_prefix=" + encodeURIComponent(attr("file_prefix"))
                + "&start=" + encodeURIComponent(attr("start"))
                + "&end=" + encodeURIComponent(attr("end"))
                + "&cat_id=" + encodeURIComponent(attr("cat_id") || "15")
                + "&quality=1"
                + "&token=" + encodeURIComponent(attr("token"))
                + "&playall=false";
            // Single attempt only: without a login session this answers
            // loginFail, and the fallback below must not be delayed.
            const respText = await httpGet(BASE + "/subpage/getMv.php?" + q, pageUrl, 1);
            if (respText) {
                try {
                    const data = JSON.parse(respText);
                    if (data && !data.loginFail && !data.error) {
                        if (data.vurl_hls) {
                            streamUrl = str(data.vurl_hls).replace(/&amp;/g, "&");
                            format = "hls";
                        } else if (data.vurl) {
                            streamUrl = str(data.vurl).replace(/&amp;/g, "&");
                            format = /\.m3u8($|\?)/i.test(streamUrl) ? "hls" : "mp4";
                        }
                    }
                } catch (error) {
                    // fall through to the page-embedded fallbacks
                }
            }
        }
    }
    if (!streamUrl && html) {
        // The player page play button carries data-preview-video-url: the
        // guest/free stream endpoint (redirects to a preview mp4 on the
        // media CDN). That is the only stream a free account gets.
        const pm = /data-preview-video-url="([^"]+)"/.exec(html);
        if (pm) {
            let u = pm[1].replace(/&amp;/g, "&");
            if (u.indexOf("//") === 0) u = "https:" + u;
            else if (u.indexOf("/") === 0) u = BASE + u;
            streamUrl = u;
            format = /\.m3u8($|\?)/i.test(u) ? "hls" : "mp4";
        }
    }
    if (!streamUrl && html) {
        RE_M3U8.lastIndex = 0;
        const m3u8s = html.match(RE_M3U8) || [];
        if (m3u8s.length) {
            streamUrl = m3u8s[0].replace(/&amp;/g, "&");
            format = "hls";
        }
    }
    if (!streamUrl && html) {
        const dm = new RegExp("data-videourl=\"([^\"]*" + escRe(parsed.uuid) + "[^\"]*)\"").exec(html);
        if (dm) {
            let u = dm[1].replace(/&amp;/g, "&");
            if (u.indexOf("//") === 0) u = "https:" + u;
            else if (u.indexOf("/") === 0) u = BASE + u;
            streamUrl = u;
            format = /\.m3u8($|\?)/i.test(u) ? "hls" : "mp4";
        }
    }
    if (!streamUrl && html) {
        RE_MP4.lastIndex = 0;
        const mp4s = (html.match(RE_MP4) || []).filter((u) => u.indexOf(parsed.uuid) >= 0);
        if (mp4s.length) {
            streamUrl = mp4s[0].replace(/&amp;/g, "&");
            format = "mp4";
        }
    }
    if (!streamUrl) throw new Error("no playable stream found on player page");
    if (format === "hls") {
        streamUrl = await resolveMaster(streamUrl, headers);
    }
    if (streamUrl.indexOf("getMvPreview.php") >= 0) {
        // Resolve the two 301 hops (site -> canonical mirror -> media CDN)
        // inside play() so the player gets the direct CDN mp4 URL.
        try {
            const resp = await host.http.get(streamUrl, {
                headers: {"User-Agent": UA, "Referer": BASE + "/", "Range": "bytes=0-0"},
                timeout: TIMEOUT,
            });
            if (resp && resp.url && resp.url !== streamUrl && /\.mp4($|\?)/i.test(resp.url)) {
                streamUrl = resp.url;
            }
        } catch (error) {
            // keep the endpoint URL; players follow the redirects themselves
        }
    }
    return {
        streams: [{url: streamUrl, format: format, headers: headers, name: "在线播放"}],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
