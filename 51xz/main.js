// 51X — idj1 插件（由内置 py 蜘蛛 51xz 改写）
// 站点：https://51xz.vip，Next.js 站，列表/详情数据在页面 self.__next_f 推送的
// RSC 流里（{"id":" 开头的 video/drama/post 对象），与原 py 同一套提取逻辑。
// 播放：对象自带 hlsUrl 直链（datashubcenter CDN），play() 原样返回，
// 若是 master 主清单则先解析到子清单再返回。

const BASE = "https://51xz.vip";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const TIMEOUT = 60000;

// 与原 py 完全一致的 21 个分类（type_id 即分类名本身）
const CATS = [
  "x视频", "真实自拍", "网红女神", "国产精品", "爱好男同-1",
  "短剧", "成年短剧", "情感剧场", "古装历史", "年代农村", "穿越重生",
  "x吃瓜", "今日吃瓜", "海外吃瓜", "娱乐吃瓜", "网红黑料",
  "x-av", "日本无码", "国产av", "欧美av", "动漫av",
];
// 原 py 的 post 聚合分类：站内分页里混着无视频的图文帖，
// 先把 1..8 页里带 hlsUrl 的帖子聚齐，再按每页 24 条本地分页。
const POST_MODULES = { "x吃瓜": true, "今日吃瓜": true, "海外吃瓜": true, "娱乐吃瓜": true, "网红黑料": true };

const ocache = {}; // id -> 对象（原 py 的 _ocache，详情优先用缓存）
const pcache = {}; // 分类名 -> 聚合后的卡片数组（原 py 的 _pcache）

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

async function httpGet(url) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await host.http.get(url, {
        headers: { "User-Agent": UA, "Referer": BASE + "/", "Accept": "text/html,*/*" },
        timeout: TIMEOUT,
      });
      if (resp.status === 200 && resp.body) return resp.body;
      lastErr = new Error("HTTP " + resp.status);
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return "";
}

// ---- 原 py _objects 的移植：解出 __next_f 块后扫描 {"id":" 对象 ----
function extractChunks(page) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/gs;
  let m;
  while ((m = re.exec(page)) !== null) {
    try { chunks.push(JSON.parse(m[1])); } catch (e) { /* 坏块跳过 */ }
  }
  return chunks;
}

function balancedSlice(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function parseObjects(page) {
  const chunks = extractChunks(page);
  const text = chunks.length ? chunks.join("\n") : str(page).replace(/\\"/g, '"');
  const objs = [];
  const seen = {};
  let idx = 0;
  while (true) {
    const p = text.indexOf('{"id":"', idx);
    if (p < 0) break;
    idx = p + 1;
    const slice = balancedSlice(text, p);
    if (!slice) continue;
    let obj = null;
    try { obj = JSON.parse(slice); } catch (e) { continue; }
    if (!obj || typeof obj !== "object" || !("id" in obj)) continue;
    let kind = null;
    if (obj.cardKind === "video") kind = "video";
    else if (obj.kind === "drama") kind = "drama";
    else if (obj.kind === "post") kind = "post";
    if (!kind) continue;
    const key = kind + ":" + obj.id;
    if (seen[key]) continue;
    seen[key] = true;
    obj._kind = kind;
    objs.push(obj);
  }
  return objs;
}

function dur(sec) {
  const s = parseInt(parseFloat(sec), 10);
  if (!isFinite(s)) return "";
  const p2 = (n) => (n < 10 ? "0" + n : "" + n);
  if (s >= 3600) return Math.floor(s / 3600) + ":" + p2(Math.floor((s % 3600) / 60)) + ":" + p2(s % 60);
  return Math.floor(s / 60) + ":" + p2(s % 60);
}

function pic(url) {
  let u = str(url);
  if (!u) return "";
  if (u.indexOf("//") === 0) u = "https:" + u;
  return u;
}

function toCard(obj) {
  ocache[obj.id] = obj;
  const kind = obj._kind;
  const path = "/" + kind + "/" + obj.id + "/" + (obj.slug || "");
  let remarks = "";
  if (kind === "video") remarks = dur(obj.duration);
  else if (kind === "drama") {
    const cnt = obj.episodeCount || obj.currentEpisode || "";
    remarks = cnt ? ("全 " + cnt + " 集") : "短剧";
  } else {
    remarks = obj.hlsUrl ? "有视频" : "图文";
  }
  return {
    id: path,
    title: str(obj.titleZh || obj.titleEn || path).trim(),
    cover: pic(obj.coverUrl || ""),
    remarks: remarks,
    duration: kind === "video" ? remarks : "",
    tags: [],
  };
}

async function moduleList(name, pg) {
  let url = BASE + "/m/" + encodeURIComponent(name);
  if (pg > 1) url += "?page=" + pg;
  const page = await httpGet(url);
  return parseObjects(page).map(toCard);
}

async function postAgg(name, pg) {
  if (!pcache[name]) {
    const cards = [];
    const seen = {};
    for (let sp = 1; sp <= 8; sp++) {
      let objs;
      try {
        const url = BASE + "/m/" + encodeURIComponent(name) + (sp > 1 ? "?page=" + sp : "");
        objs = parseObjects(await httpGet(url)).filter(o => o._kind === "post");
      } catch (e) { break; }
      for (const o of objs) {
        if (o.hlsUrl && !seen[o.id]) { seen[o.id] = true; cards.push(toCard(o)); }
      }
      if (objs.length < 24) break;
    }
    pcache[name] = cards;
  }
  const all = pcache[name];
  return { items: all.slice((pg - 1) * 24, pg * 24), pagecount: Math.max(1, Math.ceil(all.length / 24)) };
}

function categories() {
  return CATS.map(n => ({ id: n, name: n }));
}

async function home() {
  let items = [];
  try {
    const page = await httpGet(BASE + "/");
    items = parseObjects(page).filter(o => o._kind === "video").slice(0, 24).map(toCard);
  } catch (e) { items = []; }
  return { categories: categories(), items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const page = Math.max(1, intValue(arg && arg.page, 1));
  const tid = str(arg && arg.id).trim();
  if (!tid) return { items: [], hasMore: false };
  if (POST_MODULES[tid]) {
    const r = await postAgg(tid, page);
    return { items: r.items, hasMore: page < r.pagecount };
  }
  let items = [];
  try { items = await moduleList(tid, page); } catch (e) { items = []; }
  return { items: items, hasMore: items.length >= 24 };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) return { items: [], hasMore: false };
  let items = [];
  try {
    const page = await httpGet(BASE + "/search?q=" + encodeURIComponent(keyword).replace(/%20/g, "+"));
    items = parseObjects(page).map(toCard);
  } catch (e) { items = []; }
  return { items: items, hasMore: false };
}

function findObj(page, vid) {
  const parts = vid.split("/");
  const target = (vid.charAt(0) === "/" && parts.length > 2) ? parts[2] : "";
  const objs = parseObjects(page);
  for (const o of objs) if (o.id === target) return o;
  return objs.length ? objs[0] : null;
}

async function detail(arg) {
  let vid = str(arg && arg.id);
  if (vid.indexOf(",") >= 0) vid = vid.split(",")[0];
  const parts = vid.split("/");
  const target = (vid.charAt(0) === "/" && parts.length > 2) ? parts[2] : "";
  let obj = target ? ocache[target] : null;
  if (obj && obj._kind === "drama" && !(obj.episodes && obj.episodes.length)) obj = null;
  if (!obj) {
    const url = vid.charAt(0) === "/" ? BASE + vid : BASE + "/" + vid;
    const page = await httpGet(url);
    obj = findObj(page, vid);
  }
  if (!obj) return { id: vid, title: vid, cover: "", desc: "", tags: [], lines: [] };
  const kind = obj._kind;
  const creator = obj.creator || {};
  const categoryObj = obj.category || {};
  const tags = [];
  for (const t of (obj.tags || [])) if (t && t.nameZh) tags.push(t.nameZh);
  if (categoryObj.nameZh && tags.indexOf(categoryObj.nameZh) < 0) tags.push(categoryObj.nameZh);
  const episodes = [];
  let remarks = "";
  if (kind === "video") {
    remarks = dur(obj.duration);
    if (obj.hlsUrl) episodes.push({ id: obj.hlsUrl, name: "正片" });
  } else if (kind === "drama") {
    const eps = (obj.episodes || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
    for (const e of eps) {
      if (e && e.hlsUrl) episodes.push({ id: e.hlsUrl, name: "第" + (e.sort || (episodes.length + 1)) + "集" });
    }
    const cnt = obj.episodeCount || episodes.length;
    remarks = "全 " + cnt + " 集";
  } else {
    remarks = obj.hlsUrl ? "有视频" : "图文帖";
    if (obj.hlsUrl) episodes.push({ id: obj.hlsUrl, name: "视频" });
  }
  return {
    id: vid,
    title: str(obj.titleZh || obj.titleEn || vid).trim(),
    cover: pic(obj.coverUrl || ""),
    desc: str(obj.descriptionZh || obj.seoDescription || "").slice(0, 600),
    tags: tags,
    remarks: remarks,
    lines: episodes.length ? [{ name: "51X", episodes: episodes }] : [],
  };
}

async function play(arg) {
  let raw = str((arg && arg.episodeId) || (arg && arg.id));
  if (raw.indexOf("$") >= 0) raw = raw.split("$")[1] || raw;
  let url = raw;
  if (!/^https?:\/\//i.test(url)) {
    // 兜底：给的是详情路径时，先取详情里的第一个播放地址
    const det = await detail({ id: raw });
    const line0 = (det.lines || [])[0];
    const ep0 = line0 && (line0.episodes || [])[0];
    if (!ep0) throw new Error("未找到播放地址");
    url = ep0.id;
  }
  const isHls = /\.m3u8($|\?)/i.test(url);
  if (isHls) {
    // master 主清单先在插件内解析到子清单，避免播放器多跳超时
    try {
      const resp = await host.http.get(url, {
        headers: { "User-Agent": UA, "Referer": BASE + "/" },
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
      headers: { "User-Agent": UA, "Referer": BASE + "/" },
      name: "51X",
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home, category, search, detail, play };
