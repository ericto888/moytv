// 红楼资源 — idj1 plugin (ported 1:1 from the builtin py spider honglouzy)
// Site API: https://www.hlzyapi.vip/api.php/provide/vod/at/json (MacCMS
// resource API, JSON first, XML fallback exactly like the py _fetch).
// Categories: live class from the API, filtered with the py flag filter
// (DROP_WORDS 游戏/棋牌/博彩/彩票/赌, EXCLUDED_IDS empty); fallback cats are
// the py FALLBACK_CATS (42 entries) when the live list filters to empty.
// List items missing vod_pic are enriched through one detail call (py _enrich).
// Play: detail vod_play_url entries are direct streams; playerContent in the
// py just passes the URL through (id carrying "$" keeps only the last part).

const BASE = "https://www.hlzyapi.vip";
const API_JSON = BASE + "/api.php/provide/vod/at/json";
const API_XML = BASE + "/api.php/provide/vod/at/xml";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT = 60000;

const FALLBACK_CATS = [["21", "原创乱伦"], ["22", "鬼父操女"], ["23", "中文字幕"], ["24", "制服诱惑"], ["25", "嫂子诱惑"], ["26", "姐夫小姨子"], ["27", "兄弟姐妹"], ["28", "风韵岳母"], ["29", "乱伦专区"], ["30", "日韩专区"], ["31", "精品专区"], ["32", "吃瓜黑料"], ["33", "酒店探花"], ["34", "儿媳献穴"], ["35", "SM调教"], ["37", "AI换脸"], ["38", "国产主播"], ["39", "AV解说"], ["40", "家族淫趴"], ["41", "淫母兽儿"], ["59", "欧美劲爆"], ["60", "SM重味"], ["61", "伦理影片"], ["64", "日韩无码"], ["65", "强奸乱伦"], ["67", "野战车震"], ["68", "熟女少妇"], ["69", "反差母狗"], ["71", "人妻巨乳"], ["72", "站长推荐"], ["73", "自拍偷拍"], ["74", "教师学生"], ["75", "3D动漫"], ["77", "日韩精品"], ["78", "撸管必看"], ["79", "短视频"], ["90", "国产传媒"], ["91", "直播裸聊"], ["92", "成人动漫"]];
const EXCLUDED_IDS = [];
const DROP_WORDS = ["游戏", "棋牌", "博彩", "彩票", "赌"];

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function normPg(pg) {
    const n = intValue(pg, 1);
    return n >= 1 ? n : 1;
}

function headers() {
    return {
        "User-Agent": UA,
        "Accept": "application/json,text/xml,text/html,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": BASE + "/",
    };
}

async function getText(url) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await host.http.get(url, {headers: headers(), timeout: TIMEOUT});
            if (resp.status === 200 || resp.status === 206) return resp.body || "";
            lastError = new Error("HTTP " + resp.status);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) host.log("honglouzy getText failed", url, String(lastError && lastError.message));
    return "";
}

function normJsonRecord(item) {
    return {
        vod_id: str(item.vod_id),
        vod_name: str(item.vod_name),
        vod_pic: str(item.vod_pic),
        vod_remarks: str(item.vod_remarks),
        type_id: str(item.type_id),
        type_name: str(item.type_name),
        vod_actor: str(item.vod_actor),
        vod_director: str(item.vod_director),
        vod_year: str(item.vod_year),
        vod_area: str(item.vod_area),
        vod_content: str(item.vod_content || item.vod_blurb),
        vod_class: str(item.vod_class),
        vod_play_from: str(item.vod_play_from),
        vod_play_url: str(item.vod_play_url),
    };
}

function parseJson(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        return null;
    }
    if (!data || typeof data !== "object" || !("list" in data)) return null;
    const records = [];
    for (const item of data.list || []) {
        if (item && typeof item === "object") records.push(normJsonRecord(item));
    }
    const cats = [];
    for (const item of data.class || []) {
        if (!item || typeof item !== "object") continue;
        const tid = str(item.type_id);
        const name = str(item.type_name);
        if (tid && name) cats.push([tid, name]);
    }
    return {
        list: records,
        "class": cats,
        page: intValue(data.page, 1),
        pagecount: intValue(data.pagecount, 0),
        total: intValue(data.total, 0),
    };
}

function xmlUnescape(s) {
    return String(s || "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&amp;/g, "&")
        .trim();
}

function xmlTag(block, tag) {
    const m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">").exec(block);
    return m ? xmlUnescape(m[1]) : "";
}

function xmlAttr(tagText, name) {
    const m = new RegExp(name + "\\s*=\\s*\"([^\"]*)\"").exec(tagText || "");
    return m ? m[1].trim() : "";
}

function parseXml(text) {
    if (!text || !/<rss[\s>]/.test(text)) return null;
    const cats = [];
    const classMatch = /<class(?:\s[^>]*)?>([\s\S]*?)<\/class>/.exec(text);
    if (classMatch) {
        const tyRe = /<ty\s+([^>]*)>([\s\S]*?)<\/ty>/g;
        let m;
        while ((m = tyRe.exec(classMatch[1])) !== null) {
            const tid = xmlAttr(m[1], "id");
            const name = xmlUnescape(m[2]);
            if (tid && name) cats.push([tid, name]);
        }
    }
    let page = 1, pagecount = 0, total = 0;
    const records = [];
    const listMatch = /<list\s+([^>]*)>([\s\S]*?)<\/list>/.exec(text);
    if (listMatch) {
        page = intValue(xmlAttr(listMatch[1], "page"), 1);
        pagecount = intValue(xmlAttr(listMatch[1], "pagecount"), 0);
        total = intValue(xmlAttr(listMatch[1], "recordcount"), 0);
        const videoRe = /<video(?:\s[^>]*)?>([\s\S]*?)<\/video>/g;
        let vm;
        while ((vm = videoRe.exec(listMatch[2])) !== null) {
            const block = vm[1];
            const playFrom = [];
            const playUrl = [];
            const dlMatch = /<dl(?:\s[^>]*)?>([\s\S]*?)<\/dl>/.exec(block);
            if (dlMatch) {
                const ddRe = /<dd\s+([^>]*)>([\s\S]*?)<\/dd>/g;
                let dm;
                while ((dm = ddRe.exec(dlMatch[1])) !== null) {
                    playFrom.push(xmlAttr(dm[1], "flag"));
                    playUrl.push(xmlUnescape(dm[2]));
                }
            }
            records.push({
                vod_id: xmlTag(block, "id"),
                vod_name: xmlTag(block, "name"),
                vod_pic: xmlTag(block, "pic"),
                vod_remarks: xmlTag(block, "note") || xmlTag(block, "state"),
                type_id: xmlTag(block, "tid"),
                type_name: xmlTag(block, "type"),
                vod_actor: xmlTag(block, "actor"),
                vod_director: xmlTag(block, "director"),
                vod_year: xmlTag(block, "year"),
                vod_area: xmlTag(block, "area"),
                vod_content: xmlTag(block, "des"),
                vod_class: xmlTag(block, "type"),
                vod_play_from: playFrom.join("$$$"),
                vod_play_url: playUrl.join("$$$"),
            });
        }
    }
    return {list: records, "class": cats, page: page, pagecount: pagecount, total: total};
}

async function fetchData(params) {
    const qs = host.url.encodeForm(params);
    const text = await getText(API_JSON + "?" + qs);
    const parsed = text ? parseJson(text) : null;
    if (parsed !== null && (parsed.list.length || parsed["class"].length)) return parsed;
    if (parsed !== null && params.ac === "detail") return parsed;
    const xmlText = await getText(API_XML + "?" + qs);
    const xmlParsed = xmlText ? parseXml(xmlText) : null;
    if (xmlParsed !== null) return xmlParsed;
    return {list: [], "class": [], page: 1, pagecount: 0, total: 0};
}

function keepCat(tid, name) {
    if (EXCLUDED_IDS.indexOf(tid) >= 0) return false;
    for (const word of DROP_WORDS) {
        if (name.indexOf(word) >= 0) return false;
    }
    return true;
}

function classes(live) {
    const out = [];
    const seen = new Set();
    for (const pair of live || []) {
        const tid = pair[0], name = pair[1];
        if (seen.has(tid)) continue;
        if (!keepCat(tid, name)) continue;
        seen.add(tid);
        out.push({id: tid, name: name});
    }
    if (out.length) return out;
    for (const pair of FALLBACK_CATS) {
        const tid = pair[0], name = pair[1];
        if (seen.has(tid)) continue;
        if (!keepCat(tid, name)) continue;
        seen.add(tid);
        out.push({id: tid, name: name});
    }
    return out;
}

async function enrich(records) {
    const need = records.filter(r => r.vod_id && !r.vod_pic);
    if (!need.length) return records;
    const ids = need.map(r => r.vod_id).join(",");
    const data = await fetchData({ac: "detail", ids: ids});
    const byId = {};
    for (const item of data.list || []) {
        if (item.vod_id) byId[item.vod_id] = item;
    }
    for (const record of records) {
        const extra = byId[record.vod_id || ""];
        if (extra) {
            if (!record.vod_pic && extra.vod_pic) record.vod_pic = extra.vod_pic;
            if (!record.vod_remarks && extra.vod_remarks) record.vod_remarks = extra.vod_remarks;
        }
    }
    return records;
}

function card(record) {
    const vid = str(record.vod_id);
    const name = str(record.vod_name);
    if (!vid || !name) return null;
    const item = {id: vid, title: name, remarks: str(record.vod_remarks), tags: []};
    const pic = str(record.vod_pic);
    if (pic) item.cover = pic;
    return item;
}

function cards(records) {
    const out = [];
    for (const record of records || []) {
        const c = card(record);
        if (c) out.push(c);
    }
    return out;
}

function stripHtml(text) {
    let t = String(text || "").replace(/<[^>]*>/g, " ");
    t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
    t = t.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
    return t.replace(/\s+/g, " ").trim();
}

async function home() {
    const data = await fetchData({ac: "list", pg: 1});
    const cats = classes(data["class"] || []);
    const records = await enrich(data.list || []);
    return {categories: cats, items: cards(records), hasMore: (data.pagecount || 0) > 1};
}

async function category(arg) {
    const pg = normPg(arg && arg.page);
    const tid = str(arg && arg.id);
    const params = {ac: "list", pg: pg};
    if (tid) params.t = tid;
    const data = await fetchData(params);
    const records = await enrich(data.list || []);
    return {items: cards(records), hasMore: pg < (data.pagecount || 0)};
}

async function search(arg) {
    const pg = normPg(arg && arg.page);
    const keyword = str(arg && arg.keyword);
    const data = await fetchData({ac: "list", wd: keyword, pg: pg});
    const records = await enrich(data.list || []);
    return {items: cards(records), hasMore: pg < (data.pagecount || 0)};
}

async function detail(arg) {
    const vid = str(arg && arg.id);
    if (!vid) throw host.error("E_PARSE", "missing id");
    const data = await fetchData({ac: "detail", ids: vid});
    const records = data.list || [];
    if (!records.length) throw host.error("E_PARSE", "detail not found");
    const record = records[0];
    const name = str(record.vod_name);
    if (!name) throw host.error("E_PARSE", "detail has no title");
    const froms = str(record.vod_play_from).split("$$$");
    const urls = str(record.vod_play_url).split("$$$");
    const lines = [];
    for (let i = 0; i < urls.length; i++) {
        const group = urls[i];
        if (!group) continue;
        const episodes = [];
        for (const part of group.split("#")) {
            if (!part) continue;
            let epName = "";
            let epUrl = part;
            const idx = part.indexOf("$");
            if (idx >= 0) {
                epName = part.slice(0, idx);
                epUrl = part.slice(idx + 1);
            }
            epUrl = epUrl.trim();
            if (!epUrl) continue;
            episodes.push({id: epUrl, name: epName || ("第" + (episodes.length + 1) + "集")});
        }
        if (episodes.length) {
            lines.push({name: (froms[i] || "").trim() || ("线路" + (lines.length + 1)), episodes: episodes});
        }
    }
    const tags = [];
    const typeName = str(record.type_name);
    if (typeName) tags.push(typeName);
    const vodClass = str(record.vod_class);
    if (vodClass && vodClass !== typeName) tags.push(vodClass);
    const parts = [];
    const content = stripHtml(record.vod_content);
    if (content) parts.push(content);
    const actor = str(record.vod_actor);
    if (actor) parts.push("演员：" + actor);
    const director = str(record.vod_director);
    if (director) parts.push("导演：" + director);
    const year = str(record.vod_year);
    if (year) parts.push("年份：" + year);
    const area = str(record.vod_area);
    if (area) parts.push("地区：" + area);
    const remarks = str(record.vod_remarks);
    if (remarks) parts.push("备注：" + remarks);
    const out = {
        id: vid,
        title: name,
        desc: parts.join("\n"),
        tags: tags,
        lines: lines,
    };
    const pic = str(record.vod_pic);
    if (pic) out.cover = pic;
    return out;
}

async function play(arg) {
    let raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (raw.indexOf("$") >= 0) raw = raw.slice(raw.lastIndexOf("$") + 1).trim();
    let stream = raw.indexOf("http") === 0 ? raw : "";
    if (!stream) throw host.error("E_PARSE", "no stream url");
    if (stream.indexOf("http://") === 0) stream = "https://" + stream.slice(7);
    const isHls = /\.m3u8($|\?)/i.test(stream);
    // master 主清单在 play 内预解析到子清单再返回；失败保留主清单。
    if (isHls) {
        try {
            const resp = await host.http.get(stream, {
                headers: {"User-Agent": UA, "Referer": BASE + "/"},
                timeout: TIMEOUT,
            });
            const pl = resp && resp.body ? String(resp.body) : "";
            if (pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
                const ls = pl.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
                if (ls.length) stream = host.url.resolve(stream, ls[0]);
            }
        } catch (e) {}
    }
    return {
        streams: [{
            url: stream,
            format: isHls ? "hls" : "video",
            headers: {"User-Agent": UA, "Referer": BASE + "/"},
            name: "红楼资源",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
