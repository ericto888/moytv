// HereXXX — idj1 plugin (rewritten 1:1 from the builtin py spider herexxx)
// Site: https://herexxx.com (KVS-style HTML site, no login, no signed API).
// Categories: the py's fixed 17-entry CATS list, unchanged.
// Lists: HTML card parsing. Note: the site changed its card markup since the
// py was written ('<div class="item thumb">' -> '<div class="thumb thumb_rel
// item  ">', '<span class="time">' -> '<div class="time">'), so the splitter
// accepts both the py's original markers and the current ones; all other
// extraction (anchor href, title attr, data-original cover, time text)
// follows the py exactly.
// Detail: <title>, og:image, flashvars video_categories / duration
// (JSON-LD duration as fallback), one line / one episode 'herexxx:<pageUrl>'.
// Play: re-fetch the detail page, take flashvars video_url (base64) and
// decode it -> an https get_file mp4 URL on herexxx.com, which 302-redirects
// to a signed mp4 on the tubegifs CDN; play() resolves that redirect inside
// the plugin (Range probe, host follows redirects) and returns the final
// https mp4. If the stream were an m3u8 master playlist, play() pre-resolves
// it to the first variant playlist before returning.

const HOST = "https://herexxx.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
  ["latest-updates", "最新"],
  ["most-popular:video_viewed", "最热"],
  ["most-popular:video_viewed_today", "HOT"],
  ["cat:vip", "KVIP"],
  ["cat:jvip", "JVIP"],
  ["cat:korean-porn", "Korean Porn"],
  ["cat:korean-bj", "Korean BJ"],
  ["cat:fc2ppv", "FC2PPV"],
  ["cat:jav", "Uncensored"],
  ["cat:ipcam", "IPCAM"],
  ["cat:toilet", "Toilet"],
  ["cat:voyeur-jp", "Voyeur JP"],
  ["cat:china", "China"],
  ["cat:myfans", "MyFans"],
  ["cat:asian-leak", "Asian Leak"],
  ["cat:upskirt", "Upskirt"],
  ["cat:mib", "MIB"],
];

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function decodeEntities(s) {
  let out = str(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&ndash;/g, "–").replace(/&mdash;/g, "—");
  out = out.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)));
  return out.trim();
}

async function httpGet(url, referer) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await host.http.get(url, {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9",
          "Referer": referer || (HOST + "/"),
        },
        timeout: TIMEOUT,
      });
      if (resp.status === 200 && resp.body) return resp.body;
      lastErr = new Error("HTTP " + resp.status);
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return "";
}

function absUrl(u) {
  u = str(u).trim();
  if (u.startsWith("//")) return "https:" + u;
  return u;
}

function parseCards(html) {
  const out = [];
  const seen = {};
  if (!html) return out;
  const blocks = str(html).split(/<div class="(?:item thumb|thumb thumb_rel item)[^"]*">/);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const p = block.indexOf('<a href="https://herexxx.com/video/');
    if (p < 0) continue;
    const s = p + 9;
    const e = block.indexOf('"', s);
    if (e < 0) continue;
    const href = block.slice(s, e);
    if (seen[href]) continue;
    const tp = block.indexOf('title="');
    if (tp < 0) continue;
    const ts = tp + 7;
    const te = block.indexOf('"', ts);
    const title = te >= 0 ? decodeEntities(block.slice(ts, te)) : "";
    if (!title) continue;
    let cover = "";
    const cp = block.indexOf('data-original="');
    if (cp >= 0) {
      const cs = cp + 15;
      const ce = block.indexOf('"', cs);
      if (ce >= 0) cover = block.slice(cs, ce);
    }
    let remark = "";
    let rp = block.indexOf('<span class="time">');
    let rOff = 19;
    if (rp < 0) { rp = block.indexOf('<div class="time">'); rOff = 18; }
    if (rp >= 0) {
      const rs = rp + rOff;
      const re = block.indexOf("</", rs);
      if (re >= 0) remark = block.slice(rs, re).trim();
    }
    seen[href] = true;
    out.push({ id: href, title: title.slice(0, 90), cover: absUrl(cover), remarks: remark });
  }
  return out;
}

function catalogUrl(tid, pg) {
  const pagePart = pg <= 1 ? "" : String(pg) + "/";
  if (tid.indexOf("cat:") === 0) return HOST + "/categories/" + tid.slice(4) + "/" + pagePart;
  if (tid.indexOf("most-popular:") === 0) return HOST + "/most-popular/" + pagePart + "?sort_by=" + tid.slice("most-popular:".length);
  return HOST + "/" + tid + "/" + pagePart;
}

function isoDuration(s) {
  const m = str(s).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] || "0", 10), mi = parseInt(m[2] || "0", 10), sec = parseInt(m[3] || "0", 10);
  const p2 = (n) => String(n).padStart(2, "0");
  if (h > 0) return h + ":" + p2(mi) + ":" + p2(sec);
  return mi + ":" + p2(sec);
}

function metaContent(html, attr, key) {
  const marker = attr + '="' + key + '"';
  const p = str(html).indexOf(marker);
  if (p < 0) return "";
  const after = str(html).slice(p);
  const c = after.indexOf('content="');
  if (c < 0) return "";
  const s = c + 9;
  const e = after.indexOf('"', s);
  if (e < 0) return "";
  return decodeEntities(after.slice(s, e));
}

function flashvar(html, key) {
  const marker = key + ": '";
  const p = str(html).indexOf(marker);
  if (p < 0) return "";
  const s = p + marker.length;
  const e = str(html).indexOf("'", s);
  if (e < 0) return "";
  return str(html).slice(s, e);
}

function tagTitle(html) {
  const p = str(html).indexOf("<title>");
  if (p < 0) return "";
  const s = p + 7;
  const e = str(html).indexOf("</title>", s);
  const t = decodeEntities(e >= 0 ? str(html).slice(s, e) : str(html).slice(s));
  for (const sep of [" | ", " - "]) {
    if (t.indexOf(sep) >= 0) return t.split(sep).slice(0, -1).join(sep).trim() || t;
  }
  return t;
}

function decodeVideoUrl(b64) {
  b64 = str(b64).trim();
  if (!b64) return "";
  try { return host.codec.base64Decode(b64).trim(); } catch (e) { return ""; }
}

function normId(ids) {
  let v = ids;
  if (Array.isArray(v)) v = v.length ? v[0] : "";
  return str(v).trim();
}

async function home() {
  const categories = CATS.map(c => ({ id: c[0], name: c[1] }));
  let items = [];
  try { items = parseCards(await httpGet(catalogUrl("latest-updates", 1))); } catch (e) { items = []; }
  return { categories: categories, items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const page = Math.max(1, intValue(arg && arg.page, 1));
  let tid = str(arg && arg.id).trim();
  if (!tid) tid = "latest-updates";
  let items = [];
  try { items = parseCards(await httpGet(catalogUrl(tid, page))); } catch (e) { items = []; }
  return { items: items, hasMore: items.length > 0 };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) return { items: [], hasMore: false };
  let items = [];
  try {
    items = parseCards(await httpGet(HOST + "/search/?q=" + encodeURIComponent(keyword))).slice(0, 60);
  } catch (e) { items = []; }
  return { items: items, hasMore: false };
}

async function detail(arg) {
  const nid = normId(arg && arg.id);
  if (!nid) throw new Error("无效的影片 ID");
  const html = await httpGet(nid);
  if (!html) return { id: nid, title: nid, cover: "", desc: "", tags: [], lines: [] };
  const title = tagTitle(html);
  if (!title) return { id: nid, title: nid, cover: "", desc: "", tags: [], lines: [] };
  const cover = absUrl(metaContent(html, "property", "og:image"));
  let duration = isoDuration(flashvar(html, "duration"));
  if (!duration) {
    const dm = html.match(/"duration":\s*"(PT[^"]+)"/);
    if (dm) duration = isoDuration(dm[1]);
  }
  const cats = flashvar(html, "video_categories");
  const lines = [];
  if (cats) lines.push("分类：" + cats);
  if (duration) lines.push("时长：" + duration);
  const desc = lines.join("\n").slice(0, 400);
  const tags = cats ? [cats] : [];
  return {
    id: nid,
    title: title,
    cover: cover,
    desc: desc,
    tags: tags,
    remarks: duration,
    lines: [{ name: "在线播放", episodes: [{ id: "herexxx:" + nid, name: "正片" }] }],
  };
}

async function play(arg) {
  let raw = normId((arg && arg.episodeId) || (arg && arg.id));
  if (raw.indexOf("herexxx:") === 0) raw = raw.slice("herexxx:".length);
  const headers = { "User-Agent": UA, "Referer": HOST + "/" };
  let url = "";
  if (raw.indexOf(".mp4") >= 0 && /^https:\/\//i.test(raw)) {
    url = raw;
  } else {
    const pageUrl = raw.split("$").slice(-1)[0];
    const html = await httpGet(pageUrl);
    if (html) {
      url = decodeVideoUrl(flashvar(html, "video_url"));
      // Page URLs carry raw non-ASCII slugs; a Referer header must be
      // percent-encoded or fetch rejects it as a non-ByteString value.
      if (url) headers["Referer"] = encodeURI(pageUrl);
    }
  }
  if (!url) throw new Error("未找到播放地址");
  if (!/^https:\/\//i.test(url)) throw new Error("播放地址不是 https 直链");
  const isHls = /\.m3u8($|\?)/i.test(url);
  if (isHls) {
    // Pre-resolve a master playlist to its first variant playlist.
    try {
      const resp = await host.http.get(url, { headers: headers, timeout: TIMEOUT });
      if (resp.status === 200 && resp.body && resp.body.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const lines = resp.body.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
        if (lines.length) url = host.url.resolve(url, lines[0]);
      }
    } catch (e) { /* master playlist itself is playable; keep original */ }
  } else {
    // The get_file mp4 URL 302-redirects to a signed CDN mp4; resolve the
    // redirect inside play() and hand the player the final https address.
    try {
      const resp = await host.http.request({
        url: url,
        method: "GET",
        headers: Object.assign({}, headers, { "Range": "bytes=0-1023" }),
        timeout: TIMEOUT,
      });
      if (resp && resp.url && /^https:\/\//i.test(resp.url) && resp.url !== url) url = resp.url;
    } catch (e) { /* keep the get_file URL; players follow the 302 too */ }
  }
  return {
    streams: [{ url: url, format: isHls ? "hls" : "mp4", headers: headers, name: "HereXXX" }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default {home, category, search, detail, play};
