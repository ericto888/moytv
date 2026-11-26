// 狠狠撸 — idj1 插件（由内置 py 蜘蛛 henhenlu 改写）
// 站点：https://hhlu2127.lol，MacCMS 风格 HTML 站，无登录、无加密接口。
// 分类从首页 <nav class="mynav"> 动态解析（与原 py 一致），解析不到时用原 py 的 3 个兜底分类。
// 播放：详情页即播放页，play() 用分集 id 里自带的 m3u8 直链（原 py 的 henhenlu:<m3u8> 形态）。

const BASE = "https://hhlu2127.lol";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const FALLBACK_CATS = [
  ["1", "视频一区"],
  ["2", "视频二区"],
  ["3", "视频三区"],
];

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function unescapeHtml(s) {
  return str(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\\//g, "/").trim();
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
          "Referer": BASE,
        },
        timeout: TIMEOUT,
      });
      if (resp.status === 200 && resp.body && resp.body.trim()) return resp.body;
      lastErr = new Error("HTTP " + resp.status);
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return "";
}

function parseCards(html) {
  const out = [];
  if (!html) return out;
  const seen = {};
  const re = /<a class="uzimg" href="\/index\.php\/vod\/play\/id\/(\d+)\/sid\/1\/nid\/1\.html" title="([^"]+)">[\s\S]*?<img[^>]*data-original="([^"]+)"/g;
  let m;
  while ((m = re.exec(str(html))) !== null) {
    const vid = m[1].trim();
    if (!vid || seen[vid]) continue;
    const title = unescapeHtml(m[2]);
    if (!title) continue;
    seen[vid] = true;
    out.push({ id: vid, title: title, cover: fixUrl(m[3]), remarks: "", duration: "", tags: [] });
  }
  return out;
}

function parseCategories(html) {
  let scope = str(html);
  const nm = scope.match(/<nav class="mynav">([\s\S]*?)<\/nav>/);
  if (nm) scope = nm[1];
  const out = [];
  const seen = {};
  const re = /href="\/index\.php\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)</g;
  let m;
  while ((m = re.exec(scope)) !== null) {
    const cid = m[1], name = m[2].trim();
    if (!name || name === "首页" || seen[cid]) continue;
    seen[cid] = true;
    out.push({ id: cid, name: name });
  }
  return out;
}

let catsCache = null;
async function getCategories() {
  if (catsCache) return catsCache;
  try {
    const cats = parseCategories(await httpGet(BASE));
    catsCache = cats.length ? cats : FALLBACK_CATS.map(c => ({ id: c[0], name: c[1] }));
  } catch (e) {
    catsCache = FALLBACK_CATS.map(c => ({ id: c[0], name: c[1] }));
  }
  return catsCache;
}

async function catalog(tid, pg) {
  const url = pg <= 1
    ? BASE + "/index.php/vod/type/id/" + tid + ".html"
    : BASE + "/index.php/vod/type/id/" + tid + "/page/" + pg + ".html";
  return parseCards(await httpGet(url));
}

function normId(raw) {
  let s = str(raw).trim();
  if (s.indexOf("$") >= 0) s = s.split("$").slice(1).join("$") || s;
  s = s.replace(/^\/+/, "");
  if (s.indexOf("index.php/vod/play/id/") === 0) s = s.slice("index.php/vod/play/id/".length);
  return s.split("/")[0].trim();
}

async function home() {
  const categories = await getCategories();
  let items = [];
  if (categories.length) items = await catalog(categories[0].id, 1);
  return { categories: categories, items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const page = Math.max(1, intValue(arg && arg.page, 1));
  let tid = str(arg && arg.id).trim();
  if (!tid) tid = "1";
  const items = await catalog(tid, page);
  return { items: items, hasMore: items.length > 0 };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) return { items: [], hasMore: false };
  const items = parseCards(await httpGet(BASE + "/index.php/vod/search.html?wd=" + encodeURIComponent(keyword)));
  return { items: items, hasMore: false };
}

async function detail(arg) {
  const nid = normId(arg && arg.id);
  if (!nid) throw host.error("E_PARSE", "无效的影片 ID");
  const html = await httpGet(BASE + "/index.php/vod/play/id/" + nid + "/sid/1/nid/1.html");
  const pm = str(html).match(/var player_aaaa=(\{[\s\S]*?\})\s*<\/script>/);
  if (!pm) throw host.error("E_PARSE", "详情页未找到 player_aaaa");
  let player;
  try { player = JSON.parse(pm[1]); } catch (e) { throw host.error("E_PARSE", "player_aaaa 解析失败"); }
  const vodData = player.vod_data || {};
  const title = str(vodData.vod_name || "");
  const m3u8 = str(player.url || "");
  if (!title || !m3u8) throw host.error("E_PARSE", "详情页缺少标题或播放地址");
  const genre = str(vodData.vod_class || "");
  const cm = str(html).match(/data-original="([^"]+)"/);
  const cover = cm ? fixUrl(cm[1]) : "";
  const dm = str(html).match(/<meta name="description"[^>]*content="([^"]+)"/);
  const desc = dm ? unescapeHtml(dm[1]) : "";
  const tags = genre ? [genre] : [];
  return {
    id: nid,
    title: title,
    cover: cover,
    desc: desc,
    tags: tags,
    lines: [{ name: "在线播放", episodes: [{ id: "henhenlu:" + m3u8, name: "播放" }] }],
  };
}

async function play(arg) {
  let raw = str((arg && arg.episodeId) || (arg && arg.id));
  if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
  if (raw.indexOf("henhenlu:") === 0) raw = raw.slice("henhenlu:".length);
  const m3u8 = raw.trim();
  if (!/^https?:\/\//i.test(m3u8)) throw host.error("E_PARSE", "无效的播放 ID");
  if (!/^https:\/\//i.test(m3u8)) throw host.error("E_PARSE", "播放地址不是 https 直链");
  let url = m3u8;
  const isHls = /\.m3u8($|\?)/i.test(url);
  if (isHls) {
    try {
      const resp = await host.http.get(url, { headers: { "User-Agent": UA, "Referer": BASE }, timeout: TIMEOUT });
      if (resp.status === 200 && resp.body && resp.body.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const lines = resp.body.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
        if (lines.length) url = host.url.resolve(url, lines[0]);
      }
    } catch (e) { /* 主清单也可直接播，解析失败就用原地址 */ }
  }
  return {
    streams: [{ url: url, format: isHls ? "hls" : "mp4", headers: { "User-Agent": UA, "Referer": BASE }, name: "狠狠撸" }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default {home, category, search, detail, play};
