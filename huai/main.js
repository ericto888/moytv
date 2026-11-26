// huai (HuanAi) — idj1 plugin, rewritten 1:1 from the builtin py spider.
// API site: https://sjgyoptiq.hjfwoz.com ; cover CDN: https://soost.hnxyjws.com
// Flow: auto-register with a fixed invite code to get a token, category list
// via /api/film-b/paginate, detail via /api/film-b/watch, and when the watch
// URL turns out to be a short preview the plugin farms one invite reward and
// buys the full version with coins, exactly like the py original.

const BASE = "https://sjgyoptiq.hjfwoz.com";
const S3 = "https://soost.hnxyjws.com";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const INVITE_CODE = "UYJQFG";
const PAGE_SIZE = 20;
const PAGE_ITEMS = 10;
const TIMEOUT = 55000;

const CATS = [
    [6, "国产传媒"], [1, "日本有码"], [3, "中文字幕"], [17, "黑料吃瓜"],
    [4, "欧美性爱"], [9, "网红主播"], [15, "探花"], [2, "日本无码"],
    [5, "自拍偷拍"], [7, "动漫卡通"], [8, "强奸乱伦"], [14, "AV解说"],
    [16, "热舞"], [10, "重口猎奇"], [11, "同性专区"], [12, "其他"],
    [13, "短视频"],
];
const CAT_IDS = {};
for (const c of CATS) CAT_IDS[c[0]] = true;

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- response decoding ----------

// Site sometimes answers text/plain with a Caesar-shifted (+8) base64 JSON.
function caesarDecode(text) {
    try {
        let shifted = "";
        for (let i = 0; i < text.length; i++) {
            shifted += String.fromCharCode(text.charCodeAt(i) - 8);
        }
        const clean = shifted.replace(/\s+/g, "");
        const decoded = host.codec.base64Decode(clean, {to: "utf8"});
        return JSON.parse(decoded);
    } catch (error) {
        return null;
    }
}

// ---------- HTTP / API ----------

function apiHeaders(token) {
    const h = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Vue-Path": "/",
        "Referer": BASE + "/",
    };
    if (token) h["token"] = token;
    return h;
}

async function callOnce(method, path, body, token) {
    const url = BASE + path;
    const headers = apiHeaders(token);
    let resp;
    if (method === "POST") {
        headers["Content-Type"] = "application/json";
        resp = await host.http.post(url, body != null ? body : "{}", {headers: headers, timeout: TIMEOUT});
    } else {
        resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
    }
    if (resp.status !== 200) throw new Error("HTTP " + resp.status);
    const ct = str((resp.headers || {})["content-type"]).toLowerCase();
    if (ct.indexOf("text/plain") >= 0) {
        const v = caesarDecode(resp.body || "");
        if (v !== null) return v;
    }
    return JSON.parse(resp.body);
}

async function callApi(method, path, body, token) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await callOnce(method, path, body, token);
        } catch (error) {
            lastError = error;
            if (attempt < 2) await sleep(1000);
        }
    }
    throw lastError || new Error("request failed");
}

function checkData(v) {
    if (!v || typeof v !== "object") throw new Error("bad response");
    if (v.code !== 0) throw new Error("api code " + v.code);
    return v.data;
}

// ---------- session (auto register) ----------

let sessionCache = null;

function loadSession() {
    if (sessionCache && sessionCache.token) return sessionCache;
    try {
        const t = host.storage.get("huai_token");
        const ic = host.storage.get("huai_invite");
        if (t) {
            sessionCache = {token: t, invite_code: ic || ""};
            return sessionCache;
        }
    } catch (error) {}
    return null;
}

function saveSession(sess) {
    sessionCache = sess;
    try {
        host.storage.set("huai_token", sess.token || "");
        host.storage.set("huai_invite", sess.invite_code || "");
    } catch (error) {}
}

function clearSession() {
    sessionCache = null;
    try {
        host.storage.remove("huai_token");
        host.storage.remove("huai_invite");
    } catch (error) {}
}

async function registerWith(inviteCode) {
    const body = JSON.stringify({inviteCode: inviteCode, sourceUrl: null});
    const v = await callApi("POST", "/api/user/register", body, null);
    const data = checkData(v) || {};
    const token = str(data.token);
    const invite = str(data.inviteCode);
    if (!token) throw new Error("register returned no token");
    return {token: token, invite_code: invite};
}

async function session() {
    const s = loadSession();
    if (s) return s;
    const fresh = await registerWith(INVITE_CODE);
    saveSession(fresh);
    return fresh;
}

// ---------- coin unlock (preview -> full) ----------

async function balance(token) {
    const v = await callApi("GET", "/api/user/home", null, token);
    const data = checkData(v) || {};
    const ca = data.readCoinAccount || {};
    const n = parseFloat(ca.availableAmount);
    return isFinite(n) ? n : 0;
}

async function farmInvite(sess) {
    if (!sess.invite_code) throw new Error("no invite code");
    const body = JSON.stringify({inviteCode: sess.invite_code, sourceUrl: null});
    const v1 = await callApi("POST", "/api/user/register", body, null);
    checkData(v1);
    const v2 = await callApi("POST", "/api/task/receive-reward?serialNum=1&taskId=1", "{}", sess.token);
    checkData(v2);
}

async function buy(token, vodId) {
    const v = await callApi("GET", "/api/film-b/buy?vodId=" + vodId, null, token);
    checkData(v);
}

async function ensureFull(vodId) {
    let sess = await session();
    for (let round = 0; round < 2; round++) {
        try {
            if (await balance(sess.token) >= 1000) {
                await buy(sess.token, vodId);
                return sess;
            }
        } catch (error) {}
        try {
            await farmInvite(sess);
        } catch (error) {
            clearSession();
            sess = await session();
            continue;
        }
        try {
            if (await balance(sess.token) >= 1000) {
                await buy(sess.token, vodId);
                return sess;
            }
        } catch (error) {}
        clearSession();
        sess = await session();
    }
    throw new Error("unlock failed: invite reward not credited");
}

// ---------- helpers ----------

function coverUrl(p) {
    p = str(p);
    if (!p) return "";
    if (p.indexOf("http://") === 0 || p.indexOf("https://") === 0) return p;
    if (p.indexOf("//") === 0) return "https:" + p;
    if (p.indexOf("/") === 0) return S3 + p;
    return S3 + "/" + p;
}

function card(v) {
    if (!v || typeof v !== "object") return null;
    const vid = intValue(v.vodId, 0);
    if (!vid) return null;
    const title = str(v.vodName);
    if (!title) return null;
    return {
        id: String(vid),
        title: title,
        cover: coverUrl(v.vodPic),
        remarks: str(v.vodDuration),
        duration: str(v.vodDuration),
        tags: [],
    };
}

function parseDuration(text) {
    let total = 0;
    const parts = str(text).split(":");
    for (const p of parts) {
        const n = parseFloat(p);
        total = total * 60 + (isFinite(n) ? n : 0);
    }
    return total;
}

function playlistSeconds(text) {
    let total = 0;
    for (const line of String(text || "").split(/\r?\n/)) {
        if (line.indexOf("#EXTINF:") === 0) {
            const rest = line.slice(8);
            let num = "";
            for (const ch of rest) {
                if ((ch >= "0" && ch <= "9") || ch === ".") num += ch;
                else break;
            }
            const n = parseFloat(num);
            if (isFinite(n)) total += n;
        }
    }
    return total;
}

async function fetchText(url, referer) {
    const h = {"User-Agent": UA};
    if (referer) h["Referer"] = referer;
    try {
        const resp = await host.http.get(url, {headers: h, timeout: TIMEOUT});
        if (resp.status !== 200) return "";
        return resp.body || "";
    } catch (error) {
        return "";
    }
}

async function playlistIsPreview(url, cardSecs) {
    if (cardSecs <= 0) return false;
    const text = await fetchText(url, BASE + "/");
    const total = playlistSeconds(text);
    return total > 0 && total < cardSecs / 2;
}

function watchLines(playUrl) {
    const out = [];
    for (let part of String(playUrl || "").split("$$$")) {
        part = part.trim();
        if (!part) continue;
        const idx = part.indexOf("$");
        if (idx >= 0) {
            const name = part.slice(0, idx).trim();
            const url = part.slice(idx + 1).trim();
            if (url) out.push([name, url]);
        } else {
            out.push(["在线播放", part]);
        }
    }
    if (!out.length) out.push(["在线播放", ""]);
    return out;
}

function absPlayUrl(u) {
    u = str(u);
    if (!u) return "";
    if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) return u;
    if (u.indexOf("/") === 0) return BASE + u;
    return BASE + "/" + u;
}

async function fetchWatch(vodId, token) {
    const v = await callApi("GET", "/api/film-b/watch?vodId=" + vodId, null, token);
    return checkData(v) || {};
}

// If the play URL is a master playlist, resolve it to the best variant
// sub-playlist so the player gets a media playlist directly.
async function resolveMaster(url) {
    if (!/\.m3u8($|\?)/i.test(url)) return url;
    const text = await fetchText(url, BASE + "/");
    if (!text || text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
    const lines = text.split(/\r?\n/);
    let best = "";
    let bestBw = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
            const m = /BANDWIDTH=(\d+)/.exec(line);
            const bw = m ? parseInt(m[1], 10) : 0;
            for (let j = i + 1; j < lines.length; j++) {
                const cand = lines[j].trim();
                if (!cand) continue;
                if (cand.indexOf("#") === 0) break;
                if (bw > bestBw) {
                    bestBw = bw;
                    try {
                        best = new URL(cand, url).href;
                    } catch (error) {
                        best = "";
                    }
                }
                break;
            }
        }
    }
    return best || url;
}

// ---------- categories ----------

let catsCache = null;

async function fetchCategories() {
    if (catsCache) return catsCache;
    let cats = [];
    try {
        const v = await callApi("GET", "/api/cache/common", null, null);
        const data = checkData(v) || {};
        const types = Array.isArray(data.filmBTypes) ? data.filmBTypes : [];
        const seen = {};
        for (const t of types) {
            if (!t || typeof t !== "object") continue;
            const tid = intValue(t.typeId, 0);
            const name = str(t.typeName);
            if (tid && name && !seen[tid]) {
                seen[tid] = true;
                cats.push([tid, name]);
            }
        }
    } catch (error) {
        cats = [];
    }
    if (cats.length < 10) cats = CATS.slice();
    catsCache = cats;
    return cats;
}

// ---------- list ----------

async function categoryItems(typeId, pg) {
    const sess = await session();
    const body = JSON.stringify({orderBy: "hits_day", typeId: typeId, current: pg, size: PAGE_SIZE});
    const v = await callApi("POST", "/api/film-b/paginate", body, sess.token);
    const data = checkData(v) || {};
    const total = intValue(data.total, 0);
    const records = Array.isArray(data.records) ? data.records : [];
    const items = [];
    for (const r of records) {
        const c = card(r);
        if (c) items.push(c);
    }
    const hasMore = items.length > 0 && (pg - 1) * PAGE_ITEMS + items.length < total;
    return {items: items, hasMore: hasMore};
}

// ---------- idj1 contract ----------

async function home() {
    const cats = await fetchCategories();
    const categories = cats.map((c) => ({id: String(c[0]), name: c[1]}));
    let items = [];
    try {
        const r = await categoryItems(cats[0][0], 1);
        items = r.items;
    } catch (error) {
        items = [];
    }
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const typeId = intValue(arg && arg.id, 0);
    if (!CAT_IDS[typeId]) return {items: [], hasMore: false};
    try {
        return await categoryItems(typeId, page);
    } catch (error) {
        return {items: [], hasMore: false};
    }
}

async function search(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const keyword = str(arg && arg.keyword);
    if (!keyword) return {items: [], hasMore: false};
    const sess = await session();
    const q = keyword.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const body = JSON.stringify({currentPage: 1, words: q});
    const v = await callApi("POST", "/api/film-b/search", body, sess.token);
    const data = checkData(v);
    const items = [];
    let records = [];
    if (Array.isArray(data)) records = data;
    else if (data && Array.isArray(data.records)) records = data.records;
    for (const r of records) {
        const c = card(r);
        if (c) items.push(c);
    }
    return {items: items, hasMore: false, page: page};
}

async function detail(arg) {
    const raw = str(arg && arg.id);
    const nid = raw.split("#")[0];
    if (!nid || !isFinite(parseInt(nid, 10))) {
        return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    }
    const sess = await session();
    const data = await fetchWatch(nid, sess.token);
    const title = str(data.vodName);
    if (!title) return {id: raw, title: raw, cover: "", desc: "", tags: [], lines: []};
    const tag = str(data.vodTag);
    const blurb = str(data.vodBlurb);
    const duration = str(data.vodDuration);
    const hits = intValue(data.vodHits, 0);
    let synopsis = blurb || title;
    if (tag) synopsis += "\n标签：" + tag;
    if (hits) synopsis += "\n播放：" + hits + "次";
    if (duration) synopsis += "\n片长：" + duration;
    const price = parseFloat(data.vodCoinPrice);
    if (isFinite(price) && price > 0) synopsis += "\n价格：" + Math.round(price) + "金币/片";
    const lines = watchLines(data.vodPlayUrl);
    const episodes = lines.map((ln, i) => ({id: nid + "#" + i, name: ln[0]}));
    return {
        id: nid,
        title: title,
        cover: coverUrl(data.vodPic),
        desc: synopsis,
        duration: duration,
        tags: tag ? [tag] : [],
        lines: [{name: "在线播放", episodes: episodes}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    const parts = raw.split("#");
    const vodId = parts[0];
    const lineIdx = parts.length > 1 ? intValue(parts[1], 0) : 0;
    if (!vodId || !isFinite(parseInt(vodId, 10))) throw new Error("invalid play id");
    const headers = {"User-Agent": UA, "Referer": BASE + "/"};
    let sess = await session();
    let data = await fetchWatch(vodId, sess.token);
    let cardSecs = parseDuration(data.vodDuration);
    let lines = watchLines(data.vodPlayUrl);
    let url = lineIdx < lines.length ? absPlayUrl(lines[lineIdx][1]) : "";
    if (!url) throw new Error("no play url");
    if (await playlistIsPreview(url, cardSecs)) {
        sess = await ensureFull(vodId);
        data = await fetchWatch(vodId, sess.token);
        lines = watchLines(data.vodPlayUrl);
        url = lineIdx < lines.length ? absPlayUrl(lines[lineIdx][1]) : "";
        if (!url) throw new Error("no play url after unlock");
        cardSecs = parseDuration(data.vodDuration);
        if (await playlistIsPreview(url, cardSecs)) {
            throw new Error("still preview after unlock");
        }
    }
    const finalUrl = await resolveMaster(url);
    return {
        streams: [{
            url: finalUrl,
            format: "hls",
            headers: headers,
            name: "欢爱",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
