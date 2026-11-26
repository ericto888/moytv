const BASES = ["https://wap.snq2.cc", "https://wap.snq3.cc", "https://5g.snq3.cc"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
  ["386", "黄瓜资源"],
  ["358", "熟女资源"],
  ["244", "55资源"],
  ["119", "不卡资源"],
  ["286", "兔儿资源"],
  ["370", "森林资源"],
  ["329", "库库资源"],
];

let catsCache = null;

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function unescapeHtml(s) {
  return str(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\\\//g, "/");
}

function clean(t) {
  return unescapeHtml(str(t).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function fixUrl(raw, base) {
  const u = str(raw).trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return (base || BASES[0]) + u;
  return u;
}

async function fetchOnce(url) {
  const resp = await host.http.get(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
    timeout: TIMEOUT,
  });
  if (resp.status === 200 && resp.body) return resp.body;
  if (resp.body) return resp.body;
  throw new Error("HTTP " + resp.status);
}

async function httpGet(path) {
  let lastErr = null;
  for (const base of BASES) {
    for (let i = 0; i < 2; i++) {
      try {
        return await fetchOnce(base + path);
      } catch (e) { lastErr = e; }
    }
  }
  if (lastErr) throw lastErr;
  return "";
}

function parseCards(html) {
  const out = [];
  const seen = {};
  const re = /<a class="qx" href="\/a\/index\.php\/vod\/detail\/id\/(\d+)\.html"[\s\S]*?<img[^>]+data-original="([^"]+)"[^>]*>[\s\S]*?<div class="listitem-info">\s*([\s\S]*?)\s*<\/div>/g;
  let m;
  while ((m = re.exec(str(html))) !== null) {
    const vid = m[1];
    if (seen[vid]) continue;
    seen[vid] = true;
    const title = clean(unescapeHtml(m[3]));
    if (!title) continue;
    out.push({ id: vid, title: title, cover: fixUrl(m[2]), remarks: "", tags: [] });
  }
  return out;
}

function liveCats(html) {
  const out = [];
  const seen = {};
  const re = /<a href="\/a\/index\.php\/vod\/type\/id\/(\d+)\.html" class="now"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(str(html))) !== null) {
    const cid = m[1], name = m[2].trim();
    if (!name || seen[cid]) continue;
    seen[cid] = true;
    out.push([cid, name]);
  }
  return out;
}

async function getCats() {
  if (catsCache) return catsCache;
  try {
    const html = await httpGet("/a/");
    const live = liveCats(html);
    catsCache = live.length ? live : CATS.slice();
  } catch (e) {
    catsCache = CATS.slice();
  }
  return catsCache;
}

function categories() {
  const src = catsCache || CATS;
  return src.map(c => ({ id: c[0], name: c[1] }));
}

async function categoryItems(tid, pg) {
  const path = pg <= 1
    ? "/a/index.php/vod/type/id/" + tid + ".html"
    : "/a/index.php/vod/type/id/" + tid + "/page/" + pg + ".html";
  const html = await httpGet(path);
  const items = parseCards(html);
  const nxt = "/a/index.php/vod/type/id/" + tid + "/page/" + (pg + 1) + ".html";
  return { items: items, hasMore: items.length > 0 && str(html).indexOf(nxt) >= 0 };
}

async function home() {
  const cats = await getCats();
  let items = [];
  try {
    const r = await categoryItems(cats[0][0], 1);
    items = r.items;
  } catch (e) { items = []; }
  return { categories: categories(), items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const page = Math.max(1, intValue(arg && arg.page, 1));
  const tid = str(arg && arg.id).trim();
  if (!tid) return { items: [], hasMore: false };
  try {
    return await categoryItems(tid, page);
  } catch (e) {
    return { items: [], hasMore: false };
  }
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) return { items: [], hasMore: false };
  let items = [];
  try {
    const html = await httpGet("/a/index.php/vod/search/wd/" + encodeURIComponent(keyword) + ".html");
    items = parseCards(html);
  } catch (e) { items = []; }
  return { items: items, hasMore: false };
}

async function detail(arg) {
  let vid = str(arg && arg.id);
  if (vid.indexOf(",") >= 0) vid = vid.split(",")[0];
  vid = vid.trim().replace(/^\//, "");
  if (!vid) return { id: vid, title: "", cover: "", desc: "", tags: [], lines: [] };
  const html = await httpGet("/a/index.php/vod/detail/id/" + vid + ".html");
  if (!html) return { id: vid, title: "", cover: "", desc: "", tags: [], lines: [] };
  let title = "";
  const hm = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (hm) title = clean(unescapeHtml(hm[1])).split("<")[0].trim();
  let cover = "";
  const cm = /<img src="(https?:\/\/[^"]+)"/.exec(html);
  if (cm) cover = fixUrl(cm[1]);
  let synopsis = "";
  const dm = /<meta name="description"[^>]*content="([^"]+)"/.exec(html);
  if (dm) synopsis = unescapeHtml(dm[1].trim());
  const episodes = [];
  const seen = {};
  const epat = /<a[^>]*href="(\/a\/index\.php\/vod\/play\/id\/\d+\/sid\/\d+\/nid\/\d+\.html)"[^>]*>([^<]*)<\/a>/g;
  let m;
  while ((m = epat.exec(html)) !== null) {
    const href = m[1];
    if (seen[href]) continue;
    seen[href] = true;
    let name = m[2].trim();
    if (!name || name === "立即播放") name = "第1集";
    episodes.push({ id: fixUrl(href), name: name });
  }
  if (!title || !episodes.length) return { id: vid, title: title, cover: cover, desc: synopsis, tags: [], lines: [] };
  return {
    id: vid,
    title: title,
    cover: cover,
    desc: synopsis,
    tags: [],
    remarks: "",
    lines: [{ name: "在线播放", episodes: episodes }],
  };
}

async function playerUrl(playPath) {
  const html = await httpGet(playPath);
  if (!html) return "";
  const m = /player_aaaa=[\s\S]*?"url":"([^"]+)"/.exec(html);
  return m ? unescapeHtml(m[1]) : "";
}

async function play(arg) {
  let raw = str((arg && arg.episodeId) || (arg && arg.id));
  if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
  const header = { "User-Agent": UA, "Referer": BASES[0] + "/" };
  let url = /^https?:\/\//i.test(raw) ? raw : fixUrl(raw);
  if (url.indexOf("/vod/play/") < 0) {
    if (/^https?:\/\//i.test(url) && /\.m3u8($|\?)/i.test(url)) {
      return { streams: [{ url: url, format: "hls", headers: header, name: "在线播放" }], expiresAt: Date.now() + 3600 * 1000 };
    }
    throw new Error("未找到播放地址");
  }
  const pos = url.indexOf("/a/index.php");
  const path = pos >= 0 ? url.slice(pos) : url;
  const m3u8 = await playerUrl(path);
  if (!m3u8) throw new Error("未找到播放地址");
  header["Referer"] = url;
  let finalUrl = m3u8;
  try {
    const resp = await host.http.get(finalUrl, { headers: header, timeout: TIMEOUT });
    if (resp.status === 200 && resp.body && resp.body.indexOf("#EXT-X-STREAM-INF") >= 0) {
      const lines = resp.body.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
      if (lines.length) finalUrl = host.url.resolve(finalUrl, lines[0]);
    }
  } catch (e) { /* keep master url */ }
  const isHls = /\.m3u8($|\?)/i.test(finalUrl);
  return {
    streams: [{ url: finalUrl, format: isHls ? "hls" : "mp4", headers: header, name: "在线播放" }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home, category, search, detail, play };
