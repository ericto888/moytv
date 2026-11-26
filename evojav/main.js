// Evojav（evojav.pro）· i短剧插件 v1.0.9 · 2026-11-25
// WordPress + supjav2 主题：列表/分类/搜索/详情都是服务端渲染的 HTML
// 取流：详情页每个播放服务器按钮带一段加密 hex（data-link）→ 反转后丢给网关换取播放页
//       → 播放页里是 packed 的 jwplayer 配置 → 解包取出带签名的 master.m3u8
// v1.0.1：站点上 Cloudflare 人机验证（403 Just a moment）导致旧版直接报“没响应”。
//   ① 请求头补成完整 Chrome 指纹（sec-ch-ua / sec-fetch-*），尽量不被挑战；
//   ② 命中挑战页时不再报“没响应”，而是明确报 Cloudflare 验证；③ 5xx/超时仍是“稍等再进”。
// v1.0.3：manifest 声明 cloudflare=true。宿主 1.6b28+ 有插件 CF 验证通道：撞上挑战时弹
//   可见 WebView 让用户手动过验证，点「完成」后同步 cookie 并重试原请求（1.6.27 及以下
//   没有这个通道，仍走 ② 的报错）。注意：挑战是否触发看出口 IP 的信誉，换网/VPN 开关可能改变结果。
// v1.0.4：修“列表/详情都进得去，点播放却报无法打开这条播放线路”（GQN-016，2026-11-25 真机）。
//   根因不在取流：插件取到的 master 清单本身能打开，播放器在下一步（变体清单/分片）上撞墙——
//   播放器取变体/分片时不带 Referer、不带 cookie（EpisodeCache.http 没有 cookieJar），
//   而 Evojav 的流地址全在 Cloudflare 前面（evsishere/vvaassjjav/luminscdn/streamtape 等），
//   裸请求会被挑战/拦截。play() 现在按播放器的方式先验一遍：变体清单 + 首分片都用播放器的
//   iPhone UA、无 Referer 取一次；不通就换下一条线路/候选，不再把打不开的流交给播放器。
//   全部线路都不通时抛 E_EMPTY 并说明是哪一步不通（不再是播放器里的黑屏报错）。
// v1.0.5：v1.0.4 真机仍报“无法打开这条播放线路”（FC2PPV 5013090，2026-11-25 录屏：
//   取流中… → 解析播放列表… → 报错）。录屏证明 play() 已返回流，失败在宿主取清单那一步
//   （HLSLocal.prepare）：插件的 master 核验用的是完整 Chrome 指纹（H，含 sec-ch-ua 等），
//   而宿主取清单时只发流里那三行头（UA + Referer + Accept）——顶着 Chrome UA 却没有 sec-*
//   头的请求在 CF 眼里更像机器人，会被拦；插件用 iPhone UA 验变体时反而能过。v1.0.5 把
//   master/变体/首分片的核验全部改成播放器实际会发的头（iPhone UA + Referer + Accept，
//   不带 sec-* 指纹），并按宿主的规则验最高码率那条变体（HLSLocal.prepare 只取 BANDWIDTH
//   最高的那条）。流本身的 UA 也从 Chrome 141 改成 iPhone Safari，与播放器工厂 UA 一致。
// v1.0.6：修验证反复弹（用户报进站、进详情、播放各弹一次）。宿主源码定论：cf_clearance
//   绑定的是 WebView 的真实 UA（宿主注释原话），而插件每次都强制发自己的 UA（Windows
//   Chrome 141），与发证时的 UA 对不上，CF 就认不出那张通行证，下一次调用就再弹一次；
//   播放时还多了网关和嵌页几个独立的 CF 站，每个站都要自己过一次。改法：站点请求不再
//   强制插件自己的 UA（连带与之绑定的 sec-ch-ua 三行也去掉，否则与真实 UA 自相矛盾），
//   改让宿主发验证后学到的真实 UA（learnedUA，没有就发默认 iPhone UA），一次验证就管住，
//   同一站不再反复弹。流本身的 UA 不动（那是给播放器用的，仍是 iPhone，与播放器工厂一致）。
// v1.0.7：去掉 play() 里预检清单/变体/分片的步骤。v1.0.4/1.0.5 的预检用插件自己的客户端
//   （带 cookie jar、走系统代理）去验，验通过的流播放器用自己的客户端（无 cookie jar、
//   NO_PROXY）去取还是会被拦——预检测的是错误的客户端，验通过不等于播得了。更糟的是预检
//   会先取一次 master/变体/分片，可能耗掉一次性签名地址、也可能触发流站的限流，让播放器
//   随后那一次反而被拦。现在直接把 embed 里取到的 master 地址交给播放器，播放器那次是
//   第一次取流。另：详情简介删掉误导的“多支線可切”一句——play() 只返回一条流，播放器里
//   没有切线路的入口，用户切不了线。
// v1.0.9：修“5012556 明明有 EVS 线（用户 2026-11-25 10:04 截图：SERVER 一栏 EVS 亮着），
//   1.0.8 还是报无法打开这条播放线路”。网页上 EVS 按钮在，不等于插件能解出 EVS 的流：插件
//   只走网关 ?c={反转 hex}，若这条线嵌页的流是 JS 动态取的、静态 HTML 里没有，插件就解不出
//   EVS、只能退到下一条线（VAS/LUC/VOE），播放器又够不着那条线的 host。浏览器走的是
//   ?l={原 hex}（5012556 的 .mht 里就是 ?l=），且手机网页能播。改法：每条线先试 ?c=，解不出
//   再试 ?l=（原 hex，浏览器同款），哪个解出流用哪个；仍解不出才换下一条线。只加兜底，
//   ?c= 能解出时行为与 1.0.8 完全一致。
// v1.0.10：5012556 在 1.0.9 上仍播不了（韩国节点无拦截、FNS-259 同节点能播，
//   用户 2026-11-25 10:43 确认：按片分、不是节点问题）。5012556 的 EVS 嵌页是
//   VidHide（/embed/…），/api/stream 兜底的正则只认 /e/{code} 不认 /embed/{code}，
//   嵌页即使有 jwplayer 或 /api/stream 也不会 POST 取流。改法：正则扩成 /(?:e|embed)/。
// v1.0.11：5012556 在 1.0.10 上仍播不了。已核实：?l= 回的是 JS 点播页（点播放才把
//   iframe src 设成 ?c={反转 OLID}），插件不执行 JS、拿不到 iframe 地址；?c= 回 302 但
//   Location 为空（本机桌面/手机 UA、Referer 换 ?l=、带 cookie 都一样），跟不下去。改法：
//   gateCands 拿到 ?l= 的页面后，直接从 HTML 里抠 var OLID、反转、拼出 ?c= 再跟一次。
//   ?c= 在用户手机上也许能给正常跳转（本机 IP 可能被网关区别对待），真机验证为准。
// v1.0.8：修“改验证前多数能播，改完只剩 FNS-259 能播”（用户 2026-11-25 09:21，试了 10 几部）。
//   v1.0.6 把站点请求全改成不带 UA（让宿主发 learnedUA，好让 cf_clearance 粘住、不反复弹
//   验证），但这也让网关 lk1.supremejav.com 和嵌页（embed）拿到的是移动端 UA——那两处按
//   UA 返回不同的流地址，移动端那份播放器取不到（改验证前桌面 Chrome 141 那份多数能播）。
//   改法：evojav.pro 本站请求仍不带 UA（验证只对本站管用，继续粘住）；网关和嵌页（含 VAS
//   的 /api/stream POST）恢复桌面 Chrome 141 指纹（DESKTOP_H），拿回改验证前那份流。
//   流本身的 UA 不动（仍是 iPhone，与播放器工厂一致）。
const PROMO = '【本插件由TG频道〖多多纯净软件分享〗提供，频道号@yydsys】';

const SITE = 'https://evojav.pro';
const GATE = 'https://lk1.supremejav.com';

/* 注意：这里故意不写 User-Agent 和 sec-ch-ua——宿主会按验证后学到的真实 UA 发请求，
   写了自己的 UA 反而会让 cf_clearance 对不上号、每调一次弹一次验证。 */
const H = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'ja,zh-CN;q=0.9,en;q=0.7',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

/* 桌面 Chrome 141 指纹——只给网关和嵌页用（v1.0.8）。v1.0.6 之前 H 里就是这套，多数视频
   能播；v1.0.6 把它从所有站点请求里拿掉后，网关/嵌页按移动端 UA 返回了另一份流，播放器
   取不到。本站（evojav.pro）请求仍用上面的 H（不带 UA），好让 cf_clearance 粘住。 */
const DESKTOP_H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Sec-Ch-Ua': '"Google Chrome";v="141", "Chromium";v="141", "Not-A.Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"'
};

const CATS = [
  { id: 'popular', name: '人気' },
  { id: 'censored-jav', name: '有修正' },
  { id: 'uncensored-jav', name: '無修正' },
  { id: 'amateur', name: '素人動画' },
  { id: 'chinese-subtitles', name: '中国語字幕' },
  { id: 'reducing-mosaic', name: 'モザイク破壊' },
  { id: 'english-subtitles', name: '英語字幕' }
];

/* ---------- 基础 ---------- */

function unesc(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#8211;/g, '-')
    .replace(/&amp;/g, '&');
}

function stripTags(s) {
  return unesc(String(s == null ? '' : s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function abs(u, base) {
  const s = String(u == null ? '' : u).trim();
  if (!s || /^data:/i.test(s)) return '';
  if (s.indexOf('//') === 0) return 'https:' + s;
  if (/^https?:\/\//i.test(s)) return s;
  const b = base || SITE;
  if (s.charAt(0) === '/') return b + s;
  return b + '/' + s;
}

function hostOf(u) {
  const m = String(u || '').match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1] : '';
}

/* 宿主不跟 301/302，自己跟（最多 6 跳） */
async function follow(url, opts) {
  const o = opts || {};
  let cur = abs(url, o.base || SITE);
  let res = null;
  for (let i = 0; i < 6; i++) {
    res = await host.http.request({
      url: cur,
      headers: Object.assign({}, H, o.headers || {}),
      timeout: o.timeout || 25000
    });
    const st = Number(res.status || 0);
    if (st >= 300 && st < 400 && res.headers && res.headers.location) {
      cur = abs(res.headers.location, cur);
      continue;
    }
    break;
  }
  res.url = cur;
  return res;
}

/* Cloudflare 挑战页判定：宿主是纯 OkHttp 请求，过不了 JS 人机验证 */
function looksCF(body) {
  const s = String(body || '');
  return s.indexOf('Just a moment') >= 0 || s.indexOf('_cf_chl_opt') >= 0 ||
    s.indexOf('challenges.cloudflare.com') >= 0;
}
const CF_MSG = '站点开了 Cloudflare 人机验证，插件过不了验证；换个网络（开关 VPN/换 WiFi/流量）再进一次，或等站点松一点再试';

async function getText(url, opts) {
  const r = await follow(url, opts);
  const st = Number(r.status || 0);
  const body = String(r.body || '');
  if (looksCF(body) || st === 403) throw host.error('E_CF', CF_MSG);
  if (st >= 500) throw host.error('E_HTTP', '站点这会儿没响应，稍等十几秒再进一次');
  return { status: st, body: body, url: r.url };
}

/* ---------- 列表解析 ---------- */

function slugOf(u) {
  const m = String(u || '').match(/\/video\/([^"'?#\/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function parseList(html) {
  const out = [];
  const seen = {};
  const parts = String(html || '').split('<div class="post">').slice(1);
  for (const raw of parts) {
    const seg = raw.slice(0, 3000);
    const hrefM = seg.match(/<a[^>]*class=['"]img['"][^>]*href=['"]([^'"]+)['"]/) ||
      seg.match(/<a[^>]*href=['"]([^'"]*\/video\/[^'"]+)['"]/) ||
      seg.match(/<h3[^>]*>[\s\S]*?href=['"]([^'"]+)['"]/);
    if (!hrefM) continue;
    const url = abs(unesc(hrefM[1]), SITE);
    const slug = slugOf(url);
    if (!slug || seen[slug]) continue;
    seen[slug] = 1;

    let title = '';
    const tM = seg.match(/<h3[^>]*>[\s\S]*?<a[^>]*title=['"]([^'"]+)['"]/i) ||
      seg.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
      seg.match(/<a[^>]*class=['"]img['"][^>]*title=['"]([^'"]+)['"]/i);
    if (tM) title = stripTags(tM[1]);

    let cover = '';
    const imgM = seg.match(/<img[^>]*class=['"][^'"]*thumb[^'"]*['"][^>]*>/i) || seg.match(/<img[^>]*>/i);
    if (imgM) {
      const tag = imgM[0];
      const cM = tag.match(/data-original=['"]([^'"]+)['"]/i) ||
        tag.match(/data-src=['"]([^'"]+)['"]/i) ||
        tag.match(/data-lazy-src=['"]([^'"]+)['"]/i) ||
        tag.match(/src=['"]([^'"]+)['"]/i);
      if (cM && !/^data:/i.test(cM[1])) cover = abs(unesc(cM[1]), SITE);
    }

    const metaM = seg.match(/<div class="meta">([\s\S]*?)<\/div>/);
    let date = '';
    let views = '';
    if (metaM) {
      const mt = stripTags(metaM[1]);
      const dM = mt.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (dM) date = dM[1] + '-' + ('0' + dM[2]).slice(-2) + '-' + ('0' + dM[3]).slice(-2);
      const vM = mt.match(/([\d,]+)\s*Views/i);
      if (vM) views = vM[1];
    }

    out.push({
      id: slug,
      title: title || slug,
      cover: cover,
      desc: PROMO + (date ? '\n\n更新：' + date + (views ? ' · ' + views + ' 次观看' : '') : ''),
      tags: [],
      remark: date
    });
  }
  return out;
}

function hasNext(html, page) {
  const s = String(html || '');
  if (new RegExp('/page/' + (page + 1) + '/').test(s)) return true;
  return /class="next-page"><a/.test(s);
}

/* ---------- 详情解析 ---------- */

function serversOf(html) {
  const out = [];
  const re = /class="btn-server([^"]*)"\s+data-link="([0-9a-fA-F]+)"[^>]*>([^<]*)<\/a>/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    out.push({ name: stripTags(m[3]) || ('线路' + (out.length + 1)), link: m[2], active: m[1].indexOf('active') >= 0 });
  }
  if (!out.length) {
    const re2 = /data-link="([0-9a-fA-F]+)"[^>]*>([^<]*)<\/a>/g;
    while ((m = re2.exec(String(html || '')))) out.push({ name: stripTags(m[2]), link: m[1], active: false });
  }
  return out;
}

function infoOf(html) {
  const h = String(html || '');
  const title = stripTags((h.match(/<div class="archive-title">\s*<h1>([\s\S]*?)<\/h1>/) || [])[1] || '') ||
    stripTags((h.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || '');

  let cover = '';
  const cm = h.match(/<div class="post-meta[\s\S]*?<img[^>]*src=['"]([^'"]+)['"]/i) ||
    h.match(/class="player-wrap"[^>]*background-image:\s*url\(([^)]+)\)/i) ||
    h.match(/<img[^>]*class=['"]img['"][^>]*src=['"]([^'"]+)['"]/i);
  if (cm) cover = abs(unesc(cm[1].replace(/['"]/g, '').trim()), SITE);

  const cats = [];
  const catBlock = (h.match(/<div class="cats">([\s\S]*?)<\/div>/) || [])[1] || '';
  let cm2;
  const catRe = /<a[^>]*href=['"][^'"]*\/(?:censored-jav|uncensored-jav|amateur|chinese-subtitles|reducing-mosaic|english-subtitles|popular)\/[^'"]*['"][^>]*>([^<]+)<\/a>/g;
  while ((cm2 = catRe.exec(catBlock))) {
    const t = stripTags(cm2[1]);
    if (t && cats.indexOf(t) < 0) cats.push(t);
  }

  const maker = stripTags(((h.match(/Maker\s*:\s*<\/span>\s*<a[^>]*>([^<]*)<\/a>/) || [])[1]) || '');
  const cast = stripTags(((h.match(/Cast\s*:\s*<\/span>\s*<a[^>]*>([^<]*)<\/a>/) || [])[1]) || '');

  const tags = [];
  const tagBlock = (h.match(/<div class="tags">([\s\S]*?)<\/div>/) || [])[1] || '';
  const tagRe = /<a[^>]*rel="tag"[^>]*>([^<]+)<\/a>/g;
  let tm;
  while ((tm = tagRe.exec(tagBlock))) {
    const t = stripTags(tm[1]);
    if (t && tags.indexOf(t) < 0) tags.push(t);
  }

  return { title: title, cover: cover, cats: cats, maker: maker, cast: cast, tags: tags };
}

/* ---------- packed 脚本解包（静态解析，不执行站点 JS） ---------- */

function unpack(src) {
  const s = String(src || '');
  const m = s.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) return '';
  const p = m[1];
  const base = parseInt(m[2], 10) || 62;
  const c = parseInt(m[3], 10) || 0;
  const k = m[4].split('|');
  let out = p.replace(/\b[0-9a-zA-Z]+\b/g, function (t) {
    const i = parseInt(t, base);
    if (!isNaN(i) && i >= 0 && i < k.length && k[i]) return k[i];
    return t;
  });
  out = out.replace(/\\\//g, '/').replace(/\\'/g, "'").replace(/\\"/g, '"');
  out = out.replace(/\\u0026/g, '&');
  return out;
}

function grabLink(js, name) {
  const m = String(js || '').match(new RegExp('"' + name + '"\\s*:\\s*"([^"]+)"'));
  return m ? m[1].replace(/\\\//g, '/') : '';
}

/* 流的 UA：播放器工厂 UA 是 iPhone Safari（宿主 MacCMS.UA），流 headers 里写它，
   播放器取清单/分片时就发它。别写桌面 Chrome UA——宿主只转发 UA/Referer/Accept 三行头，
   不带 sec-*，顶着 Chrome UA 却没有 sec-* 头在 CF 眼里更像机器人，会被拦。 */
const PLAYER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/* 从播放页（embed）里取可用清单：EVS 走 packed 配置，VAS 走 /api/stream */
async function streamsFromEmbed(embedUrl) {
  const page = await getText(embedUrl, { headers: Object.assign({}, DESKTOP_H, { Referer: SITE + '/' }) });
  if (page.status >= 400) throw host.error('E_EMPTY', '播放页打不开，换一部试试');
  const body = page.body;
  let js = unpack(body);
  if (!js) js = body;

  const cands = [];
  const order = ['hls2', 'hls3', 'hls4'];
  for (const nm of order) {
    let u = grabLink(js, nm);
    if (!u) {
      const alt = String(js).match(new RegExp(nm + '\\s*:\\s*[\'"]([^\'"]+)[\'"]'));
      if (alt) u = alt[1];
    }
    if (!u) continue;
    cands.push({ name: nm, url: abs(u, embedUrl) });
  }
  if (cands.length) return { embed: embedUrl, cands: cands };

  /* VAS 类：一个 POST 接口换流地址 */
  if (body.indexOf('/api/stream') >= 0 || body.indexOf('jwplayer') >= 0) {
    const fm = String(embedUrl).match(/\/(?:e|embed)\/([A-Za-z0-9]+)/);
    const eh = hostOf(embedUrl);
    if (fm && eh) {
      try {
        const r = await host.http.request({
          url: 'https://' + eh + '/api/stream',
          method: 'POST',
          headers: Object.assign({}, H, DESKTOP_H, {
            'Content-Type': 'application/json',
            'Referer': embedUrl,
            'Origin': 'https://' + eh
          }),
          body: JSON.stringify({ filecode: fm[1], device: 'ios', codecs: [] }),
          timeout: 20000
        });
        const j = JSON.parse(String(r.body || '{}'));
        if (j && j.streaming_url && /^https?:\/\//i.test(j.streaming_url)) {
          cands.push({ name: 'api', url: j.streaming_url });
        }
      } catch (e) {}
    }
  }
  if (cands.length) return { embed: embedUrl, cands: cands };

  /* 兜底：正文里直接出现的 m3u8 */
  const direct = String(js || body).match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
  if (direct) cands.push({ name: 'direct', url: direct[0].replace(/\\\//g, '/') });
  return { embed: embedUrl, cands: cands };
}

/* ---------- 主入口 ---------- */

const plugin = {
  async home() {
    const r = await getText(SITE + '/');
    if (r.status >= 400) throw host.error('E_HTTP', '首页打不开，稍后再试');
    const items = parseList(r.body);
    if (!items.length) throw host.error('E_PARSE', '首页没有解析到内容，稍后再试');
    return { categories: CATS.slice(), items: items.slice(0, 60), hasMore: false };
  },

  async category(args) {
    const a = args || {};
    const id = String(a.id == null || a.id === '' ? 'popular' : a.id).replace(/[^a-z0-9-]/gi, '') || 'popular';
    const page = Number(a.page) > 1 ? Math.floor(Number(a.page)) : 1;
    const base = id === 'popular' ? '/popular/' : '/' + id + '/';
    const path = page > 1 ? base + 'page/' + page + '/' : base;
    const r = await getText(SITE + path);
    if (r.status >= 400) throw host.error('E_HTTP', '这个分类暂时打不开，换一个试试');
    const items = parseList(r.body);
    if (!items.length && page === 1) throw host.error('E_EMPTY', '这个分类暂时没有内容');
    return { items: items, hasMore: items.length > 0 && hasNext(r.body, page) };
  },

  async search(args) {
    const a = args || {};
    const kw = String(a.keyword || '').replace(/[\/\\?#&]+/g, ' ').trim();
    if (!kw) return { items: [], hasMore: false };
    const page = Number(a.page) > 1 ? Math.floor(Number(a.page)) : 1;
    const q = encodeURIComponent(kw);
    const path = page > 1 ? '/page/' + page + '/?s=' + q : '/?s=' + q;
    const r = await getText(SITE + path);
    if (r.status >= 400) return { items: [], hasMore: false };
    const items = parseList(r.body);
    return { items: items, hasMore: items.length > 0 && hasNext(r.body, page) };
  },

  async detail(args) {
    const a = args || {};
    const raw = String(a.id == null ? '' : a.id);
    if (!raw) throw host.error('E_ARGS', '这部片的信息不完整，回列表重新点一次');
    const slug = slugOf(raw) || raw.replace(/^\/+/, '').replace(/[?#].*$/, '');
    const url = /^https?:\/\//i.test(raw) ? raw : SITE + '/video/' + encodeURIComponent(slug) + '/';
    const r = await getText(url);
    if (r.status === 404 || r.status === 410) throw host.error('E_NOT_FOUND', '这部片在站点上找不到了');
    if (r.status >= 400) throw host.error('E_HTTP', '站点暂时打不开，回去重进一次');
    const info = infoOf(r.body);
    const servers = serversOf(r.body);
    if (!info.title && !servers.length) throw host.error('E_PARSE', '详情没解析出来（站点可能改版了）');

    const meta = [];
    if (info.cats.length) meta.push('分类：' + info.cats.join(' / '));
    if (info.maker) meta.push('片商：' + info.maker);
    if (info.cast) meta.push('女優：' + info.cast);

    const desc = [PROMO];
    if (meta.length) { desc.push(''); desc.push(meta.join('\n')); }
    if (info.tags.length) { desc.push(''); desc.push('标签：' + info.tags.slice(0, 12).join(' · ')); }

    return {
      id: slug,
      title: info.title || slug,
      cover: info.cover,
      desc: desc.join('\n'),
      duration: '',
      tags: info.tags.length ? info.tags : info.cats,
      lines: [{ name: '默认线路', line: 'evs', episodes: [{ id: slug, name: '正片' }] }]
    };
  },

  async play(args) {
    const a = args || {};
    const raw = String(a.id == null ? '' : a.id);
    const slug = slugOf(raw) || raw.replace(/^\/+/, '').replace(/[?#].*$/, '');
    if (!slug) throw host.error('E_ARGS', '播放信息无效，回详情页重进一次');

    const dr = await getText(SITE + '/video/' + encodeURIComponent(slug) + '/');
    if (dr.status >= 400) throw host.error('E_HTTP', '详情页打不开，稍后再试');
    let servers = serversOf(dr.body);
    if (!servers.length) throw host.error('E_PARSE', '这条片暂时没有可用线路');

    /* EVS / VAS 优先，其余放后面 */
    servers.sort(function (x, y) {
      const rank = function (n) {
        const s = String(n || '').toUpperCase();
        if (s === 'EVS') return 0;
        if (s === 'VAS') return 1;
        if (s === 'LUC') return 2;
        if (s === 'VOE') return 3;
        return 4;
      };
      return rank(x.name) - rank(y.name);
    });

    /* 每条线走一次网关拿嵌页、再从嵌页解流；返回 { embed, cands }，解不出时 cands 为空。 */
    const gateCands = async function (gateUrl, depth) {
      const gateRes = await follow(gateUrl, { headers: Object.assign({}, DESKTOP_H, { Referer: GATE + '/' }) });
      if ((depth || 0) < 1) {
        const gbody = String(gateRes.body || '');
        const om = gbody.match(/var\s+OLID\s*=\s*'([0-9a-fA-F]+)'/);
        if (om && om[1]) {
          const rev2 = om[1].split('').reverse().join('');
          return gateCands(GATE + '/evojav.php?c=' + rev2, (depth || 0) + 1);
        }
      }
      let embed = String(gateRes.url || '');
      if (!/^https?:\/\//i.test(embed) || embed.indexOf('evojav.php') >= 0) {
        const loc = String((gateRes.headers && gateRes.headers.location) || '');
        if (loc) embed = abs(loc, GATE);
      }
      if (!/^https?:\/\//i.test(embed)) return { embed: '', cands: [] };
      embed = embed.split('#')[0];
      if (!hostOf(embed)) return { embed: '', cands: [] };
      const res = await streamsFromEmbed(embed);
      return { embed: embed, cands: res.cands || [] };
    };

    const tried = [];
    for (const sv of servers.slice(0, 4)) {
      try {
        const raw = String(sv.link);
        const rev = raw.split('').reverse().join('');
        /* v1.0.9：先试 ?c={反转 hex}（老路）；解不出再试 ?l={原 hex}（浏览器同款，5012556
           的 .mht 里就是 ?l=）。同一条线两个网关参数都试过、都没流，才换下一条线。 */
        let got = await gateCands(GATE + '/evojav.php?c=' + rev);
        if (!got.cands.length) got = await gateCands(GATE + '/evojav.php?l=' + raw);
        if (!got.cands.length) { tried.push(sv.name + ':没解析到清单'); continue; }
        const embed = got.embed;
        const res = { cands: got.cands };

        /* v1.0.7：直接交第一条候选，不再预检。预检测的是插件的客户端，不是播放器的，
           验通过不等于播得了；还可能耗掉一次性地址或触发限流。播放器这次是第一次取流。 */
        const c = res.cands[0];
        let finalUrl = String(c.url);
        try {
          const ob = new URL(finalUrl);
          finalUrl = ob.protocol + '//' + ob.host.toLowerCase() + ob.pathname + (ob.search || '');
        } catch (e) {}

        try { host.storage.set('last', slug); } catch (e) {}

        /* 清单里是相对路径时，宿主按 master 的目录去拼，这里保证目录形态是对的 */
        return {
          streams: [{
            url: finalUrl,
            format: 'hls',
            headers: { 'User-Agent': PLAYER_UA, Referer: embed, Accept: '*/*' },
            name: sv.name + ' · 高清'
          }]
        };
      } catch (e) {
        tried.push(sv.name + ':' + (e && e.message ? e.message : '失败'));
      }
    }

    throw host.error('E_EMPTY', '这条片几条线路都没取到片源（' + tried.slice(0, 3).join('；') + '），换一部试试');
  }
};

export default plugin;
