// 嘿嘿资源 — idj1 plugin (ported 1:1 from the builtin py spider heiheizy)
// Site API: https://api.heiapi.cc/api.php/provide/vod/at/json (MacCMS resource
// API, JSON first, XML fallback exactly like the py _fetch).
// Categories come from the API class list, filtered exactly like the py
// (EXCLUDED_IDS = [], DROP_WORDS game/gambling words), with the py
// FALLBACK_CATS (65 entries, ids 48-112) used when the live class list yields nothing.
// List items missing vod_pic are enriched through one detail call, exactly
// like the py _enrich.
// Play: detail vod_play_url entries are direct streams; the py playerContent passes the URL through, and
// here a master playlist (#EXT-X-STREAM-INF) is pre-resolved to its first
// variant sub-playlist inside play.

const BASE = "https://api.heiapi.cc";
const API_JSON = BASE + "/api.php/provide/vod/at/json";
const API_XML = BASE + "/api.php/provide/vod/at/xml";
const KEY = "heiheizy";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT = 60000;

const FALLBACK_CATS = [
    ["48", "国产视频"],
    ["49", "国产自拍"],
    ["50", "国产偷拍"],
    ["51", "国产探花"],
    ["52", "国产主播"],
    ["53", "国产户外"],
    ["54", "黑料吃瓜"],
    ["55", "传媒厂商"],
    ["56", "麻豆传媒"],
    ["57", "精东影业"],
    ["58", "蜜桃传媒"],
    ["59", "果冻传媒"],
    ["60", "天美传媒"],
    ["61", "星空传媒"],
    ["62", "皇家华人"],
    ["63", "起点传媒"],
    ["64", "渡边传媒"],
    ["65", "葫芦影业"],
    ["66", "红斯灯影像"],
    ["67", "水果派解说"],
    ["68", "SA传媒"],
    ["69", "糖心Vlog"],
    ["70", "性视界"],
    ["71", "水果派解说"],
    ["72", "日本AV"],
    ["73", "日本无码"],
    ["74", "日本有码"],
    ["75", "中字无码"],
    ["76", "中字有码"],
    ["77", "特殊嗜好"],
    ["78", "绿帽换妻"],
    ["79", "SM调教"],
    ["80", "男同系列"],
    ["81", "女同系列"],
    ["82", "乱伦系列"],
    ["83", "网黄自制"],
    ["84", "台北娜娜"],
    ["85", "玩偶姐姐"],
    ["86", "饼干姐姐"],
    ["87", "黑椒盖饭"],
    ["88", "冉冉学姐"],
    ["89", "小水水"],
    ["90", "柚子猫"],
    ["91", "捅主任"],
    ["92", "鸡教练"],
    ["93", "刘玥"],
    ["94", "三级伦理"],
    ["95", "国产伦理"],
    ["96", "香港伦理"],
    ["97", "台湾伦理"],
    ["98", "韩国伦理"],
    ["99", "日本伦理"],
    ["100", "西方伦理"],
    ["101", "欧美AV"],
    ["102", "美女写真"],
    ["103", "成人动漫"],
    ["104", "扣扣传媒"],
    ["105", "爱豆传媒"],
    ["106", "乌托邦传媒"],
    ["107", "爱神传媒"],
    ["108", "香蕉传媒"],
    ["109", "大象传媒"],
    ["110", "其他传媒"],
    ["111", "米菲兔"],
    ["112", "短视频"],
];
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
    if (lastError) host.log("heiheizy getText failed", url, String(lastError && lastError.message));
    return "";
}

// ---------- record normalization (py _norm_json_record / _norm_xml_record) ----------

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

// ---------- minimal MacCMS XML parsing (py _parse_xml equivalent) ----------

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

// ---------- fetch (py _fetch: JSON first, XML fallback) ----------

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

// ---------- categories (py _keep_cat / _classes, flag filter copied as-is) ----------

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

// ---------- enrich (py _enrich: fill missing covers via one detail call) ----------

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

// ---------- cards (py _card / _cards) ----------

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

// ---------- master playlist pre-resolve ----------

// A line may hand out a master playlist (#EXT-X-STREAM-INF pointing at
// a variant sub-playlist). Resolve it to the first variant here so the host
// player receives a media playlist directly. Any failure falls back to the
// original URL.
async function resolveMaster(url, streamHeaders) {
    try {
        const resp = await host.http.get(url, {headers: streamHeaders, timeout: TIMEOUT});
        if (resp.status !== 200 && resp.status !== 206) return url;
        const text = resp.body || "";
        if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/).map(s => s.trim());
        for (const line of lines) {
            if (line && line.charAt(0) !== "#") {
                return host.url.resolve(url, line);
            }
        }
        return url;
    } catch (error) {
        host.log("heiheizy resolveMaster failed", url, String(error && error.message));
        return url;
    }
}

// ---------- idj1 contract ----------

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
    // py playerContent: if the id carries "name$url", keep only the part
    // after the last "$".
    if (raw.indexOf("$") >= 0) raw = raw.slice(raw.lastIndexOf("$") + 1).trim();
    if (raw.indexOf("http") !== 0) throw host.error("E_PARSE", "no stream url");
    // py only hands https streams to the host; a non-https URL would be
    // dropped by the host, so surface it as an error instead.
    if (raw.indexOf("https://") !== 0) throw host.error("E_PARSE", "stream is not https");
    const streamHeaders = {"User-Agent": UA, "Referer": BASE + "/"};
    const isHls = /\.m3u8($|\?)/i.test(raw);
    let url = raw;
    if (isHls) url = await resolveMaster(raw, streamHeaders);
    return {
        streams: [{
            url: url,
            format: isHls ? "hls" : "video",
            headers: streamHeaders,
            name: "嘿嘿资源",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
