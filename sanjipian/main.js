// 91三级片 — idj1 插件（91sanji.com，SSR HTML 列表 + POST 取流，无加密）
// 站点：https://91sanji.com；免费、无需登录、无付费墙。
// 分类取自站主导航（2026-11-24 实取）：首页最新 / 三级片电影 / 国产 / 香港 /
// 日本 / 韩国 / 欧美 / 东南亚 / AI成人短剧；AI漫剧是漫画，不进视频插件。
// 播放：POST /api/videos/{id}/playback（body {}）回签名 m3u8（AES-128 加密分片，
// 密钥在清单内）；注意 POST /play 只是打点 beacon，回空 data，不要用。
// 注意：/latest/ 不是视频列表，是“最新可用地址”发布页，不要用；最新走 /category/new/。

const SITE = "https://91sanji.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

// [id, 显示名, 路径前缀]；分页：regional/aidrama 为 {base}{N}/，latest/all 为 /category/page/{N}/
const CATEGORIES = [
    ["latest", "最新", "new"],
    ["all", "三级片电影", "all"],
    ["chinese", "国产三级片", "chinese-sex-movies"],
    ["hongkong", "香港三级片", "hong-kong-sex-movies"],
    ["japanese", "日本三级片", "japanese-sex-movies"],
    ["korean", "韩国三级片", "korean-sex-movies"],
    ["western", "欧美三级片", "western-sex-movies"],
    ["southeast", "东南亚三级片", "southeast-asian-sex-movies"],
    ["aidrama", "AI成人短剧", "ai-drama"],
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function cleanText(value) {
    return str(value)
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

function firstMatch(text, regex, index) {
    const match = regex.exec(text);
    return match ? str(match[index == null ? 1 : index]) : "";
}

function unique(list) {
    const seen = {};
    const result = [];
    for (const item of list) {
        const key = str(item);
        if (!key || seen[key]) continue;
        seen[key] = true;
        result.push(item);
    }
    return result;
}

async function fetchText(url, method, body) {
    const opts = {
        url: url,
        method: method || "GET",
        headers: {
            "User-Agent": UA,
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": SITE + "/",
        },
        timeout: TIMEOUT,
    };
    if (method === "POST") {
        opts.headers["Content-Type"] = "application/json";
        opts.body = body == null ? "{}" : body;
    }
    const resp = await host.http.request(opts);
    if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
    return resp.body == null ? "" : String(resp.body);
}

// 视频卡：<article class="video-card">
// <a class="video-card__cover" href="/video/39128/" aria-label="播放《啊，荒野》">
// <img ... data-enc-src="https://pic.qnlycc.cn/...jpeg?auth_key=...">
// <span class="duration">2:37:00</span>
// <a class="video-card__title" href="/video/39128/">啊，荒野</a>
// <a class="pill" href="/tag/ribensanji/">日本三级</a>
function parseVideos(html) {
    const items = [];
    const seen = {};
    const chunks = html.split(/<article class="video-card"/i).slice(1);
    for (const chunk of chunks) {
        const href = firstMatch(chunk, /<a[^>]+href="(\/video\/\d+\/)"/i);
        if (!href) continue;
        const id = href.replace(/^\/|\/$/g, "");
        if (!id || seen[id]) continue;
        seen[id] = true;
        const title = cleanText(firstMatch(chunk, /class="video-card__title"[^>]*>([^<]+)</i))
            || cleanText(firstMatch(chunk, /aria-label="播放《([^》]+)》"/i))
            || id;
        const cover = firstMatch(chunk, /data-enc-src="(https:[^"]+)"/i)
            || firstMatch(chunk, /<img[^>]+src="(https:\/\/pic\.qnlycc\.cn[^"]+)"/i);
        const duration = cleanText(firstMatch(chunk, /<span class="duration">([^<]+)<\/span>/i));
        const tags = [];
        const tagRegex = /<a class="pill"[^>]*>([^<]+)<\/a>/gi;
        let tm;
        while ((tm = tagRegex.exec(chunk)) !== null) {
            const t = cleanText(tm[1]);
            if (t && tags.indexOf(t) < 0) tags.push(t);
        }
        items.push({
            id: id,
            title: title,
            cover: cover,
            remarks: duration,
            duration: duration,
            tags: tags,
        });
    }
    return items;
}

function catBase(tid) {
    for (const c of CATEGORIES) {
        if (c[0] === tid) return c[2];
    }
    return "";
}

function listUrl(tid, page) {
    const pg = Math.max(1, parseInt(page, 10) || 1);
    if (tid === "latest") {
        return pg === 1 ? SITE + "/category/new/" : SITE + "/category/page/" + pg + "/";
    }
    if (tid === "all") {
        return pg === 1 ? SITE + "/category/" : SITE + "/category/page/" + pg + "/";
    }
    if (tid === "aidrama") {
        return pg === 1 ? SITE + "/ai/drama/" : SITE + "/ai/drama/" + pg + "/";
    }
    const base = catBase(tid);
    if (!base) return "";
    return pg === 1 ? SITE + "/category/" + base + "/" : SITE + "/category/" + base + "/" + pg + "/";
}

function nextUrl(tid, page) {
    return listUrl(tid, page + 1);
}

function allCategories() {
    const list = [];
    for (const c of CATEGORIES) {
        list.push({id: c[0], name: c[1]});
    }
    return list;
}

function numId(raw) {
    const m = /(\d+)/.exec(str(raw));
    return m ? m[1] : "";
}

// ---------- idj1 契约 ----------

async function home() {
    let items = [];
    try {
        const html = await fetchText(SITE + "/");
        items = parseVideos(html);
    } catch (error) {
        items = [];
    }
    return {categories: allCategories(), items: items, hasMore: false};
}

async function category(arg) {
    const page = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const tid = str(arg && arg.id);
    const url = listUrl(tid, page);
    if (!url) return {items: [], hasMore: false};
    let items = [];
    let hasMore = false;
    try {
        const html = await fetchText(url);
        items = parseVideos(html);
        const next = nextUrl(tid, page);
        hasMore = items.length > 0 && next !== "" && html.indexOf(next.replace(SITE, "")) >= 0;
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: hasMore};
}

async function search(arg) {
    const page = Math.max(1, parseInt(arg && arg.page, 10) || 1);
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    const query = encodeURIComponent(keyword);
    const url = page === 1
        ? SITE + "/search/" + query + "/"
        : SITE + "/search/" + query + "/" + page + "/";
    let items = [];
    let hasMore = false;
    try {
        const html = await fetchText(url);
        items = parseVideos(html);
        const next = SITE + "/search/" + query + "/" + (page + 1) + "/";
        hasMore = items.length > 0 && html.indexOf(next.replace(SITE, "")) >= 0;
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: hasMore};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    const num = numId(rawId);
    if (!num) throw new Error("无效的影片 ID");
    const url = SITE + "/video/" + num + "/";
    let html = "";
    try {
        html = await fetchText(url);
    } catch (error) {
        html = "";
    }
    const initRaw = firstMatch(html, /<script[^>]*id="videoInitialData"[^>]*>([\s\S]*?)<\/script>/i);
    let init = {};
    try { init = initRaw ? JSON.parse(initRaw) : {}; } catch (error) { init = {}; }
    let title = cleanText(firstMatch(html, /<title>([^<]+)<\/title>/i));
    title = title.replace(/-?[^-]*在线观看.*$/i, "").replace(/\s*-\s*91三级片\s*$/i, "").trim() || rawId;
    const description = cleanText(init.description || firstMatch(html, /<meta name="description" content="([^"]*)"/i));
    const cover = str(init.coverSrc || init.posterSrc || firstMatch(html, /<meta property="og:image" content="([^"]+)"/i));
    const tags = unique((init.tags || []).map(function (t) { return cleanText(t); }).filter(Boolean));
    const related = parseVideos(html).filter(function (v) { return numId(v.id) !== num; }).slice(0, 12);
    const lines = [{name: "91三级片", episodes: [{id: "video/" + num + "/", name: "正片"}]}];
    if (related.length) {
        lines.push({
            name: "相关推荐",
            episodes: related.map(function (v) { return {id: v.id, name: v.title}; }),
        });
    }
    const desc = [description, tags.length ? "标签：" + tags.join("、") : ""].filter(Boolean).join("\n");
    return {
        id: rawId,
        title: title,
        cover: cover,
        desc: desc,
        duration: "",
        tags: tags,
        lines: lines,
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    const num = numId(raw);
    if (!num) throw new Error("无效的播放地址");
    const body = await fetchText(SITE + "/api/videos/" + num + "/playback", "POST", "{}");
    let data = {};
    try { data = JSON.parse(body).data || {}; } catch (error) { data = {}; }
    const streams = data.streams || {};
    const url = str(streams.main || streams.hevc || "");
    if (!url) throw new Error("未找到可用播放地址");
    return {
        streams: [{
            url: url,
            format: "hls",
            headers: {
                "User-Agent": UA,
                "Referer": SITE + "/video/" + num + "/",
            },
            name: "91三级片",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
