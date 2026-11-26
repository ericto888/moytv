// 大奶子资源 — idj1 插件（由内置 py 蜘蛛 danaizizy 改写）
// 站点：https://apidanaizi.com，MacCMS 资源接口站（JSON 主、XML 备）：
// ac=list/detail，分类由接口 class 动态给出，与原 py 同一套过滤：
// DROP_WORDS（游戏/棋牌/博彩/彩票/赌）命中的分类剔除，EXCLUDED_IDS 为空；
// 接口无可用分类时用原 py FALLBACK_CATS（36 个）兜底。
// 列表缺封面时按原 py _enrich 用 detail 批量补封面/备注。播放为 vod_play_url 里的直链（parse=0）。
// 本机出口慢（实测列表约 25 秒）：单请求超时 60 秒、失败重试 3 次（对齐原 py 的 3 次取页）。

const BASE = "https://apidanaizi.com";
const API_JSON = "https://apidanaizi.com/api.php/provide/vod/at/json";
const API_XML = "https://apidanaizi.com/api.php/provide/vod/at/xml";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT = 60000;
const DROP_WORDS = ["游戏", "棋牌", "博彩", "彩票", "赌"];
const EXCLUDED_IDS = [];
const FALLBACK_CATS = [['1', '视频一区'], ['2', '视频二区'], ['3', '视频三区'], ['4', '视频四区'], ['20', '精品推荐'], ['21', '国产主播'], ['22', '国产乱伦'], ['23', '自拍偷拍'], ['24', '制服丝袜'], ['25', '网曝事件'], ['26', '传媒探花'], ['27', '清纯学生'], ['28', 'A V 解说'], ['29', '淫妻作乐'], ['30', '港台辣妹'], ['31', '足浴撩妹'], ['32', '反差母狗'], ['33', 'A I 换脸'], ['34', 'V R 视角'], ['35', '重口性癖'], ['36', '制服诱惑'], ['37', '丝袜美腿'], ['38', '中文字幕'], ['39', '无码流出'], ['40', '多人群交'], ['41', '凌辱快感'], ['42', '角色剧情'], ['43', '强奸乱伦'], ['44', '韩国三级'], ['45', '欧美激情'], ['46', '人妻熟女'], ['47', '主奴调教'], ['48', '动漫卡通'], ['49', '变性伪娘'], ['50', '女同性恋'], ['51', '野外露出']];

function str(v) { return v == null ? "" : String(v); }
function intVal(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

async function httpGet(url) {
  const headers = {
    "User-Agent": UA,
    "Accept": "application/json,text/xml,text/html,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": BASE + "/",
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await host.http.get(url, { headers: headers, timeout: TIMEOUT });
      if (resp && (resp.status === 200 || resp.status === 206) && resp.body) return String(resp.body);
      if (resp && resp.body) return String(resp.body);
    } catch (e) {
      // 超时/网络抖动：换连接重试（对齐原 py）
    }
  }
  return "";
}

function normJsonRecord(item) {
  return {
    vod_id: str(item.vod_id).trim(),
    vod_name: str(item.vod_name).trim(),
    vod_pic: str(item.vod_pic).trim(),
    vod_remarks: str(item.vod_remarks).trim(),
    type_id: str(item.type_id).trim(),
    type_name: str(item.type_name).trim(),
    vod_actor: str(item.vod_actor).trim(),
    vod_director: str(item.vod_director).trim(),
    vod_year: str(item.vod_year).trim(),
    vod_area: str(item.vod_area).trim(),
    vod_content: str(item.vod_content || item.vod_blurb).trim(),
    vod_class: str(item.vod_class).trim(),
    vod_play_from: str(item.vod_play_from).trim(),
    vod_play_url: str(item.vod_play_url).trim(),
  };
}

function parseJson(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  if (!data || typeof data !== "object" || !("list" in data)) return null;
  const records = [];
  const list = Array.isArray(data.list) ? data.list : [];
  for (const item of list) {
    if (item && typeof item === "object") records.push(normJsonRecord(item));
  }
  const cats = [];
  const cls = Array.isArray(data.class) ? data.class : [];
  for (const item of cls) {
    if (item && typeof item === "object") {
      const tid = str(item.type_id).trim();
      const name = str(item.type_name).trim();
      if (tid && name) cats.push([tid, name]);
    }
  }
  return {
    list: records,
    class: cats,
    page: intVal(data.page, 1),
    pagecount: intVal(data.pagecount, 0),
    total: intVal(data.total, 0),
  };
}

// ---- XML 回退解析（对齐原 py _parse_xml / _norm_xml_record）----
function xmlUnescape(t) {
  return str(t)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .trim();
}
function xmlTag(block, tag) {
  const m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">").exec(block);
  return m ? xmlUnescape(m[1]) : "";
}
function parseXml(text) {
  if (!text || !/<rss[\s>]/.test(text)) return null;
  const cats = [];
  const cm = /<class>([\s\S]*?)<\/class>/.exec(text);
  if (cm) {
    const tyRe = /<ty\b([^>]*)>([\s\S]*?)<\/ty>/g;
    let m;
    while ((m = tyRe.exec(cm[1])) !== null) {
      const idm = /\bid="([^"]*)"/.exec(m[1]);
      const tid = idm ? idm[1].trim() : "";
      const name = xmlUnescape(m[2]);
      if (tid && name) cats.push([tid, name]);
    }
  }
  const records = [];
  let page = 1, pagecount = 0, total = 0;
  const lm = /<list\b([^>]*)>([\s\S]*?)<\/list>/.exec(text);
  if (lm) {
    const attrs = lm[1];
    const getA = (k) => { const mm = new RegExp("\\b" + k + '="([^"]*)"').exec(attrs); return mm ? mm[1] : ""; };
    page = intVal(getA("page"), 1);
    pagecount = intVal(getA("pagecount"), 0);
    total = intVal(getA("recordcount"), 0);
    const vRe = /<video>([\s\S]*?)<\/video>/g;
    let vm;
    while ((vm = vRe.exec(lm[2])) !== null) {
      const node = vm[1];
      const playFrom = [], playUrl = [];
      const dlm = /<dl>([\s\S]*?)<\/dl>/.exec(node);
      if (dlm) {
        const ddRe = /<dd\b([^>]*)>([\s\S]*?)<\/dd>/g;
        let dm;
        while ((dm = ddRe.exec(dlm[1])) !== null) {
          const fm = /\bflag="([^"]*)"/.exec(dm[1]);
          playFrom.push(fm ? fm[1].trim() : "");
          playUrl.push(xmlUnescape(dm[2]));
        }
      }
      records.push({
        vod_id: xmlTag(node, "id"),
        vod_name: xmlTag(node, "name"),
        vod_pic: xmlTag(node, "pic"),
        vod_remarks: xmlTag(node, "note") || xmlTag(node, "state"),
        type_id: xmlTag(node, "tid"),
        type_name: xmlTag(node, "type"),
        vod_actor: xmlTag(node, "actor"),
        vod_director: xmlTag(node, "director"),
        vod_year: xmlTag(node, "year"),
        vod_area: xmlTag(node, "area"),
        vod_content: xmlTag(node, "des"),
        vod_class: xmlTag(node, "type"),
        vod_play_from: playFrom.join("$$$"),
        vod_play_url: playUrl.join("$$$"),
      });
    }
  }
  return { list: records, class: cats, page: page, pagecount: pagecount, total: total };
}

function buildQs(params) {
  const parts = [];
  for (const k of Object.keys(params)) {
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(str(params[k])));
  }
  return parts.join("&");
}

// 原 py _fetch：JSON 优先，有 list/class（或 detail 请求）即用；否则 XML 回退
async function fetchApi(params) {
  const qs = buildQs(params);
  const text = await httpGet(API_JSON + "?" + qs);
  const parsed = text ? parseJson(text) : null;
  if (parsed !== null && (parsed.list.length || parsed.class.length)) return parsed;
  if (parsed !== null && params.ac === "detail") return parsed;
  const xtext = await httpGet(API_XML + "?" + qs);
  const xparsed = xtext ? parseXml(xtext) : null;
  if (xparsed !== null) return xparsed;
  return { list: [], class: [], page: 1, pagecount: 0, total: 0 };
}

function keepCat(tid, name) {
  if (EXCLUDED_IDS.indexOf(tid) >= 0) return false;
  for (const w of DROP_WORDS) if (name.indexOf(w) >= 0) return false;
  return true;
}

// 原 py _classes：先用接口分类（去重+过滤），为空才用 FALLBACK_CATS 兜底（同样去重+过滤）
function classes(live) {
  const out = [];
  const seen = {};
  for (const pair of live || []) {
    const tid = pair[0], name = pair[1];
    if (seen[tid]) continue;
    if (!keepCat(tid, name)) continue;
    seen[tid] = true;
    out.push({ id: tid, name: name });
  }
  if (out.length) return out;
  for (const pair of FALLBACK_CATS) {
    const tid = pair[0], name = pair[1];
    if (seen[tid]) continue;
    if (!keepCat(tid, name)) continue;
    seen[tid] = true;
    out.push({ id: tid, name: name });
  }
  return out;
}

// 原 py _enrich：列表里缺封面的记录批量走 detail 补封面/备注
async function enrich(records) {
  const need = records.filter(r => r.vod_id && !r.vod_pic);
  if (!need.length) return records;
  const ids = need.map(r => r.vod_id).join(",");
  const data = await fetchApi({ ac: "detail", ids: ids });
  const byId = {};
  for (const item of data.list || []) if (item.vod_id) byId[item.vod_id] = item;
  for (const record of records) {
    const extra = byId[record.vod_id || ""];
    if (extra) {
      if (!record.vod_pic && extra.vod_pic) record.vod_pic = extra.vod_pic;
      if (!record.vod_remarks && extra.vod_remarks) record.vod_remarks = extra.vod_remarks;
    }
  }
  return records;
}

function toCard(record) {
  const vid = str(record.vod_id).trim();
  const name = str(record.vod_name).trim();
  if (!vid || !name) return null;
  return {
    id: vid,
    title: name,
    cover: str(record.vod_pic).trim(),
    remarks: str(record.vod_remarks).trim(),
    tags: [],
  };
}
function toCards(records) {
  const out = [];
  for (const r of records || []) { const c = toCard(r); if (c) out.push(c); }
  return out;
}

async function home() {
  const data = await fetchApi({ ac: "list", pg: 1 });
  const cats = classes(data.class || []);
  const records = await enrich(data.list || []);
  const items = toCards(records);
  return { categories: cats, items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const pg = Math.max(1, intVal(arg && arg.page, 1));
  const tid = str(arg && arg.id).trim();
  const params = { ac: "list", pg: pg };
  if (tid) params.t = tid;
  const data = await fetchApi(params);
  const records = await enrich(data.list || []);
  const items = toCards(records);
  const pagecount = data.pagecount || 0;
  return { items: items, hasMore: pagecount ? pg < pagecount : items.length > 0 };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  const pg = Math.max(1, intVal(arg && arg.page, 1));
  const data = await fetchApi({ ac: "list", wd: keyword, pg: pg });
  const records = await enrich(data.list || []);
  const items = toCards(records);
  const pagecount = data.pagecount || 0;
  return { items: items, hasMore: pagecount ? pg < pagecount : false };
}

async function detail(arg) {
  let vid = str(arg && arg.id);
  if (vid.indexOf(",") >= 0) vid = vid.split(",")[0];
  vid = vid.trim();
  if (!vid) throw host.error("E_PARSE", "详情 id 为空");
  const data = await fetchApi({ ac: "detail", ids: vid });
  const records = data.list || [];
  if (!records.length) throw host.error("E_PARSE", "详情无记录");
  const record = records[0];
  const name = str(record.vod_name).trim();
  if (!name) throw host.error("E_PARSE", "详情无标题");
  const froms = str(record.vod_play_from).split("$$$");
  const urls = str(record.vod_play_url).split("$$$");
  const lines = [];
  for (let i = 0; i < urls.length; i++) {
    const eps = [];
    const seen = {};
    for (const seg of str(urls[i]).split("#")) {
      const s = seg.trim();
      if (!s) continue;
      let epName = "", epUrl = s;
      const di = s.indexOf("$");
      if (di >= 0) { epName = s.slice(0, di).trim(); epUrl = s.slice(di + 1).trim(); }
      if (!epUrl || seen[epUrl]) continue;
      seen[epUrl] = true;
      eps.push({ id: epUrl, name: epName || ("第" + (eps.length + 1) + "集") });
    }
    if (eps.length) {
      lines.push({ name: (froms[i] || "").trim() || ("线路" + (i + 1)), episodes: eps });
    }
  }
  const tags = [];
  if (record.vod_class) tags.push(record.vod_class);
  if (record.vod_actor) tags.push(record.vod_actor);
  if (record.vod_director) tags.push("导演：" + record.vod_director);
  return {
    id: vid,
    title: name,
    cover: str(record.vod_pic).trim(),
    desc: str(record.vod_content).trim(),
    year: str(record.vod_year).trim(),
    area: str(record.vod_area).trim(),
    remarks: str(record.vod_remarks).trim(),
    tags: tags,
    lines: lines,
  };
}

async function play(arg) {
  let raw = str((arg && arg.episodeId) || (arg && arg.id)).trim();
  if (raw.indexOf("$") >= 0) raw = raw.slice(raw.lastIndexOf("$") + 1).trim();
  let stream = raw.indexOf("http") === 0 ? raw : "";
  if (!stream) throw host.error("E_PARSE", "播放地址为空");
  if (stream.indexOf("http://") === 0) stream = "https://" + stream.slice(7);
  const isHls = stream.indexOf(".m3u8") >= 0;
  const format = isHls ? "hls" : "video";
  // master 主列表先预解析到子列表再返回，播放器少跳一层、避开多跳超时；失败保留主列表。
  if (isHls) {
    try {
      const resp = await host.http.get(stream, {
        headers: { "User-Agent": UA, "Referer": BASE + "/" },
        timeout: TIMEOUT,
      });
      const pl = resp && resp.body ? String(resp.body) : "";
      if (pl.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const ls = pl.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
        if (ls.length) stream = host.url.resolve(stream, ls[0]);
      }
    } catch (e) {}
  }
  return {
    streams: [{
      url: stream,
      format: format,
      headers: { "User-Agent": UA, "Referer": BASE + "/" },
      name: "大奶子资源",
    }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home: home, category: category, search: search, detail: detail, play: play };
