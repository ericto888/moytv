// 黄果短剧 — idj1 插件（huangguoai.com，SSR HTML 列表 + JSON 详情 + POST 取流）
// 站点：https://huangguoai.com；免费、无需登录、无付费墙。
// 分类取自站主导航（2026-11-24 实取）：最新（/newest/）/ 短剧（/ai-duanju/）/
// 漫剧（/ai-manju/）/ 黄果原创（/original/）。
// 注意：分类接口旧清单里的 AI魔改（/ai-mogai/）、AI换脸（/ai-huanlian/）已下线，
// 2026-11-24 实测均回 410「内容已下线」，不再列入分类。
// 播放：POST /api/videos/{id}/playback（第 1 集）或
// /api/videos/{id}/episodes/{ep}/playback（第 2 集起），回签名 m3u8
//（AES-128 加密分片，密钥在清单内）；详情走 GET /api/videos/{id}。

const SITE = "https://huangguoai.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

// [id, 显示名, 路径]；分页均为 {base}{N}/
const CATEGORIES = [
    ["latest", "最新", "/newest/"],
    ["duanju", "短剧", "/ai-duanju/"],
    ["manju", "漫剧", "/ai-manju/"],
    ["original", "黄果原创", "/original/"],
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

async function fetchJson(url, method, body) {
    const text = await fetchText(url, method, body);
    return JSON.parse(text);
}

// 剧卡：<div class="hg-drama-card" data-track-item-id="2833" ...>
// <a class="hg-drama-card__cover-link" href="/video/2833/">
// <img ... data-src="https://pic.qnlycc.cn/...jpeg?auth_key=..." alt="女友帮我操闺蜜">
// <span class="hg-drama-card__score">9.5分</span>
// <span class="hg-drama-card__episode">更新至15集</span>
// <span class="hg-drama-card__views">...4019.4w</span>
// <div class="hg-drama-card__title"><a href="/video/2833/">女友帮我操闺蜜</a></div>
function parseCards(html) {
    const items = [];
    const seen = {};
    const chunks = html.split(/<div class="hg-drama-card"/i).slice(1);
    for (const chunk of chunks) {
        const href = firstMatch(chunk, /<a[^>]+href="(\/video\/\d+\/)"/i);
        if (!href) continue;
        const num = href.replace(/\D/g, "");
        if (!num || seen[num]) continue;
        seen[num] = true;
        const title = cleanText(firstMatch(chunk, /<img[^>]+alt="([^"]+)"/i))
            || cleanText(firstMatch(chunk, /hg-drama-card__title"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i))
            || num;
        const cover = firstMatch(chunk, /data-src="(https:[^"]+)"/i)
            || firstMatch(chunk, /<img[^>]+src="(https:\/\/pic\.qnlycc\.cn[^"]+)"/i);
        const score = cleanText(firstMatch(chunk, /hg-drama-card__score">([^<]+)</i));
        const episode = cleanText(firstMatch(chunk, /hg-drama-card__episode">([^<]+)</i));
        const views = cleanText(firstMatch(chunk, /hg-drama-card__views">[\s\S]{0,200}?([\d.]+[wk万]+)</i));
        const tags = [];
        const tagRegex = /<a class="hg-tag"[^>]*>([^<]+)<\/a>/gi;
        let tm;
        while ((tm = tagRegex.exec(chunk)) !== null) {
            const t = cleanText(tm[1]);
            if (t && tags.indexOf(t) < 0) tags.push(t);
        }
        const remarks = [score, episode, views ? views + "播放" : ""].filter(Boolean).join(" · ");
        items.push({
            id: num,
            title: title,
            cover: cover,
            remarks: remarks,
            duration: episode,
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
    const base = catBase(tid);
    if (!base) return "";
    return pg === 1 ? SITE + base : SITE + base + pg + "/";
}

function allCategories() {
    const list = [];
    for (const c of CATEGORIES) {
        list.push({id: c[0], name: c[1]});
    }
    return list;
}

// ---------- idj1 契约 ----------

async function home() {
    let items = [];
    try {
        const html = await fetchText(SITE + "/");
        items = parseCards(html);
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
        items = parseCards(html);
        const next = listUrl(tid, page + 1);
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
        ? SITE + "/search/video/" + query + "/"
        : SITE + "/search/video/" + query + "/" + page + "/";
    let items = [];
    let hasMore = false;
    try {
        const html = await fetchText(url);
        items = parseCards(html);
        const next = SITE + "/search/video/" + query + "/" + (page + 1) + "/";
        hasMore = items.length > 0 && html.indexOf(next.replace(SITE, "")) >= 0;
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: hasMore};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    const num = rawId.replace(/\D/g, "");
    if (!num) throw new Error("无效的影片 ID");
    let data = {};
    try {
        const json = await fetchJson(SITE + "/api/videos/" + num);
        data = json.data || {};
    } catch (error) {
        data = {};
    }
    const title = cleanText(data.title) || rawId;
    const cover = str(data.cover || "");
    const description = cleanText(data.description || "");
    const tags = unique((data.tags || []).map(function (t) { return cleanText(t); }).filter(Boolean));
    const episodes = Array.isArray(data.episodes) ? data.episodes : [];
    const eps = episodes.length ? episodes : [{ep_num: 1, title: "第1集"}];
    const score = data.score ? String(data.score) + "分" : "";
    const desc = [description, score ? "评分：" + score : "", tags.length ? "标签：" + tags.join("、") : ""]
        .filter(Boolean).join("\n");
    return {
        id: rawId,
        title: title,
        cover: cover,
        desc: desc,
        duration: "",
        tags: tags,
        lines: [{
            name: "黄果短剧",
            episodes: eps.map(function (e) {
                const n = parseInt(e.ep_num, 10) || 1;
                return {id: num + "/" + n, name: cleanText(e.title) || ("第" + n + "集")};
            }),
        }],
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    const parts = raw.split("/");
    const num = (parts[0] || "").replace(/\D/g, "");
    const ep = parseInt(parts[1], 10) || 1;
    if (!num) throw new Error("无效的播放地址");
    const url = ep > 1
        ? SITE + "/api/videos/" + num + "/episodes/" + ep + "/playback"
        : SITE + "/api/videos/" + num + "/playback";
    const json = await fetchJson(url, "POST", "{}");
    const data = json.data || {};
    const streams = data.streams || {};
    const streamUrl = str(streams.main || streams.hevc || "");
    if (!streamUrl) throw new Error("未找到可用播放地址");
    return {
        streams: [{
            url: streamUrl,
            format: "hls",
            headers: {
                "User-Agent": UA,
                "Referer": SITE + "/video/" + num + "/",
            },
            name: "黄果短剧",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
