// 女优库在线 — idj1 插件（由内置 py 蜘蛛 nvku 改写）
// 站点：https://nvku-8m2c.web.zaka.live，纯静态女优库镜像（32.2 万条），无登录、无盾。
// 数据形态与原 py 完全一致：
//   meta.js          window.META={total,cats:[{id,name,n,shards}],an:[女优名],ac:[作品数]}
//   d/new.js         window.SH("new",[记录…])   最新上架
//   d/c<分类>_<段>.js  window.SH("c0_0",[记录…])  每段 5000 条
// 一条记录：[番号, hash, 标题, 年份(两位), 女优索引csv, 有无封面]
//   封面 https://v.hersav.me/images/av/<hash>.jpg
//   播放 https://v.hersav.me/<hash>/<hash>.m3u8（标准 HLS，分片是伪装成 .jpeg 的 MPEG-TS）
// 分类与原 py 完全一致：最新上架 + meta.cats（有码/无码/4K/其它），分类名带实时条数。
// 翻页与原 py 一致：页码换算成「第几段 + 段内偏移」，跨段自动接上，一页 60 条。
// 搜索：原 py 的番号二进制索引（idx.bin.gz）走的是二进制响应体，插件宿主 http 只回
// 字符串、二进制索引无法在沙箱内还原，故搜索照原 py 自带的兜底路径——分段扫描
// （顺序 new→各分类段、上限 12 段、命中 60 条即停、番号/标题/女优名三路匹配）。
// 详情：原 py 靠进程内记录缓存，插件运行时每次调用都是新环境，故改用 host.storage
// 存列表/搜索时见过的记录（按 hash 键），命中即出完整详情；未命中照原 py 兜底：
// 有番号用番号当标题，绝不拿 hash 顶标题，播放地址照常由 hash 直拼。

const BASE = "https://nvku-8m2c.web.zaka.live";
const MEDIA = "https://v.hersav.me";
const KEY = "nvku";
const UA = "Mozilla/5.0 (Linux; Android 13; PGT-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const TIMEOUT = 60000;
const ATTEMPTS = 3;
const PAGE_SIZE = 60;
const SHARD_SIZE = 5000;
const SEARCH_SHARD_CAP = 12;
const SEARCH_HIT_STOP = 60;
const REC_STORE_KEY = "recs";
const REC_STORE_MAX = 400;

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }
function isHash(s) { return /^[0-9a-fA-F]{16,64}$/.test(str(s).trim()); }

async function httpText(url) {
  let lastErr = null;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const resp = await host.http.get(url, {
        headers: {
          "User-Agent": UA,
          "Accept": "*/*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "Referer": BASE + "/",
        },
        timeout: TIMEOUT,
      });
      if (resp.status === 200 || resp.status === 206) return resp.body || "";
      lastErr = new Error("HTTP " + resp.status);
      if (resp.status === 404) return "";
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return "";
}

// ---- meta / shard（与原 py meta()/shard() 同口径，取不到降级不崩） ----

let _metaCache = null;
async function getMeta() {
  if (_metaCache) return _metaCache;
  let data = {};
  try {
    const raw = await httpText(BASE + "/meta.js");
    const i = raw.indexOf("{");
    const j = raw.lastIndexOf("}");
    if (i >= 0 && j > i) {
      const parsed = JSON.parse(raw.slice(i, j + 1));
      if (parsed && typeof parsed === "object") data = parsed;
    }
  } catch (e) { data = {}; }
  _metaCache = data;
  return data;
}

const _shardCache = {};
async function getShard(key) {
  if (Object.prototype.hasOwnProperty.call(_shardCache, key)) return _shardCache[key];
  let rows = [];
  try {
    const raw = await httpText(BASE + "/d/" + key + ".js");
    const m = /window\.SH\(\s*"([^"]+)"\s*,\s*(\[[\s\S]*\])\s*\)/.exec(raw);
    if (m) {
      try {
        const parsed = JSON.parse(m[2]);
        if (Array.isArray(parsed)) rows = parsed;
      } catch (e) { rows = []; }
    }
  } catch (e) { rows = []; }
  _shardCache[key] = rows;
  return rows;
}

// ---- 分类（与原 py _cats()/_cat_index() 一致） ----

async function getCats() {
  const m = await getMeta();
  const out = [["new", "最新上架", 1, 0]];
  const cats = Array.isArray(m.cats) ? m.cats : [];
  for (const cat of cats) {
    if (!cat || typeof cat !== "object") continue;
    const cid = parseInt(cat.id, 10);
    if (!isFinite(cid)) continue;
    const name = str(cat.name || "").trim() || ("分类" + cid);
    const shards = Array.isArray(cat.shards) ? cat.shards : [];
    const count = intValue(cat.n, 0);
    out.push(["c" + cid, name, Math.max(1, shards.length), count]);
  }
  return out;
}

async function catIndex(tid) {
  const t = str(tid || "").trim();
  if (!t || t === "new") return ["new", 1, 0];
  const cats = await getCats();
  for (const c of cats) if (c[0] === t) return [c[0], c[2], c[3]];
  return ["new", 1, 0];
}

function shardKey(cid, index) { return cid === "new" ? "new" : cid + "_" + index; }

async function rowsForPage(cid, shards, pg) {
  const start = (pg - 1) * PAGE_SIZE;
  const out = [];
  let idx = Math.floor(start / SHARD_SIZE);
  let off = start % SHARD_SIZE;
  let guard = 0;
  while (out.length < PAGE_SIZE && idx < shards && guard < 4) {
    guard += 1;
    const rows = await getShard(shardKey(cid, idx));
    if (!rows.length) break;
    const need = PAGE_SIZE - out.length;
    for (let k = off; k < rows.length && k < off + need; k++) out.push(rows[k]);
    idx += 1;
    off = 0;
  }
  return out;
}

// ---- 记录字段（与原 py _code_of/_hash_of/_title_of/_year_of/_has_img/_actor_names 一致） ----

function codeOf(rec) { return Array.isArray(rec) && rec.length > 0 ? str(rec[0] || "").trim() : ""; }
function hashOf(rec) {
  const h = Array.isArray(rec) && rec.length > 1 ? str(rec[1] || "").trim() : "";
  return isHash(h) ? h : "";
}
function titleOf(rec) {
  const t = Array.isArray(rec) && rec.length > 2 ? str(rec[2] || "").trim() : "";
  return t || codeOf(rec);
}
function yearOf(rec) {
  const raw = Array.isArray(rec) && rec.length > 3 ? str(rec[3] || "").trim() : "";
  return /^\d{2}$/.test(raw) ? "20" + raw : raw;
}
function hasImg(rec) {
  if (!Array.isArray(rec) || rec.length <= 5) return false;
  const n = parseInt(rec[5], 10);
  return isFinite(n) ? !!n : !!rec[5];
}
function actorNames(rec, meta) {
  if (!Array.isArray(rec) || rec.length <= 4) return "";
  const raw = str(rec[4] || "").trim();
  if (!raw) return "";
  const names = meta && Array.isArray(meta.an) ? meta.an : [];
  const out = [];
  for (const piece of raw.split(",")) {
    const p = piece.trim();
    if (!p) continue;
    const i = parseInt(p, 10);
    if (!isFinite(i) || i < 0 || i >= names.length) continue;
    const name = str(names[i] || "").trim();
    if (name && out.indexOf(name) < 0) out.push(name);
    if (out.length >= 6) break;
  }
  return out.join(",");
}

function playUrl(h) { return MEDIA + "/" + h + "/" + h + ".m3u8"; }
function coverUrl(h) { return MEDIA + "/images/av/" + h + ".jpg"; }
function vodId(rec) {
  const code = codeOf(rec), h = hashOf(rec);
  return code ? ("nvku:" + code + ":" + h) : ("nvku:" + h);
}

// ---- 记录存取（代原 py 进程内 _REC_CACHE，落 host.storage） ----

function loadRecStore() {
  try {
    const raw = host.storage.get(REC_STORE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) { return {}; }
}
function saveRecStore(store) {
  try {
    const keys = Object.keys(store);
    if (keys.length > REC_STORE_MAX) {
      const drop = keys.slice(0, keys.length - REC_STORE_MAX);
      for (const k of drop) delete store[k];
    }
    host.storage.set(REC_STORE_KEY, JSON.stringify(store));
  } catch (e) { /* 存不下不影响本次列表返回 */ }
}
function remember(rec, meta) {
  const h = hashOf(rec);
  if (!h) return;
  const store = loadRecStore();
  store[h] = [codeOf(rec), titleOf(rec), yearOf(rec), actorNames(rec, meta), hasImg(rec) ? 1 : 0];
  saveRecStore(store);
}

function toItem(rec, meta) {
  const h = hashOf(rec);
  if (!h) return null;
  const code = codeOf(rec);
  const year = yearOf(rec);
  const remarks = [code, year].filter(x => x).join(" ");
  const item = { id: vodId(rec), title: titleOf(rec), remarks: remarks, tags: [] };
  if (hasImg(rec)) item.cover = coverUrl(h);
  return item;
}
function toItems(rows, meta) {
  const out = [];
  for (const rec of rows) {
    if (!Array.isArray(rec)) continue;
    const item = toItem(rec, meta);
    if (!item) continue;
    remember(rec, meta);
    out.push(item);
  }
  return out;
}

// ---- 接口 ----

async function home() {
  const results = await Promise.all([getCats(), getMeta(), getShard("new")]);
  const cats = results[0], meta = results[1];
  const categories = [];
  for (const c of cats) {
    categories.push({ id: c[0], name: c[3] ? (c[1] + " · " + c[3]) : c[1] });
  }
  const items = toItems(results[2].slice(0, PAGE_SIZE), meta);
  return { categories: categories, items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const pg = Math.max(1, intValue(arg && arg.page, 1));
  const ci = await catIndex(arg && arg.id);
  const cid = ci[0], shards = ci[1], count = ci[2];
  const meta = await getMeta();
  const rows = await rowsForPage(cid, shards, pg);
  const items = toItems(rows, meta);
  let hasMore;
  if (cid === "new" || count <= 0) hasMore = items.length >= PAGE_SIZE;
  else hasMore = pg * PAGE_SIZE < count;
  return { items: items, hasMore: hasMore };
}

function codeLike(kw) {
  const tight = str(kw || "").replace(/[\s_-]/g, "");
  return /^[a-z0-9]{4,16}$/.test(tight) && /[a-z]/.test(tight) && /\d/.test(tight) && /[a-z]{2,}/.test(tight);
}

async function search(arg) {
  const pg = Math.max(1, intValue(arg && arg.page, 1));
  const kw = str(arg && arg.keyword).trim().toLowerCase();
  if (!kw) return { items: [], hasMore: false };
  const kwTight = kw.replace(/[-_ ]/g, "");
  const meta = await getMeta();
  const cats = await getCats();
  const order = cats.filter(c => c[0] === "new").concat(cats.filter(c => c[0] !== "new"));
  const jobs = [];
  for (const c of order) for (let i = 0; i < c[2]; i++) jobs.push(shardKey(c[0], i));
  const capped = jobs.slice(0, SEARCH_SHARD_CAP);
  const hits = [];
  const seen = {};
  // 与原 py ThreadPoolExecutor(max_workers=4) 同口径：4 段一批并发扫，够数即停
  for (let b = 0; b < capped.length && hits.length < SEARCH_HIT_STOP; b += 4) {
    const batch = capped.slice(b, b + 4);
    const batchRows = await Promise.all(batch.map(k => getShard(k)));
    for (const rows of batchRows) {
      for (const rec of rows) {
        if (!Array.isArray(rec)) continue;
        const code = codeOf(rec).toLowerCase();
        const title = titleOf(rec).toLowerCase();
        const actors = actorNames(rec, meta).toLowerCase();
        const tight = code.replace(/[-_ ]/g, "");
        if ((kw && (code.indexOf(kw) >= 0 || title.indexOf(kw) >= 0 || actors.indexOf(kw) >= 0)) ||
            (kwTight && (tight.indexOf(kwTight) >= 0 || title.replace(/ /g, "").indexOf(kwTight) >= 0))) {
          const h = hashOf(rec);
          if (!h || seen[h]) continue;
          seen[h] = true;
          hits.push(rec);
          if (hits.length >= SEARCH_HIT_STOP) break;
        }
      }
      if (hits.length >= SEARCH_HIT_STOP) break;
    }
  }
  const items = toItems(hits, meta);
  const start = (pg - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);
  return { items: pageItems, hasMore: pg * PAGE_SIZE < items.length };
}

async function detail(arg) {
  let key = str(arg && arg.id).trim();
  if (key.indexOf("nvku:") === 0) key = key.slice(5);
  if (!key) throw host.error("E_PARSE", "无效的影片 ID");
  let code = "", h = "";
  if (key.indexOf(":") >= 0) {
    const parts = key.split(":");
    code = parts[0].trim();
    h = parts[parts.length - 1].trim();
  } else if (isHash(key)) {
    h = key;
  }
  if (!h || !isHash(h)) throw host.error("E_PARSE", "无效的影片 ID");
  const store = loadRecStore();
  const saved = store[h];
  let title, remarks, desc, cover;
  if (Array.isArray(saved)) {
    code = str(saved[0] || code || "");
    title = str(saved[1] || "") || code || "高清视频";
    const year = str(saved[2] || "");
    const actors = str(saved[3] || "");
    remarks = [code, year].filter(x => x).join(" ") || code || "高清";
    cover = coverUrl(h);
    const parts = [];
    if (code) parts.push(code);
    parts.push(title);
    if (actors) parts.push("演员：" + actors.split(",").join("、"));
    if (year) parts.push("年份：" + year);
    desc = parts.join("\n");
  } else {
    // 与原 py 兜底一致：记录捞不回来时标题用番号，绝不拿 hash 顶上
    title = code || "高清视频";
    remarks = code || "高清";
    desc = code || "nvku";
    cover = coverUrl(h);
  }
  const id = code ? ("nvku:" + code + ":" + h) : ("nvku:" + h);
  return {
    id: id,
    title: title,
    cover: cover,
    desc: desc,
    tags: [],
    lines: [{ name: KEY, episodes: [{ id: id, name: "正片" }] }],
  };
}

async function play(arg) {
  let raw = str((arg && arg.episodeId) || (arg && arg.id) || "").trim();
  if (raw.indexOf("$") >= 0) raw = raw.split("$").pop().trim();
  if (raw.indexOf("nvku:") === 0) raw = raw.slice(5);
  if (raw.indexOf(":") >= 0) raw = raw.split(":").pop().trim();
  let url = "";
  if (raw.indexOf("http") === 0) url = raw;
  else if (isHash(raw)) url = playUrl(raw);
  if (!url) throw host.error("E_PARSE", "无效的播放 ID");
  return {
    streams: [{
      url: url,
      format: "hls",
      headers: { "User-Agent": UA, "Referer": MEDIA + "/" },
      name: KEY,
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home, category, search, detail, play };
