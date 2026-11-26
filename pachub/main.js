const BASE = "https://pachub.net";
const UA = "Mozilla/5.0 (Linux; Android 14; HarmonyOS; HUAWEI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const TIMEOUT = 60000;

const CATS = [
  ["av-all", "全部国产", ""],
  ["av-kxgc", "开心鬼传媒", "开心鬼传媒"],
  ["av-mdsp", "麻豆视频", "麻豆视频"],
  ["av-crtt", "成人头条", "成人头条"],
  ["av-mini", "mini传媒", "mini传媒"],
  ["av-lbsc", "乐播传媒", "乐播传媒"],
  ["av-wjcm", "乌鸦传媒", "乌鸦传媒"],
  ["av-txvlog", "糖心Vlog", "糖心vlog"],
  ["av-91sp", "91视频", "91视频"],
  ["av-dxcm", "大象传媒", "大象传媒"],
  ["av-xkcm", "星空传媒", "星空传媒"],
  ["av-mtcm", "蜜桃传媒", "蜜桃传媒"],
  ["av-jdyy", "精东影业", "精东影业"],
  ["av-tmcm", "天美传媒", "天美传媒"],
  ["av-91zpc", "91制片厂", "91制片厂"],
  ["av-xbzc", "杏吧原创", "杏吧原创"],
  ["av-xsj", "性视界", "性视界"],
  ["av-hjhr", "皇家华人", "皇家华人"],
  ["av-tzxs", "兔子先生", "兔子先生"],
  ["av-psycho", "PsychoPorn", "psychoporn"],
  ["av-hjsw", "海角社区", "海角社区"],
  ["av-wjjj", "玩偶姐姐", "玩偶姐姐"],
  ["ai-dj", "AI成人短剧", "AI成人短剧"],
];

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function unescapeHtml(s) {
  return str(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\\//g, "/");
}

function fmtDuration(secs) {
  const s = parseInt(secs, 10);
  if (!isFinite(s) || s <= 0) return "";
  const p2 = (n) => (n < 10 ? "0" + n : "" + n);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h > 0) return h + ":" + p2(m) + ":" + p2(ss);
  return m + ":" + p2(ss);
}

function textOf(v, keys) {
  if (!v || typeof v !== "object") return "";
  for (const k of keys) {
    const x = v[k];
    if (x == null || typeof x === "boolean") continue;
    const s = String(x);
    if (s) return s;
  }
  return "";
}

function intOf(v, keys) {
  const s = textOf(v, keys);
  const n = parseInt(parseFloat(s), 10);
  return isFinite(n) ? n : 0;
}

function directUrl(raw) {
  const u = str(raw).trim();
  if (u.indexOf("/proxy/m3u8?u=") === 0) {
    let b64 = u.slice("/proxy/m3u8?u=".length).split("&")[0];
    b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    try {
      const decoded = host.codec.base64Decode(b64, { to: "utf8" }).trim();
      if (decoded.indexOf("http") === 0) return decoded;
    } catch (e) { /* fall through */ }
    return BASE + u;
  }
  if (u.charAt(0) === "/") return BASE + u;
  return u;
}

async function httpGet(url) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await host.http.get(url, {
        headers: { "User-Agent": UA, "Referer": BASE },
        timeout: TIMEOUT,
      });
      if (resp.status === 200 && resp.body) return resp.body;
      lastErr = new Error("HTTP " + resp.status);
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return "";
}

async function httpPostJson(url, referer) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await host.http.post(url, "", {
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json",
          "Origin": BASE,
          "Referer": referer,
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

function apiItems(body, ai) {
  const out = [];
  if (!body || typeof body !== "object") return out;
  const items = body.items || [];
  for (const entry of items) {
    const title = textOf(entry, ["title"]);
    if (!title) continue;
    const cover = textOf(entry, ["coverUrl"]);
    const remark = fmtDuration(intOf(entry, ["duration"]));
    let vid = "";
    if (ai) {
      const sid = textOf(entry, ["sourceId"]);
      if (!sid) continue;
      vid = "ai/" + sid;
    } else {
      const num = intOf(entry, ["id"]);
      if (num === 0) continue;
      vid = "av/" + num;
    }
    out.push({ id: vid, title: title, cover: cover, remarks: remark, duration: remark, tags: [] });
  }
  return out;
}

async function catalog(tid, pg) {
  let cat = null;
  for (const c of CATS) if (c[0] === tid) { cat = c; break; }
  if (!cat) return [];
  const ai = tid === "ai-dj";
  const params = { page: String(pg), page_size: "24" };
  if (cat[2]) params.category = cat[2];
  const path = ai ? "/api/ai?" : "/api/videos?";
  const url = BASE + path + host.url.encodeForm(params);
  let body = {};
  try { body = JSON.parse(await httpGet(url) || "{}"); } catch (e) { body = {}; }
  return apiItems(body, ai);
}

function categories() {
  return CATS.map(c => ({ id: c[0], name: c[1] }));
}

async function home() {
  let items = [];
  try { items = await catalog("av-all", 1); } catch (e) { items = []; }
  return { categories: categories(), items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const page = Math.max(1, intValue(arg && arg.page, 1));
  const tid = str(arg && arg.id).trim();
  if (!tid) return { items: [], hasMore: false };
  let items = [];
  try { items = await catalog(tid, page); } catch (e) { items = []; }
  return { items: items, hasMore: items.length >= 24 };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) return { items: [], hasMore: false };
  const url = BASE + "/search?" + host.url.encodeForm({ q: keyword });
  let html = "";
  try { html = await httpGet(url); } catch (e) { html = ""; }
  const out = [];
  const seen = {};
  const re = /<a[^>]*href="\/(av|ai)\/([^"]+)"[^>]*aria-label="([^"]+)"/g;
  let mm;
  while ((mm = re.exec(html || "")) !== null) {
    const vid = mm[1] + "/" + mm[2];
    if (seen[vid]) continue;
    const title = unescapeHtml(mm[3].trim());
    if (!title) continue;
    seen[vid] = true;
    const tail = html.slice(mm.index + mm[0].length, mm.index + mm[0].length + 4000);
    let cover = "";
    const m2 = tail.match(/<img[^>]*src="(https:\/\/cdn\.pachub\.net\/[^"]+)"/);
    if (m2) cover = m2[1];
    let remark = "";
    const m3 = tail.match(/>(\d+:\d+(?::\d+)?)</);
    if (m3) remark = m3[1];
    out.push({ id: vid, title: title, cover: cover, remarks: remark, duration: remark, tags: [] });
  }
  return { items: out, hasMore: false };
}

function metaContent(html, attr, val) {
  const re1 = new RegExp('<meta[^>]*content="([^"]+)"[^>]*' + attr + '="' + val + '"');
  const re2 = new RegExp('<meta[^>]*' + attr + '="' + val + '"[^>]*content="([^"]+)"');
  let m = html.match(re1);
  if (m) return unescapeHtml(m[1] || "");
  m = html.match(re2);
  if (m) return unescapeHtml(m[1] || "");
  return "";
}

async function detail(arg) {
  let nid = str(arg && arg.id);
  if (nid.indexOf(",") >= 0) nid = nid.split(",")[0];
  nid = nid.trim();
  if (!nid) return { id: nid, title: "", cover: "", desc: "", tags: [], lines: [] };
  let url;
  if (nid.indexOf("http") === 0) url = nid;
  else if (nid.charAt(0) === "/") url = BASE + nid;
  else url = BASE + "/" + nid;
  const html = await httpGet(url);
  if (!html) return { id: nid, title: "", cover: "", desc: "", tags: [], lines: [] };
  const ai = nid.indexOf("/ai/") >= 0 || url.indexOf("/ai/") >= 0;
  let title = metaContent(html, "property", "og:title");
  const suffix = ai ? " · AI | PacHub" : " · 国产 | PacHub";
  if (title.slice(-suffix.length) === suffix) title = title.slice(0, title.length - suffix.length).trim();
  const cover = metaContent(html, "property", "og:image");
  const desc = metaContent(html, "name", "description");
  const synopsis = desc.split(" — ")[0].trim();
  if (!title) return { id: nid, title: "", cover: "", desc: "", tags: [], lines: [] };
  const episodes = [];
  if (ai) {
    const path = url.slice(BASE.length).replace(/^\//, "");
    const series = path.indexOf("ai/") === 0 ? path.slice(3).split("-")[0] : path.split("-")[0];
    const nums = [];
    const re = new RegExp('href="/ai/' + series.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '(-ep-(\\d+))?"', "g");
    let mm;
    while ((mm = re.exec(html)) !== null) {
      const n = mm[2] ? parseInt(mm[2], 10) : 1;
      if (nums.indexOf(n) < 0) nums.push(n);
    }
    nums.sort((a, b) => a - b);
    for (const n of nums) {
      const epId = n === 1 ? "ai/" + series : "ai/" + series + "-ep-" + n;
      episodes.push({ id: epId, name: "第" + n + "集" });
    }
  }
  if (!episodes.length) episodes.push({ id: nid, name: "播放" });
  return {
    id: nid,
    title: title,
    cover: cover,
    desc: synopsis,
    tags: [],
    remarks: "",
    lines: [{ name: "在线播放", episodes: episodes }],
  };
}

async function play(arg) {
  let raw = str((arg && arg.episodeId) || (arg && arg.id));
  if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
  raw = raw.trim();
  let url;
  if (raw.indexOf("http") === 0) url = raw;
  else if (raw.charAt(0) === "/") url = BASE + raw;
  else url = BASE + "/" + raw;
  const html = await httpGet(url);
  let endpoint = "";
  const m = (html || "").match(/apiEndpoint(?:&quot;|"):\[0,(?:&quot;|")(\/api\/[^&"]+\/stream)/);
  if (m) endpoint = m[1];
  if (!endpoint) throw new Error("未找到播放接口");
  const text = await httpPostJson(BASE + endpoint, url);
  let body = {};
  try { body = JSON.parse(text || "{}"); } catch (e) { body = {}; }
  const rawUrl = textOf(body, ["m3u8Url"]);
  if (!rawUrl) throw new Error("播放接口未返回地址");
  let playUrl = directUrl(rawUrl);
  const headers = { "User-Agent": UA, "Referer": url };
  const isHls = /\.m3u8($|\?)/i.test(playUrl);
  if (isHls) {
    try {
      const resp = await host.http.get(playUrl, { headers: headers, timeout: TIMEOUT });
      if (resp.status === 200 && resp.body && resp.body.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const lines = resp.body.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
        if (lines.length) playUrl = host.url.resolve(playUrl, lines[0]);
      }
    } catch (e) { /* keep original url */ }
  }
  return {
    streams: [{
      url: playUrl,
      format: isHls ? "hls" : "mp4",
      headers: headers,
      name: "在线播放",
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home, category, search, detail, play };
