// 中国X站精选 — idj1 插件（由内置 py 蜘蛛 chinaxjx 改写）
// 站点：https://chinaxselecla08.xyz/c2，MacCMS 风格 HTML 站，无登录、无加密接口。
// 分类从首页导航动态解析（与原 py 一致），解析不到时用原 py 的 4 个兜底分类。
// 播放：详情页即播放页，play() 现取页面里的 player_aaaa url（m3u8 直链）。

const BASE = "https://chinaxselecla08.xyz/c2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const FALLBACK_CATS = [
  ["domestic-media", "国产传媒"],
  ["japanese-av", "日本AV"],
  ["uncensored-video", "无码视频"],
  ["chinese-subtitles", "中文字幕"],
];

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function unescapeHtml(s) {
  return str(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\\//g, "/");
}
function stripTags(s) {
  return unescapeHtml(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function cleanTitle(t) {
  let s = str(t).trim();
  const sufs = [" 视频缩图", " 高清在线观看", " 高清在线播放"];
  for (const suf of sufs) {
    if (s.endsWith(suf)) s = s.slice(0, s.length - suf.length);
  }
  return s.trim();
}
function fixUrl(raw) {
  const u = str(raw).trim();
  if (!u) return "";
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return BASE + u;
  return u;
}

async function httpGet(url) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
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
      if (resp.status === 200 && resp.body && resp.body.indexOf("Checking your browser") < 0) return resp.body;
      lastErr = new Error("HTTP " + resp.status);
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return "";
}

function parseCards(html) {
  const out = [];
  if (!html) return out;
  const blocks = str(html).split('<div class="thumbnail group">');
  const seen = {};
  for (let i = 1; i < blocks.length; i++) {
    const blk = blocks[i];
    const m = blk.match(/href="\/c2\/vodplay\/([^"]+)"/);
    if (!m) continue;
    const slug = m[1].trim();
    if (!slug || seen[slug]) continue;
    let titleRaw = "", coverRaw = "";
    let im = blk.match(/<img alt="([^"]+?)"[^>]* src="([^"]+)"/);
    if (im) { titleRaw = im[1]; coverRaw = im[2]; }
    else {
      const im2 = blk.match(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]+?)"/);
      if (!im2) continue;
      coverRaw = im2[1]; titleRaw = im2[2];
    }
    const title = cleanTitle(unescapeHtml(titleRaw.trim()));
    if (!title) continue;
    seen[slug] = true;
    out.push({ id: slug, title: title, cover: fixUrl(coverRaw).split("?")[0], remarks: "", duration: "", tags: [] });
  }
  return out;
}

function parseCategories(html) {
  const seen = {};
  const order = [];
  const re = /href="\/c2\/vodtype\/([a-z-]+)\/"[^>]*>([^<]+)</g;
  let m;
  while ((m = re.exec(str(html))) !== null) {
    const cid = m[1].trim(), name = m[2].trim();
    if (!name || seen[cid]) continue;
    seen[cid] = name; order.push(cid);
  }
  if (!order.length) return FALLBACK_CATS.map(c => ({ id: c[0], name: c[1] }));
  return order.map(cid => ({ id: cid, name: seen[cid] }));
}

let catsCache = null;
async function getCategories() {
  if (catsCache) return catsCache;
  try {
    const html = await httpGet(BASE + "/");
    catsCache = parseCategories(html);
  } catch (e) {
    catsCache = FALLBACK_CATS.map(c => ({ id: c[0], name: c[1] }));
  }
  return catsCache;
}

function parsePlayerUrl(html) {
  if (!html) return "";
  let m = str(html).match(/player_aaaa=[\s\S]*?"url":"([^"]+)"/);
  if (m) return unescapeHtml(m[1]);
  m = str(html).match(/"url":"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
  if (m) return unescapeHtml(m[1]);
  return "";
}

function labelText(html, label) {
  if (!html) return "";
  const re = new RegExp("<span>\\s*" + label + ":</span>\\s*<a[^>]*>([^<]+)</a>");
  const m = str(html).match(re);
  return m ? unescapeHtml(m[1].trim()) : "";
}

function normSlug(raw) {
  let s = str(raw).trim();
  if (s.indexOf("$") >= 0) s = s.split("$").slice(1).join("$") || s;
  if (s.indexOf("chinaxjx:") === 0) s = s.slice("chinaxjx:".length);
  if (s.indexOf("c2/vodplay/") === 0) s = s.slice("c2/vodplay/".length);
  if (s.indexOf("vodplay/") === 0) s = s.slice("vodplay/".length);
  return s.replace(/^\/+|\/+$/g, "").trim();
}

async function home() {
  const categories = await getCategories();
  let items = [];
  try { items = parseCards(await httpGet(BASE + "/")); } catch (e) { items = []; }
  return { categories: categories, items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const page = Math.max(1, intValue(arg && arg.page, 1));
  let tid = str(arg && arg.id).trim();
  if (!tid || tid === "all") tid = "domestic-media";
  const path = page <= 1 ? "/vodtype/" + tid + "/" : "/vodtype/" + tid + "-" + page + "/";
  let items = [];
  try { items = parseCards(await httpGet(BASE + path)); } catch (e) { items = []; }
  return { items: items, hasMore: items.length > 0 };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) return { items: [], hasMore: false };
  let items = [];
  try { items = parseCards(await httpGet(BASE + "/vodsearch/?wd=" + encodeURIComponent(keyword))); } catch (e) { items = []; }
  return { items: items, hasMore: false };
}

async function detail(arg) {
  const slug = normSlug(arg && arg.id);
  if (!slug) throw new Error("无效的影片 ID");
  const html = await httpGet(BASE + "/vodplay/" + slug);
  let title = "";
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (h1) title = cleanTitle(stripTags(h1[1]));
  if (!title) {
    const nm = html.match(/"name":\s*"([^"]+)"/);
    if (nm) title = unescapeHtml(nm[1].trim());
  }
  if (!title) return { id: slug, title: slug, cover: "", desc: "", tags: [], lines: [] };
  let cover = "";
  const th = html.match(/"thumbnailUrl":\s*"([^"]+)"/);
  if (th) cover = fixUrl(th[1]);
  let desc = "";
  const dm = html.match(/<meta name="description"[^>]*content="([^"]+)"/);
  if (dm) desc = unescapeHtml(dm[1].trim());
  let genre = "";
  const gm = html.match(/"genre":\s*"([^"]+)"/);
  if (gm) genre = unescapeHtml(gm[1].trim());
  let year = "";
  const tm = html.match(/<time[^>]*datetime="(\d{4})-/);
  if (tm) year = tm[1];
  if (!year) year = labelText(html, "年代");
  const area = labelText(html, "地区");
  let actor = "";
  const am = html.match(/player_aaaa=[\s\S]*?"vod_actor":"([^"]*)"/);
  if (am) actor = unescapeHtml(am[1].trim());
  const tags = [];
  if (genre) tags.push(genre);
  if (area) tags.push(area);
  if (year) tags.push(year);
  if (actor) tags.push(actor);
  return {
    id: slug,
    title: title,
    cover: cover,
    desc: desc,
    tags: tags,
    lines: [{ name: "在线播放", episodes: [{ id: "chinaxjx:" + slug, name: "播放" }] }],
  };
}

async function play(arg) {
  const raw0 = str((arg && arg.episodeId) || (arg && arg.id));
  let raw = raw0;
  if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
  if (/^https?:\/\//i.test(raw) && raw.indexOf(".m3u8") >= 0) {
    return { streams: [{ url: raw, format: "hls", headers: { "User-Agent": UA, "Referer": BASE + "/" }, name: "中国X站精选" }], expiresAt: Date.now() + 3600 * 1000 };
  }
  const slug = normSlug(raw);
  if (!slug) throw new Error("无效的播放 ID");
  const html = await httpGet(BASE + "/vodplay/" + slug);
  let url = parsePlayerUrl(html);
  if (!url) throw new Error("未找到播放地址");
  if (!/^https:\/\//i.test(url)) throw new Error("播放地址不是 https 直链");
  const isHls = /\.m3u8($|\?)/i.test(url);
  if (isHls) {
    try {
      const resp = await host.http.get(url, { headers: { "User-Agent": UA, "Referer": BASE + "/" }, timeout: TIMEOUT });
      if (resp.status === 200 && resp.body && resp.body.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const lines = resp.body.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
        if (lines.length) url = host.url.resolve(url, lines[0]);
      }
    } catch (e) { /* 主清单也可直接播，解析失败就用原地址 */ }
  }
  return {
    streams: [{ url: url, format: isHls ? "hls" : "mp4", headers: { "User-Agent": UA, "Referer": BASE + "/" }, name: "中国X站精选" }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default {home, category, search, detail, play};
