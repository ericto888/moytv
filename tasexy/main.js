// Tasexy — idj1 插件（由内置 py 蜘蛛 tasexy 改写）
// 站点：https://www.tasexy.com，纯 HTML 正则解析，与原 py 同一套规则，无登录、无付费墙。
// 分类与原 py 1:1（14 个，站点段 6），旗标过滤词表照搬原 py。
// 本机出口慢：单请求超时 60 秒、失败重试 3 次（对齐原 py 的 3 次取页取最长）。

const HOST = "https://www.tasexy.com";
const SITE_SEG = "6";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CLASSES = [
  { id: "1", name: "国产情色" },
  { id: "2", name: "日本无码" },
  { id: "3", name: "AV明星" },
  { id: "20", name: "中文字幕" },
  { id: "21", name: "网红主播" },
  { id: "22", name: "成人动漫" },
  { id: "23", name: "欧美情色" },
  { id: "24", name: "国模私拍" },
  { id: "25", name: "长腿丝袜" },
  { id: "26", name: "邻家人妻" },
  { id: "27", name: "韩国伦理" },
  { id: "28", name: "香港伦理" },
  { id: "31", name: "精品推荐" },
  { id: "35", name: "AV明星1" },
];

// 原 py 自带旗标过滤，照搬不删减。
const FLAG_WORDS = ["loli", "lolita", "幼女", "幼齿", "萝莉", "儿童", "初中生", "小学生", "未成年"];

function str(v) { return v == null ? "" : String(v); }
function intVal(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function clean(text) {
  let t = str(text).replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}

function isFlagged(name) {
  const low = str(name).toLowerCase();
  for (let i = 0; i < FLAG_WORDS.length; i++) {
    if (low.indexOf(FLAG_WORDS[i].toLowerCase()) >= 0) return true;
  }
  return false;
}

function absUrl(url) {
  const u = str(url).trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return HOST + u;
  if (u.indexOf("http") === 0) return u;
  return HOST + "/" + u.replace(/^\/+/, "");
}

function pageHeaders(referer) {
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": referer || (HOST + "/"),
  };
}

// 对齐原 py _http_get：最多 3 次，取最长正文，拿到 </html> 即返回。
async function fetchText(url, referer) {
  const headers = pageHeaders(referer);
  let best = "";
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await host.http.get(url, { headers: headers, timeout: TIMEOUT });
      const text = resp && resp.body ? String(resp.body) : "";
      if (text.length > best.length) best = text;
      if (text.indexOf("</html>") >= 0) return text;
    } catch (e) {
      // 超时/网络抖动：换连接重试（对齐原 py）
    }
  }
  return best;
}

// 对齐原 py _http_post：表单 POST，最多 3 次，取最长正文。
async function postText(url, formObj, referer) {
  const headers = pageHeaders(referer);
  headers["Content-Type"] = "application/x-www-form-urlencoded";
  const body = host.url.encodeForm(formObj);
  let best = "";
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await host.http.post(url, body, { headers: headers, timeout: TIMEOUT });
      const text = resp && resp.body ? String(resp.body) : "";
      if (text.length > best.length) best = text;
      if (text.indexOf("</html>") >= 0 || text.length > 5000) return text;
    } catch (e) {
      // 超时/网络抖动：换连接重试（对齐原 py）
    }
  }
  return best;
}

// 对齐原 py _cards：按 /v/{id}.html 锚点切段，段内取 li.title / img= / span.note。
function parseCards(html) {
  const vods = [];
  if (!html) return vods;
  const seen = {};
  const anchors = [];
  const aRe = /<a[^>]*href="\/v\/(\d+)\.html"[^>]*>/g;
  let m;
  while ((m = aRe.exec(html)) !== null) {
    anchors.push({ vid: m[1], start: m.index });
  }
  for (let idx = 0; idx < anchors.length; idx++) {
    const vid = anchors[idx].vid;
    if (seen[vid]) continue;
    const start = anchors[idx].start;
    const end = idx + 1 < anchors.length ? anchors[idx + 1].start : start + 1500;
    const seg = html.slice(start, Math.min(end, start + 1500));
    const tm = /<li class="title">([\s\S]*?)<\/li>/.exec(seg);
    if (!tm) continue;
    const title = clean(tm[1]);
    if (!title || isFlagged(title)) continue;
    const pm = /\bimg="([^"]+)"/.exec(seg);
    const nm = /<span class="note">([^<]*)<\/span>/.exec(seg);
    seen[vid] = true;
    vods.push({
      id: vid,
      title: title,
      cover: pm ? absUrl(pm[1]) : "",
      remarks: nm ? clean(nm[1]) : "",
      duration: "",
      tags: [],
    });
  }
  return vods;
}

function pagecount(html, cur, tid) {
  let mx = cur;
  const re = new RegExp("/site/" + SITE_SEG + "/" + tid + "-(\\d+)\\.html", "g");
  let m;
  while ((m = re.exec(html || "")) !== null) {
    const n = parseInt(m[1], 10);
    if (isFinite(n) && n > mx) mx = n;
  }
  return mx;
}

async function home() {
  const html = await fetchText(HOST + "/", HOST + "/");
  const items = parseCards(html);
  return { categories: CLASSES.slice(), items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const pg = Math.max(1, intVal(arg && arg.page, 1));
  const tid = str(arg && arg.id).trim() || "1";
  const url = HOST + "/site/" + SITE_SEG + "/" + tid + "-" + pg + ".html";
  const html = await fetchText(url, HOST + "/");
  const items = parseCards(html);
  const total = pagecount(html, pg, tid);
  return { items: items, hasMore: pg < total && items.length > 0 };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) throw host.error("E_PARSE", "搜索关键词为空");
  const url = HOST + "/?module=tags&action=keyword";
  const html = await postText(url, { keyword: keyword }, HOST + "/");
  const items = parseCards(html);
  return { items: items, hasMore: false };
}

async function detail(arg) {
  const raw = str(arg && arg.id);
  const dm = /(\d+)/.exec(raw);
  const vid = dm ? dm[1] : raw.trim();
  if (!vid) throw host.error("E_PARSE", "详情 id 为空");
  const html = await fetchText(HOST + "/v/" + vid + ".html", HOST + "/");
  if (!html) throw host.error("E_NETWORK", "详情页取不到内容");
  let title = vid;
  const tm = /<title[^>]*>([^<]+)<\/title>/.exec(html);
  if (tm) {
    title = clean(tm[1]).split(" - Tasexy")[0].split(" - ")[0].trim() || vid;
  }
  let pic = "";
  const pm = /\bimg="(https?:\/\/[^"]+)"/.exec(html);
  if (pm) pic = pm[1];
  if (!pic) {
    // 原 py 正则在现站详情页取不到封面（封面只在 og:image 里），同地址兜底。
    const om = /property="og:image" content="([^"]+)"/.exec(html);
    if (om) pic = om[1];
  }
  let desc = "";
  const dsm = /<div class="des">([\s\S]*?)<\/div>/.exec(html);
  if (dsm) desc = clean(dsm[1]);
  return {
    id: vid,
    title: title,
    cover: pic,
    desc: desc,
    year: "",
    area: "",
    remarks: "",
    tags: [],
    lines: [{ name: "在线播放", episodes: [{ id: HOST + "/embed/" + vid + ".html", name: "正片" }] }],
  };
}

// 对齐原 py _extract_stream：url = '...' → 裸 m3u8 → 裸 mp4。
function extractStream(html) {
  if (!html) return "";
  let m = /url\s*=\s*'([^']+)'/.exec(html);
  if (m && m[1].indexOf("http") === 0) return m[1];
  m = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/.exec(html);
  if (m) return m[1].replace(/,$/, "");
  m = /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/.exec(html);
  if (m) return m[1].replace(/,$/, "");
  return "";
}

async function play(arg) {
  const raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
  if (!raw) throw host.error("E_PARSE", "播放 id 为空");
  let page = "";
  if (raw.indexOf("/embed/") >= 0) {
    page = raw.indexOf("http") === 0 ? raw : HOST + raw;
  } else {
    const dm = /(\d+)/.exec(raw);
    if (raw.indexOf("http") === 0 && raw.indexOf("/v/") >= 0) {
      page = raw;
    } else if (dm) {
      page = HOST + "/embed/" + dm[1] + ".html";
    }
  }
  let url = "";
  let html = page ? await fetchText(page, HOST + "/") : "";
  if (page && page.indexOf("/embed/") < 0) {
    const im = /<iframe[^>]+src="([^"]+)"/.exec(html || "");
    if (im) {
      page = absUrl(im[1]);
      html = await fetchText(page, HOST + "/");
    }
  }
  url = extractStream(html);
  if (!url) throw host.error("E_PARSE", "播放页未提取到流地址");
  if (url.indexOf("http://") === 0) url = "https://" + url.slice(7);
  const isHls = url.indexOf(".m3u8") >= 0;
  // 主列表先解析到第一条子列表再返回，播放器少跳一层、避开多跳超时；失败保留主列表。
  if (isHls) {
    try {
      const pl = await fetchText(url, page || (HOST + "/"));
      if (pl && pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const ls = pl.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s && s.charAt(0) !== "#"; });
        if (ls.length) url = host.url.resolve(url, ls[0]);
      }
    } catch (e) {}
  }
  return {
    streams: [{
      url: url,
      format: isHls ? "hls" : "video",
      headers: { "User-Agent": UA, "Referer": page || (HOST + "/") },
      name: "Tasexy",
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home: home, category: category, search: search, detail: detail, play: play };
