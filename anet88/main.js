// 咕咚影院 — idj1 插件（由内置 py 蜘蛛 anet88 改写）
// 站点：https://www.anet88.com，MacCMS 风格 HTML 站：
// 列表卡在 <li> 里（/anevod/<id>.html + title + data-original 封面），
// 详情页 myui-content__list 分集，播放页 player_aaaa / var now / iframe 提取流地址。
// 与原 py 同一套正则与过滤（网盘链接、heji、javascript 全部照搬剔除）。

const HOST = "https://www.anet88.com";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const TIMEOUT = 60000;

// 与原 py 完全一致的 6 个分类
const CATS = [
  { id: "1", name: "电影" },
  { id: "2", name: "电视剧" },
  { id: "3", name: "综艺" },
  { id: "4", name: "动漫" },
  { id: "30", name: "短剧" },
  { id: "55", name: "预告" },
];

const PAN_HOSTS = [
  "pan.quark.cn", "pan.baidu.com", "pan.xunlei.com", "aliyundrive", "alipan",
  "115.com", "cloud.189.cn", "pan.189.cn", "drive.uc.cn", "caiyun.139.com", "pan.wo.cn",
];

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function absUrl(url) {
  let u = str(url).trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) u = "https:" + u;
  else if (u.charAt(0) === "/") u = HOST + u;
  return u;
}

function clean(text) {
  let t = str(text)
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}

// 原 py _fetch：3 次重试，取到含 </html> 的完整页即返回，否则返回最长的一次
async function fetchHtml(url, referer) {
  let best = "";
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await host.http.get(url, {
        headers: {
          "User-Agent": UA,
          "Referer": referer || (HOST + "/"),
          "Accept": "text/html,application/xhtml+xml,*/*",
        },
        timeout: TIMEOUT,
      });
      const text = str(resp.body);
      if (text.length > best.length) best = text;
      if (text.indexOf("</html>") >= 0) return text;
      if (resp.status !== 200) lastErr = new Error("HTTP " + resp.status);
    } catch (e) { lastErr = e; }
  }
  if (best) return best;
  if (lastErr) throw lastErr;
  return best;
}

// 原 py _cards：<li> 块里 /anevod/\d+.html + title + data-original/img src + pic-text
function parseCards(html) {
  const vods = [];
  const seen = {};
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(str(html))) !== null) {
    const block = m[1];
    const hm = /href="(\/anevod\/\d+\.html)"/.exec(block);
    if (!hm) continue;
    const vid = hm[1].replace(/^\/+|\/+$/g, "");
    if (seen[vid]) continue;
    const tm = /title="([^"]+)"/.exec(block);
    if (!tm) continue;
    let pm = /data-original="([^"]+)"/.exec(block);
    if (!pm) pm = /<img[^>]+src="([^"]+)"/.exec(block);
    const rm = /pic-text[^>]*>([^<]+)</.exec(block);
    let pic = pm ? absUrl(pm[1]) : "";
    if (pic.indexOf("load.gif") >= 0 || pic.indexOf("placeholder") >= 0) pic = "";
    if (!pic) continue;
    seen[vid] = true;
    vods.push({
      id: vid,
      title: clean(tm[1]),
      cover: pic,
      remarks: rm ? clean(rm[1]) : "",
      tags: [],
    });
  }
  return vods;
}

function categories() {
  return CATS.map(c => ({ id: c.id, name: c.name }));
}

async function home() {
  let items = [];
  try {
    const html = await fetchHtml(HOST + "/");
    items = parseCards(html).slice(0, 30);
  } catch (e) { items = []; }
  return { categories: categories(), items: items, hasMore: items.length > 0 };
}

function pagecount(html, cur) {
  const re = /\/anelist\/\d+-(\d+)\.html/g;
  let m, mx = 0;
  while ((m = re.exec(str(html))) !== null) {
    const n = parseInt(m[1], 10);
    if (isFinite(n) && n > mx) mx = n;
  }
  return mx ? Math.max(mx, cur) : cur;
}

async function category(arg) {
  const pg = Math.max(1, intValue(arg && arg.page, 1));
  const tid = str(arg && arg.id).trim();
  if (!tid) return { items: [], hasMore: false };
  let vods = [], total = pg;
  try {
    const url = HOST + "/anelist/" + tid + "-" + pg + ".html";
    const html = await fetchHtml(url);
    vods = parseCards(html);
    total = pagecount(html, pg);
  } catch (e) { vods = []; total = pg; }
  return { items: vods, hasMore: pg < total };
}

// 原 py _search_cards：<li class="active..."> + searchkey + data-original + pic-text
function parseSearchCards(html) {
  const vods = [];
  const seen = {};
  const liRe = /<li class="active[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(str(html))) !== null) {
    const block = m[1];
    const hm = /href="(\/anevod\/\d+\.html)"/.exec(block);
    if (!hm) continue;
    const vid = hm[1].replace(/^\/+|\/+$/g, "");
    if (seen[vid]) continue;
    const sm = /class="searchkey">([^<]+)</.exec(block);
    if (!sm) continue;
    const pm = /data-original="([^"]+)"/.exec(block);
    const rm = /pic-text[^>]*>([^<]+)</.exec(block);
    const pic = pm ? absUrl(pm[1]) : "";
    if (!pic) continue;
    seen[vid] = true;
    vods.push({
      id: vid,
      title: clean(sm[1]),
      cover: pic,
      remarks: rm ? clean(rm[1]) : "",
      tags: [],
    });
  }
  return vods;
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) return { items: [], hasMore: false };
  let vods = [];
  try {
    const url = HOST + "/search.php?searchword=" + encodeURIComponent(keyword);
    const html = await fetchHtml(url);
    vods = parseSearchCards(html);
  } catch (e) { vods = []; }
  return { items: vods, hasMore: false };
}

async function detail(arg) {
  let vid = str(arg && arg.id);
  if (vid.indexOf(",") >= 0) vid = vid.split(",")[0];
  vid = vid.replace(/^\/+|\/+$/g, "");
  const url = HOST + "/" + vid;
  const html = await fetchHtml(url);

  const tm = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = tm ? clean(tm[1].replace(/<span[^>]*>[\s\S]*?<\/span>/g, "")) : vid;
  let pm = /property="og:image" content="([^"]+)"/.exec(html);
  if (!pm) pm = /data-original="([^"]+)"/.exec(html);
  const pic = pm ? absUrl(pm[1]) : "";

  let dm = /剧情简介<\/h3>.{0,400}?<p[^>]*>([^<]{10,})<\/p>/i.exec(html);
  if (!dm) dm = /剧情简介[：:\s]*([^<]{10,})/.exec(html);
  if (!dm) dm = /sketch content">([\s\S]*?)<\/span>/i.exec(html);
  if (!dm) dm = /剧情简介[：:]\s*([\s\S]*?)<\//i.exec(html);
  const desc = dm ? clean(dm[1]) : "";

  let info = "";
  const im = /class="[^"]*(?:stui|myui)-content__detail[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(html);
  if (im) info = clean(im[1]);
  if (!info) {
    let flat = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    flat = flat.replace(/<style[\s\S]*?<\/style>/gi, "");
    flat = flat.replace(/<head[\s\S]*?<\/head>/gi, "");
    info = clean(flat);
  }
  let actor = "";
  const am = /主演[：:]\s*([^导年地类状集]+)/.exec(info);
  if (am) actor = am[1].trim();
  let director = "";
  const dm2 = /导演[：:]\s*([^\s]{1,30})/.exec(info);
  if (dm2) director = dm2[1].trim();
  let year = "";
  let ym = /年份[：:]\s*(19\d{2}|20\d{2})/.exec(info);
  if (!ym) ym = /(19\d{2}|20\d{2})/.exec(info);
  if (ym) year = ym[1];
  let area = "";
  const arm = /地区[：:]\s*([^年主导类型状更\s\/]{1,12})/.exec(info);
  if (arm) area = arm[1].trim();

  // 线路：<h3 class="title">名</h3> ... <ul ...myui-content__list...>分集</ul>
  const pairs = [];
  const pairRe = /<h3 class="title">([\s\S]*?)<\/h3>[\s\S]*?<ul[^>]*myui-content__list[^>]*>([\s\S]*?)<\/ul>/gi;
  let pmatch;
  while ((pmatch = pairRe.exec(html)) !== null) pairs.push([pmatch[1], pmatch[2]]);
  if (!pairs.length) {
    const ulRe = /<ul[^>]*myui-content__list[^>]*>([\s\S]*?)<\/ul>/gi;
    let um;
    while ((um = ulRe.exec(html)) !== null) pairs.push(["", um[1]]);
  }
  const lines = [];
  for (let idx = 0; idx < pairs.length; idx++) {
    const lname = pairs[idx][0], block = pairs[idx][1];
    const eps = [];
    const seen = {};
    const aRe = /href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let am2;
    while ((am2 = aRe.exec(block)) !== null) {
      const href = am2[1].trim();
      let isPan = false;
      for (const d of PAN_HOSTS) if (href.indexOf(d) >= 0) { isPan = true; break; }
      if (isPan) continue;
      if (!href || href.indexOf("javascript") === 0 || seen[href] || href.indexOf("heji") >= 0) continue;
      seen[href] = true;
      const nm = clean(am2[2]);
      if (!nm) continue;
      eps.push({ id: absUrl(href), name: nm });
    }
    if (!eps.length) continue;
    const nm = clean(lname);
    lines.push({ name: nm ? nm : ("线路" + (idx + 1)), episodes: eps });
  }
  if (!lines.length) {
    lines.push({ name: "线路1", episodes: [{ id: url, name: "正片" }] });
  }

  const tags = [];
  if (year) tags.push(year);
  if (area) tags.push(area);
  if (actor) tags.push(actor);
  if (director) tags.push("导演：" + director);
  return {
    id: vid,
    title: title,
    cover: pic,
    desc: desc,
    tags: tags,
    remarks: "",
    lines: lines,
  };
}

// 原 py _extract_stream 的完整移植
function extractStream(html) {
  if (!html) return "";
  let m = /var player_aaaa\s*=\s*(\{[\s\S]*?\})/.exec(html);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const u = str(data.url || "");
      if (u.indexOf(".m3u8") >= 0 || u.indexOf(".mp4") >= 0) return u;
    } catch (e) { /* 继续往下找 */ }
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
    } catch (e) { /* 继续往下找 */ }
  }
  const ifRe = /<iframe[^>]+src="([^"]+)"/g;
  let im;
  while ((im = ifRe.exec(html)) !== null) {
    const src = im[1];
    const qi = src.indexOf("?");
    if (qi < 0) continue;
    const pairs = src.slice(qi + 1).split("&");
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const k = pair.slice(0, eq), v = pair.slice(eq + 1);
      if (["url", "u", "play", "src"].indexOf(k) < 0) continue;
      let dec = "";
      try { dec = host.codec.base64Decode(v); } catch (e) { dec = ""; }
      if (dec.indexOf("http") === 0 && (dec.indexOf(".m3u8") >= 0 || dec.indexOf(".mp4") >= 0)) return dec;
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
  let raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
  if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
  const page = raw.indexOf("http") === 0 ? raw : absUrl(raw);
  let url = "";
  if (raw.indexOf(".m3u8") >= 0 || raw.indexOf(".mp4") >= 0) {
    url = raw;
  } else {
    const html = await fetchHtml(page);
    url = extractStream(html);
    if (!url) {
      const im = /<iframe[^>]+src="([^"]+)"/.exec(html);
      if (im) {
        const src = absUrl(im[1]);
        try {
          const html2 = await fetchHtml(src, page);
          url = extractStream(html2);
        } catch (e) { url = ""; }
      }
    }
  }
  if (!url) throw new Error("未提取到播放地址");
  if (url.indexOf("https://") !== 0 && url.indexOf("http://") === 0) {
    // 宿主 play 只收 https；http 直链尝试升 https（同 py 直出逻辑之外的宿主适配）
    url = "https://" + url.slice("http://".length);
  }
  const isHls = /\.m3u8($|\?)/i.test(url);
  if (isHls) {
    // master 主清单先在插件内解析到子清单，避免播放器多跳超时
    try {
      const resp = await host.http.get(url, {
        headers: { "User-Agent": UA, "Referer": page },
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
      headers: { "User-Agent": UA, "Referer": page },
      name: "咕咚影院",
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home, category, search, detail, play };
