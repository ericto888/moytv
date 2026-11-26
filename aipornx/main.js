// AiPorn (aipornx.cc) — idj1 plugin rewritten from built-in py spider aipornx.py
// Site: https://www.aipornx.cc ; HTML scraping, play via huangguo.php API.
// Play flow mirrors py: play page player_data url "id|ep" -> GET /huangguo.php?ac=play
// -> url is either /huangguo.php?ac=media... (proxy playlist) or
// /hgmedia.php?e=<base64> where base64 decodes to a real .m3u8 URL.

const HOST = "https://www.aipornx.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const RETRY = 2;

const CATEGORIES = [
  {id: "home", name: "首页"},
  {id: "latest", name: "最新更新"},
  {id: "/aidj/anthurium/", name: "AI成人短剧"},
  {id: "/aidj/camelia/", name: "AI成人漫剧"},
  {id: "/aidj/daisy/", name: "AI换脸"},
  {id: "/aidj/frangipani/", name: "AI魔改"},
  {id: "tags_index", name: "标签选剧"},
];
const TAGS_SNAPSHOT = ["现代", "都市", "奇幻", "大男主", "系统", "后宫"];

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function decodeEntities(s) {
  return str(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
}
function txtOf(s) {
  let t = str(s).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  return decodeEntities(t).replace(/\s+/g, " ").trim();
}
function fixPic(pic) {
  pic = str(pic);
  if (pic.indexOf("https://media.hgpicimg.cc//") === 0) {
    pic = pic.replace("https://media.hgpicimg.cc//", "https://media.hgpicimg.cc/");
  }
  return pic;
}

async function httpGet(url, extraHeaders) {
  let full = url;
  if (full.indexOf("http") !== 0) full = HOST + full;
  const headers = {"User-Agent": UA, "Referer": HOST + "/"};
  if (extraHeaders) for (const k of Object.keys(extraHeaders)) headers[k] = extraHeaders[k];
  let lastErr = null;
  for (let i = 0; i < RETRY; i++) {
    try {
      const resp = await host.http.get(full, {headers: headers, timeout: TIMEOUT});
      if (resp.status >= 400) throw new Error("HTTP " + resp.status);
      if (resp.body) return resp.body;
      lastErr = new Error("empty body");
    } catch (e) { lastErr = e; }
  }
  if (lastErr) host.log("httpGet failed", full, str(lastErr && lastErr.message));
  return "";
}

function parseCards(html) {
  const out = [];
  const seen = {};
  const re = /<article class="vod-card">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html || "")) !== null) {
    const blk = m[1];
    const lm = /<a class="vod-pic" href="(\/detail\/\d+\/)\s*"/.exec(blk);
    if (!lm) continue;
    const path = lm[1];
    if (seen[path]) continue;
    seen[path] = true;
    const im = /<img[^>]+src="([^"]+)"/.exec(blk);
    const pic = im ? fixPic(im[1]) : "";
    let nm = /<div class="vod-name"><a[^>]*>([^<]+)<\/a>/.exec(blk);
    if (!nm) nm = /<img[^>]+alt="([^"]+)"/.exec(blk);
    const rm = /class="vod-remarks">([^<]+)</.exec(blk);
    out.push({
      id: path,
      title: nm ? txtOf(nm[1]) : path,
      cover: pic,
      remarks: rm ? txtOf(rm[1]) : "",
      duration: "",
      tags: [],
    });
  }
  return out;
}

function pageCount(html, pg) {
  let max = intValue(pg, 1);
  let m;
  const re1 = /\/page\/(\d+)\//g;
  while ((m = re1.exec(html || "")) !== null) max = Math.max(max, parseInt(m[1], 10));
  const re2 = /-{10}(\d+)-/g;
  while ((m = re2.exec(html || "")) !== null) max = Math.max(max, parseInt(m[1], 10));
  return max;
}

async function listing(url, pg) {
  const html = await httpGet(url);
  const items = parseCards(html);
  return {items: items, hasMore: pageCount(html, pg) > pg && items.length > 0};
}

async function tagsIndexItems() {
  const html = await httpGet(HOST + "/home/");
  let tags = [];
  if (html) {
    const seen = {};
    const re = /href="\/search\/-+%E[^"]+"[^>]*>#([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const t = txtOf(m[1]);
      if (t && !seen[t]) { seen[t] = true; tags.push(t); }
    }
  }
  if (!tags.length) tags = TAGS_SNAPSHOT.slice();
  return tags.map((t) => ({id: "tag:" + t, title: t, cover: "", remarks: "", duration: "", tags: []}));
}

async function home() {
  const html = await httpGet(HOST + "/home/");
  const items = parseCards(html);
  return {categories: CATEGORIES, items: items, hasMore: false};
}

async function category(arg) {
  const pg = Math.max(1, intValue(arg && arg.page, 1));
  const tid = str(arg && arg.id) || "home";
  if (tid === "home") {
    const html = await httpGet(HOST + "/home/");
    return {items: parseCards(html), hasMore: false};
  }
  if (tid === "tags_index") {
    if (pg > 1) return {items: [], hasMore: false};
    return {items: await tagsIndexItems(), hasMore: false};
  }
  if (tid === "latest") {
    const url = pg > 1 ? HOST + "/search/----------" + pg + "---/" : HOST + "/search/-------------/";
    return listing(url, pg);
  }
  if (tid.indexOf("tag:") === 0) {
    const tag = tid.slice(4);
    const q = encodeURIComponent(tag);
    const url = pg > 1
      ? HOST + "/search/----------" + pg + "--" + q + "-/"
      : HOST + "/search/------------" + q + "-/";
    return listing(url, pg);
  }
  let path = tid.indexOf("/") === 0 ? tid : "/" + tid;
  let url = HOST + path;
  if (pg > 1) url = url.replace(/\/$/, "") + "/page/" + pg + "/";
  return listing(url, pg);
}

async function search(arg) {
  const pg = Math.max(1, intValue(arg && arg.page, 1));
  const kw = str(arg && arg.keyword).trim();
  if (!kw) return {items: [], hasMore: false};
  const q = encodeURIComponent(kw);
  const url = pg > 1
    ? HOST + "/search/" + q + "----------" + pg + "---/"
    : HOST + "/search/-------------/?wd=" + q;
  return listing(url, pg);
}

async function detail(arg) {
  const vid = str(arg && arg.id);
  if (!vid) throw new Error("invalid id");
  // tag folder ids are categories, not videos
  if (vid.indexOf("tag:") === 0) {
    return {id: vid, title: vid.slice(4), cover: "", desc: "", tags: [], lines: []};
  }
  const path = vid.indexOf("/") === 0 ? vid : "/" + vid.replace(/^\/+|\/+$/g, "") + "/";
  const html = await httpGet(HOST + path);
  if (!html) return {id: path, title: path, cover: "", desc: "", tags: [], lines: []};
  let title = "";
  const om = /property="og:title" content="([^"]+)"/.exec(html);
  if (om) title = txtOf(om[1]);
  if (!title) {
    const hm = /<div class="detail-info"><h1>([^<]+)<\/h1>/.exec(html);
    title = hm ? txtOf(hm[1]) : path;
  }
  let pic = "";
  const im = /property="og:image" content="([^"]+)"/.exec(html);
  if (im) pic = fixPic(im[1]);
  let desc = "";
  const dm = /property="og:description" content="([^"]+)"/.exec(html);
  if (dm) desc = txtOf(dm[1]);
  const tags = [];
  {
    const re = /class="detail-tag"[^>]*>#([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const t = txtOf(m[1]);
      if (t && tags.indexOf(t) < 0) tags.push(t);
    }
  }
  const epsMap = {};
  const epsOrder = [];
  function addEp(p, name) {
    if (!(p in epsMap)) epsOrder.push(p);
    epsMap[p] = name;
  }
  {
    const re = /<a class="ep[^"]*"[^>]*href="(\/play\/[\d\-]+\/)"[^>]*>([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) addEp(m[1], txtOf(m[2]));
  }
  if (!epsOrder.length) {
    const re = /href="(\/play\/[\d\-]+\/)"[^>]*>(第[^<]*集)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) addEp(m[1], txtOf(m[2]));
  }
  // The detail page also has a "watch now" anchor for ep1 without ep class;
  // if only fallback missed some, do a generic scan for 第N集 anchors.
  if (!epsOrder.length) {
    const re = /href="(\/play\/[\d\-]+\/)\s*"[^>]*>([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const nm = txtOf(m[2]);
      if (/^第.*集/.test(nm)) addEp(m[1], nm);
    }
  }
  function epNo(p) {
    const mm = /-(\d+)\/$/.exec(p);
    return mm ? parseInt(mm[1], 10) : 0;
  }
  const sorted = epsOrder.slice().sort((a, b) => epNo(a) - epNo(b));
  const episodes = sorted.map((p) => ({id: p, name: epsMap[p] || p}));
  const lines = episodes.length ? [{name: "黄果", episodes: episodes}] : [];
  return {
    id: path,
    title: title,
    cover: pic,
    desc: desc,
    tags: tags,
    lines: lines,
  };
}

async function play(arg) {
  const rawId = str((arg && arg.episodeId) || (arg && arg.id));
  if (!rawId) throw new Error("invalid play id");
  let playPath = rawId;
  if (playPath.indexOf("http") === 0) {
    try { playPath = new URL(playPath).pathname; } catch (e) { /* keep */ }
  } else if (playPath.indexOf("/") !== 0) {
    playPath = "/" + playPath.replace(/^\/+|\/+$/g, "") + "/";
  }
  const pageUrl = HOST + playPath;
  const html = await httpGet(pageUrl);
  if (!html) throw new Error("play page fetch failed");
  const pd = /player_data=(\{[\s\S]*?\})<\/script>/.exec(html);
  if (!pd) throw new Error("player_data not found");
  let data;
  try { data = JSON.parse(pd[1]); } catch (e) { throw new Error("player_data parse failed"); }
  const raw = str(data.url || "");
  const parts = raw.split("|");
  if (parts.length < 2) throw new Error("player_data url incomplete");
  const api = HOST + "/huangguo.php?ac=play&id=" + encodeURIComponent(parts[0]) +
    "&ep=" + encodeURIComponent(parts[1]) + "&_=" + Date.now();
  const jsText = await httpGet(api, {"X-Requested-With": "XMLHttpRequest"});
  if (!jsText) throw new Error("play api fetch failed");
  let d;
  try { d = JSON.parse(jsText); } catch (e) { throw new Error("play api not json"); }
  const u = str(d.url || "");
  if (d.code !== 1 || !u) throw new Error("play api code=" + str(d.code));
  let real = "";
  let proxy = "";
  if (u.indexOf("/huangguo.php?ac=media") === 0) {
    proxy = HOST + u;
  } else if (u.indexOf("/hgmedia.php?e=") === 0) {
    proxy = HOST + u;
    const token = u.split("e=")[1] || "";
    try {
      const dec = host.codec.base64Decode(token);
      if (dec.indexOf("http") === 0 && dec.indexOf(".m3u8") >= 0) real = dec.trim();
    } catch (e) { real = ""; }
  } else if (/^https?:\/\//.test(u)) {
    real = u;
  } else if (u.indexOf("/") === 0) {
    proxy = HOST + u;
  }
  const url = real || proxy;
  if (!url) throw new Error("no playable url");
  const isHls = url.indexOf(".m3u8") >= 0 || url.indexOf("ac=media") >= 0 || url.indexOf("hgmedia") >= 0;
  return {
    streams: [{
      url: url,
      format: isHls ? "hls" : "mp4",
      headers: {"Referer": HOST + "/", "User-Agent": UA},
      name: "黄果",
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
