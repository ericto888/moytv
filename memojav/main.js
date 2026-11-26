// MemoJav — idj1 插件（由内置 py 蜘蛛 memojav 改写）
// 站点：https://memojav.org，无登录、无盾（本机实测直通）。
// 分类与原 py 完全一致：video/best 两条视频列表 + actress/studio/series/categories/label/director 六条索引。
// 列表卡片：<a href="/video/<code>" class="video-item"> 切块取 video-poster 封面 / video-title 标题 / video-metadata 备注，
// 标题拼成 "<code> <title>"（与原 py 一致）。
// 索引：actress/studio 取卡片链接（名字取块内最后一个 span title），其余索引取标签链接；索引条目 id 为 "<kind>:<slug>"，
// 在 category 里下钻成该索引页的视频列表。
// 详情：/video/<code> 页 h1#title / og:image / description（Pornstar/Studio 从 meta description 解）/
// details-block（Release Date→年份、Resolution→备注）/ 表格行 Director / categories 标签 / preview-img 剧照。
// 搜索：与原 py 一致，按 key、key 大写、key 去空格三个候选逐个当番号打开详情页，命中即回单条。
// 播放：/hls/get_video_info.php?id=<code>&sig=..&sts=..（sig 为毫秒时间戳 base64 尾段，sts 按原 py 公式算），
// 返回 JSON 的 url（URL 编码）即 m3u8/mp4 直链；master 清单在 play() 内预解析到子清单。

const BASE = "https://memojav.org";
const KEY = "memojav";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT = 60000;
const ATTEMPTS = 3;

const CATS = [
  ["video", "New Videos"],
  ["best", "Best Videos"],
  ["actress", "Actress"],
  ["studio", "Studio"],
  ["series", "Series"],
  ["categories", "Categories"],
  ["label", "Label"],
  ["director", "Director"],
];
const INDEX_KIND = {
  actress: "actress",
  studio: "studio",
  series: "series",
  category: "categories",
  label: "label",
  director: "director",
};

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function unescapeHtml(s) {
  return str(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
function cleanText(s) {
  return unescapeHtml(str(s).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

async function httpGet(url, referer) {
  let lastErr = null;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const resp = await host.http.get(url, {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/json,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": referer || (BASE + "/"),
        },
        timeout: TIMEOUT,
      });
      if (resp.status === 200 || resp.status === 206) return resp.body || "";
      if (resp.status === 404) return "";
      lastErr = new Error("HTTP " + resp.status);
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return "";
}

function listUrl(path, pg) {
  const p = "/" + str(path).replace(/^\/+|\/+$/g, "");
  if (pg <= 1) return BASE + p + "/";
  return BASE + p + "/page-" + pg;
}

function pagecount(html) {
  const re = /href="page-(\d+)"/g;
  let m, max = 0;
  while ((m = re.exec(str(html))) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max || 1;
}

function parseCards(html) {
  const out = [];
  const seen = {};
  const re = /<a href="\/video\/([^"]+)" class="video-item">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(str(html))) !== null) {
    let code = m[1].trim();
    try { code = decodeURIComponent(code); } catch (e) {}
    const block = m[2];
    if (!code || seen[code]) continue;
    const tm = /<div class="video-title[^"]*">([\s\S]*?)<\/div>/.exec(block);
    const title = tm ? cleanText(tm[1]) : "";
    if (!title) continue;
    seen[code] = true;
    const im = /<img[^>]*class="video-poster"[^>]*src="([^"]+)"/.exec(block);
    const pic = im ? im[1].trim() : "";
    const mm = /<div class="video-metadata">([\s\S]*?)<\/div>/.exec(block);
    const remarks = mm ? cleanText(mm[1]) : "";
    out.push({ id: code, title: code + " " + title, cover: pic, remarks: remarks, tags: [] });
  }
  return out;
}

function parseIndexCards(html, kind) {
  const out = [];
  const seen = {};
  const text = str(html);
  if (kind === "actress" || kind === "studio") {
    const re = /<a href="\/(actress|studio)\/([^"]+)">([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1] !== kind) continue;
      let slug = m[2].trim();
      try { slug = decodeURIComponent(slug); } catch (e) {}
      const block = m[3];
      if (!slug || seen[slug]) continue;
      const names = [];
      const nre = /<span[^>]*title="([^"]+)"/g;
      let nm;
      while ((nm = nre.exec(block)) !== null) names.push(nm[1]);
      const name = names.length ? cleanText(names[names.length - 1]) : slug;
      const im = /<img[^>]*src="([^"]+)"/.exec(block);
      const pic = im ? im[1].trim() : "";
      seen[slug] = true;
      out.push({ id: kind + ":" + slug, title: name, cover: pic, remarks: "", tags: [] });
    }
    return out;
  }
  const segment = INDEX_KIND[kind] || kind;
  const re = /<a[^>]*href="\/(categories|series|label|director)\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== segment) continue;
    let slug = m[2].trim();
    try { slug = decodeURIComponent(slug); } catch (e) {}
    const name = cleanText(m[3]);
    if (!slug || seen[slug] || !name) continue;
    seen[slug] = true;
    out.push({ id: kind + ":" + slug, title: name, cover: "", remarks: "", tags: [] });
  }
  return out;
}

function parseDetail(html, code) {
  const text = str(html);
  if (!text || text.indexOf('id="title"') < 0) return null;
  let title = "";
  let hm = /<h1[^>]*id="title"[^>]*>([\s\S]*?)<\/h1>/.exec(text);
  if (hm) title = cleanText(hm[1]);
  if (!title) {
    hm = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(text);
    if (hm) title = cleanText(hm[1]);
  }
  if (!title) {
    const tm = /<title[^>]*>([\s\S]*?)<\/title>/.exec(text);
    if (tm) title = cleanText(tm[1]).replace(" - MemoJav", "").trim();
  }
  if (!title) return null;
  const om = /<meta[^>]*property="og:image"[^>]*content="([^"]*)"/.exec(text);
  const cover = om ? om[1].trim() : "";
  const dm = /<p[^>]*id="title-description"[^>]*>([\s\S]*?)<\/p>/.exec(text);
  const synopsis = dm ? cleanText(dm[1]) : "";
  let actor = "", studio = "";
  const md = /<meta[^>]*name="description"[^>]*content="([^"]*)"/.exec(text);
  if (md) {
    const meta = cleanText(md[1]);
    const am = /Pornstar:\s*(.+?)\.\s*Studio:/.exec(meta);
    if (am) actor = am[1].trim();
    const sm = /Studio:\s*(.+?)\s*$/.exec(meta);
    if (sm) studio = sm[1].trim();
  }
  const blocks = {};
  const bre = /<div class="details-block"><h2[^>]*>([^<]+)<\/h2><p[^>]*>([\s\S]*?)<\/p><\/div>/g;
  let bm;
  while ((bm = bre.exec(text)) !== null) blocks[cleanText(bm[1])] = cleanText(bm[2]);
  const rows = {};
  const rre = /<tr><th[^>]*>([^<]+)<\/th><td[^>]*>([\s\S]*?)<\/td><\/tr>/g;
  let rm;
  while ((rm = rre.exec(text)) !== null) rows[cleanText(rm[1]).replace(/:$/, "")] = cleanText(rm[2]);
  let year = "";
  const ym = /(\d{4})/.exec(blocks["Release Date"] || "");
  if (ym) year = ym[1];
  let director = rows["Director"] || "";
  if (director === "----") director = "";
  const remarks = blocks["Resolution"] || "";
  const tags = [];
  const tre = /<a[^>]*href="\/(categories|series|label|director)\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let tm2;
  while ((tm2 = tre.exec(text)) !== null) {
    if (tm2[1] === "categories") {
      const name = cleanText(tm2[3]);
      if (name && tags.indexOf(name) < 0) tags.push(name);
    }
  }
  const stills = [];
  const sm2 = /<img[^>]*id="preview-img"[^>]*src="([^"]+)"/.exec(text);
  if (sm2) stills.push(sm2[1].trim());
  return {
    code: code, title: title, cover: cover, synopsis: synopsis, actor: actor,
    studio: studio, director: director, year: year, remarks: remarks,
    tags: tags, stills: stills,
  };
}

function videoSig() {
  const stamp = String(Date.now());
  const full = host.codec.base64Encode(stamp);
  const sig = full.slice(full.length - 12, full.length - 12 + 10);
  let sts = 1;
  for (let i = 0; i < 10; i++) sts += sig.charCodeAt(i) * i * 1743;
  return "&sig=" + sig + "&sts=" + sts;
}

async function videoInfo(code) {
  const url = BASE + "/hls/get_video_info.php?id=" + encodeURIComponent(code) + videoSig();
  const body = await httpGet(url, BASE + "/embed/" + encodeURIComponent(code));
  if (!body) return {};
  const text = body.split("for (;;);").pop().trim();
  try { return JSON.parse(text); } catch (e) { return {}; }
}

async function home() {
  const categories = CATS.map(c => ({ id: c[0], name: c[1] }));
  let items = [];
  try { items = parseCards(await httpGet(listUrl("video", 1))); } catch (e) { items = []; }
  return { categories: categories, items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const pg = Math.max(1, intValue(arg && arg.page, 1));
  const tid = str(arg && arg.id).trim();
  if (tid === "video" || tid === "best") {
    const html = await httpGet(listUrl(tid, pg));
    const items = parseCards(html);
    return { items: items, hasMore: pg < pagecount(html) };
  }
  if (tid === "actress" || tid === "studio" || tid === "series" ||
      tid === "categories" || tid === "label" || tid === "director") {
    if (tid !== "actress" && pg > 1) return { items: [], hasMore: false };
    const html = await httpGet(listUrl(tid, pg));
    const kind = tid === "categories" ? "category" : tid;
    const items = parseIndexCards(html, kind);
    const pc = tid === "actress" ? pagecount(html) : 1;
    return { items: items, hasMore: pg < pc };
  }
  const ci = tid.indexOf(":");
  if (ci > 0) {
    const kind = tid.slice(0, ci);
    const slug = tid.slice(ci + 1);
    const segment = INDEX_KIND[kind];
    if (segment && slug) {
      const html = await httpGet(listUrl(segment + "/" + slug, pg));
      const items = parseCards(html);
      return { items: items, hasMore: pg < pagecount(html) };
    }
  }
  return { items: [], hasMore: false };
}

async function search(arg) {
  const pg = Math.max(1, intValue(arg && arg.page, 1));
  const key = str(arg && arg.keyword).trim();
  if (!key || pg > 1) return { items: [], hasMore: false };
  const tried = [];
  const cands = [key, key.toUpperCase(), key.replace(/ /g, "")];
  for (const cand of cands) {
    if (!cand || tried.indexOf(cand) >= 0) continue;
    tried.push(cand);
    let item = null;
    try {
      const html = await httpGet(BASE + "/video/" + encodeURIComponent(cand));
      item = parseDetail(html, cand);
    } catch (e) { item = null; }
    if (item) {
      return {
        items: [{ id: cand, title: item.title, cover: item.cover, remarks: item.remarks, tags: [] }],
        hasMore: false,
      };
    }
  }
  return { items: [], hasMore: false };
}

async function detail(arg) {
  let code = str(arg && arg.id).trim();
  if (!code) throw new Error("无效的影片 ID");
  if (code.indexOf(":") > 0 && INDEX_KIND[code.slice(0, code.indexOf(":"))]) {
    // 索引文件夹条目，不是视频
    return { id: code, title: code.slice(code.indexOf(":") + 1), cover: "", desc: "", tags: [], lines: [] };
  }
  if (code.indexOf("http") === 0) code = code.replace(/\/+$/, "").split("/").pop();
  try { code = decodeURIComponent(code); } catch (e) {}
  code = code.trim();
  if (!code) return { id: str(arg && arg.id), title: "", cover: "", desc: "", tags: [], lines: [] };
  const html = await httpGet(BASE + "/video/" + encodeURIComponent(code));
  const item = parseDetail(html, code);
  if (!item) return { id: code, title: code, cover: "", desc: "", tags: [], lines: [] };
  const parts = [];
  if (item.synopsis) parts.push(item.synopsis);
  if (item.actor) parts.push("演员：" + item.actor);
  if (item.studio) parts.push("片商：" + item.studio);
  if (item.director) parts.push("导演：" + item.director);
  if (item.year) parts.push("年份：" + item.year);
  if (item.remarks) parts.push("分辨率：" + item.remarks);
  if (item.tags.length) parts.push("标签：" + item.tags.join("、"));
  if (item.stills.length) parts.push("剧照：" + item.stills.join(" "));
  return {
    id: code,
    title: item.title,
    cover: item.cover,
    desc: parts.join("\n"),
    tags: item.tags,
    lines: [{ name: "MemoJav", episodes: [{ id: KEY + ":" + code, name: "Play" }] }],
  };
}

async function play(arg) {
  let raw = str((arg && arg.episodeId) || (arg && arg.id) || "");
  if (raw.indexOf("$") >= 0) raw = raw.split("$").pop();
  raw = raw.trim();
  const prefix = KEY + ":";
  if (raw.indexOf(prefix) === 0) raw = raw.slice(prefix.length);
  let code = raw;
  try { code = decodeURIComponent(code); } catch (e) {}
  code = code.trim();
  if (!code) throw new Error("无效的播放 ID");
  const embed = BASE + "/embed/" + encodeURIComponent(code);
  const info = await videoInfo(code);
  let stream = "";
  if (info && info.success && (info.type === "hls" || info.type === "mp4")) {
    stream = str(info.url || "").trim();
    try { stream = decodeURIComponent(stream); } catch (e) {}
  }
  if (!stream) throw new Error("未取到播放地址（get_video_info 未返回可用流）");
  const isHls = /\.m3u8($|\?)/i.test(stream) || (info && info.type === "hls");
  let url = stream;
  if (isHls) {
    // master 清单先在插件内解析到子清单，避免播放端多跳超时
    try {
      const resp = await host.http.get(url, {
        headers: { "User-Agent": UA, "Referer": embed },
        timeout: TIMEOUT,
      });
      if (resp.status === 200 && resp.body && resp.body.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const lines = resp.body.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
        if (lines.length) url = host.url.resolve(url, lines[0]);
      }
    } catch (e) { /* 主清单也可直接播，解析失败就用原地址 */ }
  }
  return {
    streams: [{
      url: url,
      format: isHls ? "hls" : "mp4",
      headers: { "User-Agent": UA, "Referer": embed },
      name: "MemoJav",
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default {home, category, search, detail, play};
