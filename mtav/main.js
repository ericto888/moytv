// 蜜桃视频 — idj1 插件（由内置 py 蜘蛛 mtav 改写）
// 站点：https://mtav.art，HTML 站：
// 列表卡在 <div class="item"> 里（/vod/play/id/<id>/ + img alt/src + title），
// 详情页 <title>/meta description 取名与简介，播放地址在详情页 var uul 里（m3u8 直链）。
// 与原 py 同一套正则与旗标过滤（FLAG_WORDS 照搬）。

const HOST = "https://mtav.art";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

// 与原 py 完全一致的 3 个分类
const CATS = [
  { id: "1", name: "视频一区" },
  { id: "2", name: "视频二区" },
  { id: "3", name: "视频三区" },
];

// 原 py FLAG_WORDS 照搬：标题命中任一词即剔除
const FLAG_WORDS = ["loli", "lolita", "幼女", "幼齿", "萝莉", "儿童", "初中生", "小学生", "未成年"];

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function absUrl(url) {
  let u = str(url).trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return HOST + u;
  if (u.indexOf("http") === 0) return u;
  return HOST + "/" + u.replace(/^\/+/, "");
}

function clean(text) {
  let t = str(text)
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}

function isFlagged(name) {
  const low = str(name).toLowerCase();
  for (const w of FLAG_WORDS) if (low.indexOf(w.toLowerCase()) >= 0) return true;
  return false;
}

// 原 py _http_get：3 次重试，取到含 </html> 的完整页即返回，否则返回最长的一次
async function fetchHtml(url, referer) {
  let best = "";
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
      const text = str(resp.body);
      if (text.length > best.length) best = text;
      if (text.indexOf("</html>") >= 0) return text;
    } catch (e) { /* 与原 py 一样吞掉重试 */ }
  }
  return best;
}

// 原 py _cards：按 <div class="item"> 切块，块内取 /vod/play/id/、img alt/src、title、time
function parseCards(html) {
  const out = [];
  const seen = {};
  if (!html) return out;
  const parts = str(html).split('<div class="item">');
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i].slice(0, 2500);
    const hm = /href="\/vod\/play\/id\/(\d+)\//.exec(seg);
    if (!hm) continue;
    const vid = hm[1];
    if (seen[vid]) continue;
    let title = "", pic = "";
    const im = /<img[^>]+>/.exec(seg);
    if (im) {
      const am = /alt="([^"]+)"/.exec(im[0]);
      const sm = /src="([^"]+)"/.exec(im[0]);
      if (am) title = clean(am[1]);
      if (sm) pic = absUrl(sm[1]);
    }
    if (!title) {
      const tm = /class="title">([\s\S]*?)<\//.exec(seg);
      if (tm) title = clean(tm[1]);
    }
    if (!title || isFlagged(title)) continue;
    seen[vid] = true;
    const rm = /<span class="[^"]*time[^"]*">([^<]+)</.exec(seg);
    out.push({
      id: vid,
      title: title,
      cover: pic,
      remarks: rm ? clean(rm[1]) : "",
      tags: [],
    });
  }
  return out;
}

function pagecount(html, cur, tid) {
  const re = new RegExp("/vod/show/id/" + tid + "/page/(\\d+)/", "g");
  let m, mx = 0;
  while ((m = re.exec(str(html))) !== null) {
    const n = parseInt(m[1], 10);
    if (isFinite(n) && n > mx) mx = n;
  }
  return mx ? Math.max(mx, cur) : cur;
}

function categories() {
  return CATS.map(c => ({ id: c.id, name: c.name }));
}

async function home() {
  let items = [];
  try {
    const html = await fetchHtml(HOST + "/", HOST + "/");
    items = parseCards(html);
  } catch (e) { items = []; }
  return { categories: categories(), items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const pg = Math.max(1, intValue(arg && arg.page, 1));
  let tid = str(arg && arg.id).trim();
  if (tid.indexOf(",") >= 0) tid = tid.split(",")[0];
  let vods = [], total = pg;
  try {
    const url = HOST + "/vod/show/id/" + tid + "/page/" + pg + "/";
    const html = await fetchHtml(url, HOST + "/");
    vods = parseCards(html);
    total = pagecount(html, pg, tid);
  } catch (e) { vods = []; total = pg; }
  return { items: vods, hasMore: pg < total };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) return { items: [], hasMore: false };
  let vods = [];
  try {
    const url = HOST + "/vod/search.html?wd=" + encodeURIComponent(keyword);
    const html = await fetchHtml(url, HOST + "/");
    vods = parseCards(html);
  } catch (e) { vods = []; }
  return { items: vods, hasMore: false };
}

// 原 py _parse_detail：<title> 去 Playing 前缀与 -watch onlie 后缀，简介取 meta description
async function detail(arg) {
  let vid = str(arg && arg.id);
  if (vid.indexOf(",") >= 0) vid = vid.split(",")[0];
  const nm = /(\d+)/.exec(vid);
  if (nm) vid = nm[1];
  const url = HOST + "/vod/detail/id/" + vid + "/";
  const html = await fetchHtml(url, HOST + "/");
  let title = "";
  const m = /<title[^>]*>([^<]+)<\/title>/.exec(html);
  if (m) {
    let raw = clean(m[1]);
    raw = raw.replace(/^Playing\s+/, "");
    title = raw.split("-watch onlie")[0].split(" watcho")[0].trim();
  }
  let desc = "";
  const dm = /name="description" content="([^"]*)"/.exec(html);
  if (dm) desc = clean(dm[1]);
  if (!title && desc) title = desc.split(" watcho")[0].trim();
  return {
    id: vid,
    title: title || vid,
    cover: "",
    desc: desc,
    tags: [],
    remarks: "",
    lines: [{
      name: "在线播放",
      episodes: [{ id: url, name: "正片" }],
    }],
  };
}

// 原 py _extract_stream：var uul 优先，其次裸 m3u8，再 mp4
function extractStream(html) {
  if (!html) return "";
  let m = /var uul\s*=\s*'([^']+)'/.exec(html);
  if (m && m[1].indexOf("http") === 0) return m[1];
  m = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/.exec(html);
  if (m) return m[1].replace(/,$/, "");
  m = /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/.exec(html);
  if (m) return m[1].replace(/,$/, "");
  return "";
}

async function play(arg) {
  let raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
  if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
  let page = "";
  if (raw.indexOf("http") === 0) page = raw;
  else if (raw.indexOf("/vod/") >= 0) page = raw.charAt(0) === "/" ? HOST + raw : HOST + "/" + raw;
  else {
    const m = /(\d+)/.exec(raw);
    page = m ? HOST + "/vod/detail/id/" + m[1] + "/" : "";
  }
  let url = "";
  if (/\.m3u8($|\?)/i.test(raw) || /\.mp4($|\?)/i.test(raw)) {
    url = raw;
  } else if (page) {
    const html = await fetchHtml(page, HOST + "/");
    url = extractStream(html);
  }
  if (!url) throw new Error("未提取到播放地址");
  const isHls = /\.m3u8($|\?)/i.test(url);
  if (isHls) {
    // master 主清单先在插件内解析到子清单，避免播放器多跳超时
    try {
      const resp = await host.http.get(url, {
        headers: { "User-Agent": UA, "Referer": page || (HOST + "/") },
        timeout: TIMEOUT,
      });
      if (resp.status === 200 && resp.body && resp.body.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const lines = resp.body.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
        if (lines.length) url = host.url.resolve(url, lines[0]);
      }
    } catch (e) { /* 子清单解析失败就用原地址 */ }
  }
  return {
    streams: [{
      url: url,
      format: isHls ? "hls" : "mp4",
      headers: { "User-Agent": UA, "Referer": page || (HOST + "/") },
      name: "蜜桃视频",
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home, category, search, detail, play };
