// 奥斯卡资源 — idj1 插件（由内置 py 蜘蛛 aosikazy 改写）
// 站点：https://aosikazy1.com，MacCMS 资源接口站（api.php/provide/vod/at/json，
// JSON 取不到时回退同参数 XML 接口），与原 py 完全同一套取数与解析逻辑。
// 分类由接口 class 动态下发，过滤照搬原 py：剔除 type_id=40，
// 且分类名含 游戏/棋牌/博彩/彩票/赌 任一词的剔除（原 py 无写死分类表）。
// 列表接口不带封面：原 py 的 _enrich 照搬——无封面的条目批量走 detail 补封面/备注。
// 播放：detail 的 vod_play_url 即 m3u8 直链，playerContent 原样直出（parse=0）。
// 无登录、无付费墙、无 Cookie 依赖（仅 UA+Referer，宿主不剥）。
// 本机出口慢（单请求常 30 秒上下）：超时 60 秒、失败重试 3 次（对齐原 py）。

const BASE = "https://aosikazy1.com";
const API_JSON = BASE + "/api.php/provide/vod/at/json";
const API_XML = BASE + "/api.php/provide/vod/at/xml";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT = 60000;

const EXCLUDED_IDS = ["40"];
const DROP_WORDS = ["游戏", "棋牌", "博彩", "彩票", "赌"];

function str(v) { return v == null ? "" : String(v); }
function intVal(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }
function trim(v) { return str(v).trim(); }

// ---------- HTTP（原 py _http_get：3 次重试，200/206 即取正文） ----------

async function httpGet(url) {
  const headers = {
    "User-Agent": UA,
    "Accept": "application/json,text/xml,text/html,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": BASE + "/",
  };
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await host.http.get(url, { headers: headers, timeout: TIMEOUT });
      if (resp && (resp.status === 200 || resp.status === 206) && resp.body) {
        return String(resp.body);
      }
    } catch (e) {
      // 超时/网络抖动：换连接重试（对齐原 py）
    }
  }
  return "";
}

function buildQs(params) {
  const parts = [];
  for (const k of Object.keys(params)) {
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(str(params[k])));
  }
  return parts.join("&");
}

// ---------- 记录归一化（原 py _norm_json_record / _norm_xml_record） ----------

function normJsonRecord(item) {
  return {
    vod_id: trim(item.vod_id),
    vod_name: trim(item.vod_name),
    vod_pic: trim(item.vod_pic),
    vod_remarks: trim(item.vod_remarks),
    type_id: trim(item.type_id),
    type_name: trim(item.type_name),
    vod_actor: trim(item.vod_actor),
    vod_director: trim(item.vod_director),
    vod_year: trim(item.vod_year),
    vod_area: trim(item.vod_area),
    vod_content: trim(item.vod_content || item.vod_blurb),
    vod_class: trim(item.vod_class),
    vod_play_from: trim(item.vod_play_from),
    vod_play_url: trim(item.vod_play_url),
  };
}

function xmlText(node, tag) {
  const m = new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">").exec(node);
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function normXmlRecord(node) {
  const playFrom = [];
  const playUrl = [];
  const dlM = /<dl>([\s\S]*?)<\/dl>/.exec(node);
  if (dlM) {
    const ddRe = /<dd(?:\s[^>]*)?flag="([^"]*)"[^>]*>([\s\S]*?)<\/dd>/g;
    let dm;
    while ((dm = ddRe.exec(dlM[1])) !== null) {
      playFrom.push(dm[1].trim());
      playUrl.push(dm[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
    }
  }
  return {
    vod_id: xmlText(node, "id"),
    vod_name: xmlText(node, "name"),
    vod_pic: xmlText(node, "pic"),
    vod_remarks: xmlText(node, "note") || xmlText(node, "state"),
    type_id: xmlText(node, "tid"),
    type_name: xmlText(node, "type"),
    vod_actor: xmlText(node, "actor"),
    vod_director: xmlText(node, "director"),
    vod_year: xmlText(node, "year"),
    vod_area: xmlText(node, "area"),
    vod_content: xmlText(node, "des"),
    vod_class: xmlText(node, "type"),
    vod_play_from: playFrom.join("$$$"),
    vod_play_url: playUrl.join("$$$"),
  };
}

function parseJson(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  if (!data || typeof data !== "object" || !("list" in data)) return null;
  const records = (data.list || []).filter(x => x && typeof x === "object").map(normJsonRecord);
  const cats = [];
  for (const item of (data.class || [])) {
    if (!item || typeof item !== "object") continue;
    const tid = trim(item.type_id), name = trim(item.type_name);
    if (tid && name) cats.push([tid, name]);
  }
  return {
    list: records, "class": cats,
    page: intVal(data.page, 1),
    pagecount: intVal(data.pagecount, 0),
    total: intVal(data.total, 0),
  };
}

function parseXml(text) {
  if (!text || text.indexOf("<rss") < 0) return null;
  const cats = [];
  const classM = /<class>([\s\S]*?)<\/class>/.exec(text);
  if (classM) {
    const tyRe = /<ty\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/ty>/g;
    let tm;
    while ((tm = tyRe.exec(classM[1])) !== null) {
      const tid = tm[1].trim(), name = tm[2].trim();
      if (tid && name) cats.push([tid, name]);
    }
  }
  let page = 1, pagecount = 0, total = 0;
  const records = [];
  const listM = /<list([^>]*)>([\s\S]*?)<\/list>/.exec(text);
  if (listM) {
    const attrs = listM[1];
    const pgM = /page="(\d+)"/.exec(attrs); if (pgM) page = parseInt(pgM[1], 10) || 1;
    const pcM = /pagecount="(\d+)"/.exec(attrs); if (pcM) pagecount = parseInt(pcM[1], 10) || 0;
    const rcM = /recordcount="(\d+)"/.exec(attrs); if (rcM) total = parseInt(rcM[1], 10) || 0;
    const vidRe = /<video>([\s\S]*?)<\/video>/g;
    let vm;
    while ((vm = vidRe.exec(listM[2])) !== null) records.push(normXmlRecord(vm[1]));
  }
  return { list: records, "class": cats, page: page, pagecount: pagecount, total: total };
}

// 原 py _fetch：JSON 优先，解析不出或列表与分类都空（detail 除外）时回退 XML
async function fetchApi(params) {
  const qs = buildQs(params);
  const jText = await httpGet(API_JSON + "?" + qs);
  const parsed = jText ? parseJson(jText) : null;
  if (parsed && (parsed.list.length || parsed["class"].length)) return parsed;
  if (parsed && params.ac === "detail") return parsed;
  const xText = await httpGet(API_XML + "?" + qs);
  const xParsed = xText ? parseXml(xText) : null;
  if (xParsed) return xParsed;
  return { list: [], "class": [], page: 1, pagecount: 0, total: 0 };
}

// ---------- 分类过滤（原 py _keep_cat / _classes） ----------

function keepCat(tid, name) {
  if (EXCLUDED_IDS.indexOf(tid) >= 0) return false;
  for (const w of DROP_WORDS) if (name.indexOf(w) >= 0) return false;
  return true;
}

function classes(live) {
  const out = [];
  const seen = {};
  for (const pair of (live || [])) {
    const tid = pair[0], name = pair[1];
    if (seen[tid]) continue;
    if (!keepCat(tid, name)) continue;
    seen[tid] = true;
    out.push({ id: tid, name: name });
  }
  return out;
}

// ---------- 卡片（原 py _card / _cards / _enrich） ----------

function toCard(r) {
  const vid = trim(r.vod_id), name = trim(r.vod_name);
  if (!vid || !name) return null;
  return {
    id: vid,
    title: name,
    cover: trim(r.vod_pic),
    remarks: trim(r.vod_remarks),
    duration: "",
    tags: [],
  };
}

async function enrich(records) {
  const need = records.filter(r => r.vod_id && !r.vod_pic);
  if (!need.length) return records;
  const ids = need.map(r => r.vod_id).join(",");
  const data = await fetchApi({ ac: "detail", ids: ids });
  const byId = {};
  for (const item of (data.list || [])) if (item.vod_id) byId[item.vod_id] = item;
  for (const record of records) {
    const extra = byId[record.vod_id || ""];
    if (!extra) continue;
    if (!record.vod_pic && extra.vod_pic) record.vod_pic = extra.vod_pic;
    if (!record.vod_remarks && extra.vod_remarks) record.vod_remarks = extra.vod_remarks;
  }
  return records;
}

async function cardsOf(records) {
  const enriched = await enrich(records || []);
  const out = [];
  for (const r of enriched) {
    const c = toCard(r);
    if (c) out.push(c);
  }
  return out;
}

function normPg(pg) {
  const n = parseInt(pg, 10);
  return isFinite(n) && n >= 1 ? n : 1;
}

// ---------- idj1 契约 ----------

async function home() {
  const data = await fetchApi({ ac: "list", pg: 1 });
  const cats = classes(data["class"]);
  const items = await cardsOf(data.list);
  return { categories: cats, items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const pg = normPg(arg && arg.page);
  const tid = trim(arg && arg.id);
  const params = { ac: "list", pg: pg };
  if (tid) params.t = tid;
  const data = await fetchApi(params);
  const items = await cardsOf(data.list);
  const pagecount = data.pagecount || 0;
  return { items: items, hasMore: pagecount ? pg < pagecount : items.length > 0 };
}

async function search(arg) {
  const keyword = trim(arg && arg.keyword);
  const pg = normPg(arg && arg.page);
  const data = await fetchApi({ ac: "list", wd: keyword, pg: pg });
  const items = await cardsOf(data.list);
  const pagecount = data.pagecount || 0;
  return { items: items, hasMore: pagecount ? pg < pagecount : false };
}

async function detail(arg) {
  let raw = arg && arg.id;
  if (Array.isArray(raw)) raw = raw.length ? raw[0] : "";
  const vid = trim(raw);
  if (!vid) throw host.error("E_PARSE", "详情 id 为空");
  const data = await fetchApi({ ac: "detail", ids: vid });
  const records = data.list || [];
  if (!records.length) throw host.error("E_PARSE", "详情无数据");
  const record = records[0];
  const name = trim(record.vod_name);
  if (!name) throw host.error("E_PARSE", "详情无标题");

  const froms = str(record.vod_play_from).split("$$$");
  const urls = str(record.vod_play_url).split("$$$");
  const lines = [];
  for (let i = 0; i < urls.length; i++) {
    const group = urls[i];
    if (!group) continue;
    const eps = [];
    const parts = group.split("#");
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j].trim();
      if (!part) continue;
      const di = part.indexOf("$");
      let epName, epUrl;
      if (di >= 0) {
        epName = part.slice(0, di).trim();
        epUrl = part.slice(di + 1).trim();
      } else {
        epName = "";
        epUrl = part;
      }
      if (!epUrl) continue;
      eps.push({ id: epUrl, name: epName || ("第" + (j + 1) + "集") });
    }
    if (!eps.length) continue;
    const lname = (i < froms.length && froms[i].trim()) ? froms[i].trim() : ("线路" + (i + 1));
    lines.push({ name: lname, episodes: eps });
  }

  const tags = [];
  const vc = trim(record.vod_class);
  if (vc) vc.split(/[,，]/).forEach(t => { const s = t.trim(); if (s) tags.push(s); });

  return {
    id: vid,
    title: name,
    cover: trim(record.vod_pic),
    desc: trim(record.vod_content),
    year: trim(record.vod_year),
    area: trim(record.vod_area),
    remarks: trim(record.vod_remarks),
    actor: trim(record.vod_actor),
    director: trim(record.vod_director),
    typeName: trim(record.type_name),
    tags: tags,
    lines: lines,
  };
}

async function play(arg) {
  let raw = trim((arg && arg.episodeId) || (arg && arg.id));
  if (raw.indexOf("$") >= 0) raw = raw.slice(raw.lastIndexOf("$") + 1).trim();
  let url = raw.indexOf("http") === 0 ? raw : "";
  if (!url) throw host.error("E_PARSE", "播放地址为空");
  if (url.indexOf("http://") === 0) url = "https://" + url.slice(7);
  const isHls = url.indexOf(".m3u8") >= 0;
  // 主列表先解析到第一条子列表再返回，播放器少跳一层、避开多跳超时；失败保留主列表。
  if (isHls) {
    try {
      const resp = await host.http.get(url, {
        headers: { "User-Agent": UA, "Referer": BASE + "/" },
        timeout: TIMEOUT,
      });
      const pl = resp && resp.body ? String(resp.body) : "";
      if (pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const ls = pl.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
        if (ls.length) url = host.url.resolve(url, ls[0]);
      }
    } catch (e) {}
  }
  return {
    streams: [{
      url: url,
      format: isHls ? "hls" : "video",
      headers: { "User-Agent": UA, "Referer": BASE + "/" },
      name: "奥斯卡资源",
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home: home, category: category, search: search, detail: detail, play: play };
