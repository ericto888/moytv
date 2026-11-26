// 星空影院 — idj1 插件（由内置 py 蜘蛛 ffv1 改写）
// 站点：https://www.ffv1.com，纯 HTML 正则解析，与原 py 同一套规则，无登录、无付费墙。
// 分类与原 py 1:1：电视剧 tv / 电影 movie / 综艺 variety / 动漫 cartoon。
// 本机出口慢：单请求超时 60 秒、失败重试 3 次（对齐原 py 的 3 次取页）。

const HOST = "https://www.ffv1.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CLASSES = [
  { id: "tv", name: "电视剧" },
  { id: "movie", name: "电影" },
  { id: "variety", name: "综艺" },
  { id: "cartoon", name: "动漫" },
];

const PAN_DOMAINS = ["pan.quark.cn", "pan.baidu.com", "pan.xunlei.com", "aliyundrive", "alipan", "115.com", "cloud.189.cn", "pan.189.cn", "drive.uc.cn", "caiyun.139.com", "pan.wo.cn"];

function str(v) { return v == null ? "" : String(v); }
function intVal(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function clean(text) {
  let t = str(text).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}

function absUrl(url) {
  const u = str(url).trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return HOST + u;
  return u;
}

async function fetchText(url, referer) {
  const headers = {
    "User-Agent": UA,
    "Referer": referer || (HOST + "/"),
    "Accept": "text/html,application/xhtml+xml,*/*",
  };
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

function parseCards(html) {
  const vods = [];
  if (!html) return vods;
  const seen = {};
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let block;
  while ((block = liRe.exec(html)) !== null) {
    const inner = block[1];
    const m = /href="(\/detail\/\d+\/)"/.exec(inner);
    if (!m) continue;
    const vid = m[1].replace(/^\/+|\/+$/g, "");
    if (seen[vid]) continue;
    const tm = /title="([^"]+)"/.exec(inner);
    if (!tm) continue;
    let pm = /data-original="([^"]+)"/.exec(inner);
    if (!pm) pm = /<img[^>]+src="([^"]+)"/.exec(inner);
    const rm = /<p>([^<]+)<\/p>/.exec(inner);
    let pic = pm ? absUrl(pm[1]) : "";
    if (pic.indexOf("load.gif") >= 0 || pic.indexOf("placeholder") >= 0) pic = "";
    if (!pic) continue;
    seen[vid] = true;
    vods.push({
      id: vid,
      title: clean(tm[1]),
      cover: pic,
      remarks: rm ? clean(rm[1]) : "",
      duration: "",
      tags: [],
    });
  }
  return vods;
}

function pagecount(html, cur) {
  let mx = cur;
  const re = /\/type\/[^/]+\/(\d+)\//g;
  let m;
  while ((m = re.exec(html || "")) !== null) {
    const n = parseInt(m[1], 10);
    if (isFinite(n) && n > mx) mx = n;
  }
  return mx;
}

async function home() {
  const html = await fetchText(HOST + "/");
  const items = parseCards(html).slice(0, 30);
  return { categories: CLASSES.slice(), items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const pg = Math.max(1, intVal(arg && arg.page, 1));
  const tid = str(arg && arg.id) || "tv";
  const url = HOST + "/type/" + tid + "/" + pg + "/";
  const html = await fetchText(url);
  const items = parseCards(html);
  const total = pagecount(html, pg);
  return { items: items, hasMore: pg < total && items.length > 0 };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) throw host.error("E_PARSE", "搜索关键词为空");
  const url = HOST + "/search/?wd=" + encodeURIComponent(keyword);
  const html = await fetchText(url);
  const items = parseCards(html);
  return { items: items, hasMore: false };
}

async function detail(arg) {
  const raw = str(arg && arg.id);
  const vid = raw.replace(/^\/+|\/+$/g, "");
  if (!vid) throw host.error("E_PARSE", "详情 id 为空");
  const url = HOST + "/" + vid + "/";
  const html = await fetchText(url);
  if (!html) throw host.error("E_NETWORK", "详情页取不到内容");
  let title = vid;
  const tm = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
  if (tm) title = clean(tm[1].replace(/<span[^>]*>[\s\S]*?<\/span>/g, ""));
  let pic = "";
  const pm = /data-original="([^"]+)"/.exec(html);
  if (pm) pic = absUrl(pm[1]);
  if (pic.indexOf("load.gif") >= 0) pic = "";
  let desc = "";
  let dm = /剧情简介<\/h3>[\s\S]{0,400}?<p[^>]*>([^<]{10,})<\/p>/i.exec(html);
  if (!dm) dm = /剧情简介[：:\s]*([^<]{10,})/.exec(html);
  if (!dm) dm = /<span>简介：<\/span>([\s\S]*?)<\/li>/i.exec(html);
  if (dm) desc = clean(dm[1]);
  let actor = "";
  const am = /<span>主演：<\/span>([\s\S]*?)<\/li>/i.exec(html);
  if (am) actor = clean(am[1]);
  let remarks = "";
  const sm = /<span>状态：<\/span><em>([^<]+)<\/em>/.exec(html);
  if (sm) remarks = clean(sm[1]);
  let year = "";
  const ym = /<span>年份：<\/span>\s*(\d{4})/.exec(html);
  if (ym) year = ym[1];
  let area = "";
  const arm = /<span>地区：<\/span>\s*([^<]+)/.exec(html);
  if (arm) area = clean(arm[1]);

  const tabNames = [];
  const tbm = /<div class="tabs">([\s\S]*?)<\/div>/i.exec(html);
  if (tbm) {
    const are = /<a[^>]*>(?:<i[^>]*><\/i>)?([^<]+)<\/a>/g;
    let a;
    while ((a = are.exec(tbm[1])) !== null) tabNames.push(clean(a[1]));
  }

  const lines = [];
  const blockRe = /<div class="row"[^>]*>([\s\S]*?)<\/div>/gi;
  let block;
  let idx = 0;
  while ((block = blockRe.exec(html)) !== null) {
    const inner = block[1];
    const eps = [];
    const seen = {};
    const linkRe = /href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let lm;
    while ((lm = linkRe.exec(inner)) !== null) {
      let href = str(lm[1]).trim();
      let isPan = false;
      for (let i = 0; i < PAN_DOMAINS.length; i++) {
        if (href.indexOf(PAN_DOMAINS[i]) >= 0) { isPan = true; break; }
      }
      if (isPan) continue;
      if (!href || href.indexOf("javascript") === 0 || seen[href] || href.indexOf("heji") >= 0) continue;
      if (href === "/" || href.indexOf("/type/") === 0 || href.indexOf("/detail/") === 0) continue;
      seen[href] = true;
      const nm = clean(lm[2]);
      if (!nm) continue;
      eps.push({ id: absUrl(href), name: nm });
    }
    if (eps.length) {
      const name = (idx < tabNames.length && tabNames[idx]) ? tabNames[idx] : ("线路" + (idx + 1));
      lines.push({ name: name, episodes: eps });
    }
    idx++;
  }
  if (!lines.length) {
    lines.push({ name: "线路1", episodes: [{ id: url, name: "正片" }] });
  }
  const tags = [];
  if (actor) tags.push(actor);
  return {
    id: vid,
    title: title,
    cover: pic,
    desc: desc,
    year: year,
    area: area,
    remarks: remarks,
    tags: tags,
    lines: lines,
  };
}

function b64DecodeLoose(v) {
  try {
    return host.codec.base64Decode(str(v));
  } catch (e) {
    return "";
  }
}

function extractStream(html) {
  if (!html) return "";
  let m = /var player_aaaa\s*=\s*(\{[\s\S]*?\})/.exec(html);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const u = str(data.url || "");
      if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
    } catch (e) {}
  }
  m = /var\s+now\s*=\s*"([^"]+)"/.exec(html);
  if (m && m[1].indexOf("http") === 0) return m[1];
  const urlRe = /"url"\s*:\s*"([^"]+)"/g;
  let cm;
  while ((cm = urlRe.exec(html)) !== null) {
    const cand = cm[1].replace(/\\\//g, "/");
    if (cand.indexOf(".m3u8") >= 0 || cand.indexOf(".mp4") >= 0) return cand;
  }
  m = /player_data\s*=\s*(\{[\s\S]*?\})/.exec(html);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const u = str(data.url || "");
      if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
    } catch (e) {}
  }
  const iframeRe = /<iframe[^>]+src="([^"]+)"/g;
  let im;
  while ((im = iframeRe.exec(html)) !== null) {
    const src = im[1];
    const qi = src.indexOf("?");
    if (qi < 0) continue;
    const pairs = src.slice(qi + 1).split("&");
    for (let i = 0; i < pairs.length; i++) {
      const eq = pairs[i].indexOf("=");
      if (eq < 0) continue;
      const k = pairs[i].slice(0, eq);
      const v = pairs[i].slice(eq + 1);
      if (k === "url" || k === "u" || k === "play" || k === "src") {
        const dec = b64DecodeLoose(v);
        if (dec.indexOf("http") === 0 && (dec.indexOf(".m3u8") >= 0 || dec.indexOf(".mp4") >= 0)) return dec;
      }
    }
  }
  const flat = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  m = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/.exec(flat);
  if (m) return m[1];
  m = /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/.exec(flat);
  if (m) return m[1];
  m = /<source[^>]+src="([^"]+)"/.exec(html);
  if (m) return absUrl(m[1]);
  m = /url:\s*'([^']+)'/.exec(html);
  if (m && (m[1].indexOf(".m3u8") >= 0 || m[1].indexOf(".mp4") >= 0)) return m[1];
  return "";
}

async function play(arg) {
  const raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
  if (!raw) throw host.error("E_PARSE", "播放 id 为空");
  const page = raw.indexOf("http") === 0 ? raw : absUrl(raw);
  let url = "";
  if (raw.indexOf(".m3u8") >= 0 || raw.indexOf(".mp4") >= 0) {
    url = raw;
  } else {
    const html = await fetchText(page);
    url = extractStream(html);
    if (!url && html) {
      const im = /<iframe[^>]+src="([^"]+)"/.exec(html);
      if (im) {
        const src = absUrl(im[1]);
        const html2 = await fetchText(src, page);
        url = extractStream(html2);
      }
    }
  }
  if (!url) throw host.error("E_PARSE", "播放页未提取到流地址");
  if (url.indexOf("http://") === 0) url = "https://" + url.slice(7);
  const isHls = url.indexOf(".m3u8") >= 0;
  // 主列表先解析到第一条子列表再返回，播放器少跳一层、避开多跳超时；失败保留主列表。
  if (isHls) {
    try {
      const pl = await fetchText(url, page);
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
      headers: { "User-Agent": UA, "Referer": page },
      name: "星空影院",
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home: home, category: category, search: search, detail: detail, play: play };
