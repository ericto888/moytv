// Porn吃瓜网 — idj1 插件（由内置 py 蜘蛛 porncgw 改写）
// 站点：https://porncgw.com，HTML 站，无登录。
// 分类与原 py 的 CATS 表 1:1（25 个）；列表/详情/搜索均解析 article 卡片与详情页 HTML；
// 播放：POST /api/videos/{id}/playback（短剧走 episodes 子接口）取 streams.main，
// 接口下发的 CDN 鉴权头（x-cdn-auth / x-cdn-app）原样透传给播放器；接口失败时回退详情页 videoSrc。
// 封面：原 py 靠 localProxy 做 AES 图片解密，idj 宿主无图片解密/localProxy 对应物，
// 且现行图床 pic.qnlycc.cn 不在原 py 的代理名单内、原 py 对它也是直出地址，故插件同样直出 data-src 原地址。

const BASE = "https://porncgw.com";
const UA = "Mozilla/5.0 (Linux; Android 14; HarmonyOS; HUAWEI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const TIMEOUT = 60000;

const CATS = [
  ["recommend", "推荐吃瓜", "/recommend/"],
  ["today", "今日吃瓜", "/today/"],
  ["hot", "热门爆料", "/hot/"],
  ["hot-xsxy", "学生校园", "/hot/xsxy/"],
  ["hot-whhl", "网红黑料", "/hot/whhl/"],
  ["hot-snsf", "熟女少妇", "/hot/snsf/"],
  ["hot-cgbd", "吃瓜榜单", "/hot/cgbd/"],
  ["shrd", "社会热点", "/shrd/"],
  ["shrd-ylbg", "娱乐八卦", "/shrd/ylbg/"],
  ["shrd-wybl", "网友爆料", "/shrd/wybl/"],
  ["ent", "热门短片", "/entertainment/"],
  ["ent-cgtq", "出轨偷情", "/entertainment/cgtq/"],
  ["ent-zplc", "自拍流出", "/entertainment/zplc/"],
  ["door", "门事件", "/door/"],
  ["door-jiudian", "酒店", "/door/jiudian/"],
  ["door-chezhen", "车震", "/door/chezhen/"],
  ["ai", "AI成人", "/ai/"],
  ["ai-aidj", "AI短剧", "/ai/aidj/"],
  ["ai-AImj", "AI漫剧", "/ai/AImj/"],
  ["long-video", "长视频", "/long-video/"],
  ["ntxl", "女同系列", "/ntxl/"],
  ["omxl", "欧美系列", "/omxl/"],
  ["jqyy", "剧情演绎", "/jqyy/"],
  ["yzcm", "亚洲传媒", "/yzcm/"],
  ["list", "短视频", "/list"],
];

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function unescapeStr(s) {
  return str(s).replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function cleanText(s) {
  return unescapeStr(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

async function httpGet(url) {
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      const resp = await host.http.get(url, {
        headers: { "User-Agent": UA, "Referer": BASE },
        timeout: TIMEOUT,
      });
      if (resp.status === 200 && resp.body) return resp.body;
      lastErr = host.error("E_NETWORK", "页面请求失败 HTTP " + resp.status + "：" + url);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || host.error("E_NETWORK", "页面请求失败：" + url);
}

async function httpPostJson(url, referer) {
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      const resp = await host.http.post(url, "{}", {
        headers: { "User-Agent": UA, "Referer": referer, "Content-Type": "application/json" },
        timeout: TIMEOUT,
      });
      if (resp.status === 200 && resp.body) return resp.body;
      lastErr = host.error("E_NETWORK", "播放接口请求失败 HTTP " + resp.status);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || host.error("E_NETWORK", "播放接口请求失败");
}

function parseCards(html) {
  const out = [];
  if (!html) return out;
  const seen = {};
  const re = /<article[^>]*?data-title="([^"]*)"[^>]*?data-time="([^"]*)"[^>]*?>([\s\S]*?)<\/article>/g;
  let mm;
  while ((mm = re.exec(str(html))) !== null) {
    const title = unescapeStr(mm[1].trim());
    if (!title) continue;
    const body = mm[3];
    const m = body.match(/href="\/(video|drama)\/(\d+)\/"/);
    if (!m) continue;
    const vid = m[1] + "/" + m[2];
    if (seen[vid]) continue;
    seen[vid] = true;
    let cover = "";
    const m2 = body.match(/data-src="(https:\/\/[^"]+)"/);
    if (m2) cover = m2[1];
    let remark = mm[2].trim();
    if (m[1] === "drama") {
      const dm = body.match(/更新至(\d+)集/);
      if (dm) remark = "更新至" + dm[1] + "集";
    }
    out.push({ id: vid, title: title, cover: cover, remarks: remark, duration: "", tags: [] });
  }
  return out;
}

function catPath(tid) {
  for (let i = 0; i < CATS.length; i++) if (CATS[i][0] === tid) return CATS[i][2];
  return "";
}

async function catalog(tid, pg) {
  const path = catPath(tid);
  if (!path) throw host.error("E_PARSE", "未知分类：" + tid);
  let url;
  if (pg <= 1) url = BASE + path;
  else if (path.endsWith("/")) url = BASE + path + pg + "/";
  else url = BASE + path + "/" + pg + "/";
  return parseCards(await httpGet(url));
}

async function home() {
  const items = await catalog("recommend", 1);
  return {
    categories: CATS.map(c => ({ id: c[0], name: c[1] })),
    items: items,
    hasMore: items.length > 0,
  };
}

async function category(arg) {
  const page = Math.max(1, intValue(arg && arg.page, 1));
  const tid = str(arg && arg.id).trim();
  if (!tid) throw host.error("E_PARSE", "缺少分类 ID");
  const items = await catalog(tid, page);
  return { items: items, hasMore: items.length > 0 };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) return { items: [], hasMore: false };
  const items = parseCards(await httpGet(BASE + "/search/" + encodeURIComponent(keyword) + "/"));
  return { items: items, hasMore: false };
}

function normId(raw) {
  let s = str(raw).trim();
  if (s.indexOf("$") >= 0) s = s.split("$").pop() || s;
  return s.replace(/^\/+|\/+$/g, "").trim();
}

async function detail(arg) {
  const nid = normId(arg && arg.id);
  if (!nid) throw host.error("E_PARSE", "无效的影片 ID");
  const url = nid.startsWith("http") ? nid : BASE + "/" + nid + "/";
  const html = await httpGet(url);
  let title = "";
  let m = html.match(/<meta property="og:title"[^>]*content="([^"]+)"/);
  if (m) title = unescapeStr(m[1].trim());
  if (!title) {
    m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    if (m) title = unescapeStr(cleanText(m[1]));
  }
  if (title.endsWith(" - porn吃瓜网")) title = title.slice(0, title.length - " - porn吃瓜网".length).trim();
  if (!title) throw host.error("E_PARSE", "详情页未解析到标题");
  let cover = "";
  m = html.match(/data-src="(https:\/\/[^"]+)"/);
  if (m) cover = unescapeStr(m[1].trim());
  if (!cover) {
    m = html.match(/<meta property="og:image"[^>]*content="([^"]+)"/);
    if (m) cover = unescapeStr(m[1].trim());
  }
  let desc = "";
  m = html.match(/<meta name="description"[^>]*content="([^"]+)"/);
  if (m) desc = unescapeStr(m[1].trim());
  const episodes = [];
  if (nid.startsWith("drama/")) {
    const idPart = nid.slice("drama/".length).replace(/^\/+|\/+$/g, "");
    const nums = [];
    const re = new RegExp('href="/drama/' + idPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '/(\\d+)/"', "g");
    let mm;
    while ((mm = re.exec(html)) !== null) {
      const n = parseInt(mm[1], 10);
      if (isFinite(n) && nums.indexOf(n) < 0) nums.push(n);
    }
    nums.sort((a, b) => a - b);
    if (!nums.length) throw host.error("E_PARSE", "短剧详情页未解析到分集");
    for (const n of nums) episodes.push({ id: "drama/" + idPart + "/" + n, name: "第" + n + "集" });
  } else {
    episodes.push({ id: nid, name: "播放" });
  }
  return {
    id: nid,
    title: title,
    cover: cover,
    desc: desc,
    tags: [],
    lines: [{ name: "在线播放", episodes: episodes }],
  };
}

async function playback(kind, num, ep, referer) {
  const url = kind === "drama" && ep
    ? BASE + "/api/videos/" + num + "/episodes/" + ep + "/playback"
    : BASE + "/api/videos/" + num + "/playback";
  const text = await httpPostJson(url, referer);
  let data;
  try { data = JSON.parse(text); } catch (e) { return { url: "", headers: {} }; }
  if (!data || data.status !== 1 || !data.data) return { url: "", headers: {} };
  const payload = data.data;
  const streams = payload.streams || {};
  const m3u8 = unescapeStr(streams.main || streams.preview || "");
  if (!m3u8) return { url: "", headers: {} };
  const header = { "User-Agent": UA, "Referer": referer };
  const cdn = payload.cdn || {};
  if (cdn.m3u8Enabled && cdn.authKey && cdn.authValue) header[cdn.authKey] = String(cdn.authValue);
  if (cdn.app) header["x-cdn-app"] = String(cdn.app);
  return { url: m3u8, headers: header };
}

async function play(arg) {
  const raw = normId((arg && arg.episodeId) || (arg && arg.id));
  const baseHeader = { "User-Agent": UA, "Referer": BASE };
  if (/^https?:\/\//i.test(raw)) {
    const isHls = /\.m3u8($|\?)/i.test(raw);
    return { streams: [{ url: raw, format: isHls ? "hls" : "mp4", headers: baseHeader, name: "Porn吃瓜网" }], expiresAt: Date.now() + 3600 * 1000 };
  }
  const m = raw.match(/^(video|drama)\/(\d+)(?:\/(\d+))?$/);
  if (m) {
    const kind = m[1], num = m[2], ep = m[3] || "";
    if (kind === "drama" && !ep) throw host.error("E_PARSE", "短剧需指定集数");
    const referer = BASE + "/" + raw + "/";
    const got = await playback(kind, num, ep, referer);
    if (got.url) {
      const isHls = /\.m3u8($|\?)/i.test(got.url);
      return { streams: [{ url: got.url, format: isHls ? "hls" : "mp4", headers: got.headers, name: "Porn吃瓜网" }], expiresAt: Date.now() + 3600 * 1000 };
    }
  }
  // 回退：详情页 HTML 里的 videoSrc（与原 py 一致）
  const html = await httpGet(BASE + "/" + raw + "/");
  const vm = html.match(/"videoSrc":"([^"]+)"/);
  const m3u8 = vm ? unescapeStr(vm[1]) : "";
  if (!m3u8) throw host.error("E_PARSE", "未找到播放地址（playback 接口与详情页 videoSrc 均无结果）");
  const isHls = /\.m3u8($|\?)/i.test(m3u8);
  return { streams: [{ url: m3u8, format: isHls ? "hls" : "mp4", headers: baseHeader, name: "Porn吃瓜网" }], expiresAt: Date.now() + 3600 * 1000 };
}

export default { home, category, search, detail, play };
