// JAVHDTube — idj1 plugin (rewritten 1:1 from the builtin py spider javhdtube)
// Site: https://javhdtube.com (KVS-style HTML site, no login).
// Categories: the py's fixed 99-entry CATS list, unchanged; the py has no
// extra flag filtering and no gaming/gambling entries, so none is added.
// Lists: HTML card parsing exactly as py _parse_cards (split on
// '<div class="item th">', th-image-link href, title attr, data-original
// cover, th-duration remark). Detail: og:title / og:image / description /
// duration meta, episodes are the page's 720p get_file mp4 and the
// video_url get_file mp4 (falling back to the page URL, as in py).
// Play: port of py playerContent — a direct .mp4 id is redirect-resolved
// inside play() (Range probe, host follows redirects and manages the
// session cookies the get_file endpoint requires, exactly like the py
// cookie jar); a page-URL id is re-fetched and its video_url / 720p
// link extracted live. If a stream were an m3u8 master playlist, play()
// pre-resolves it to the first variant playlist before returning.

const HOST = "https://javhdtube.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 58000;

const CATS = [
  ["latest-updates", "最新更新"],
  ["4k", "4K"],
  ["asian", "Asian"],
  ["asian2", "Asian2"],
  ["ass", "Ass"],
  ["ass-licking", "Ass Licking"],
  ["ass-to-mouth", "Ass To Mouth"],
  ["bed-sex", "Bed Sex"],
  ["big-breasts", "Big Breasts"],
  ["big-cock", "Big Cock"],
  ["big-natural-tits", "Big Natural Tits"],
  ["big-tits", "Big Tits"],
  ["bikini", "Bikini"],
  ["blonde", "Blonde"],
  ["blowjob", "Blowjob"],
  ["boyfriend", "Boyfriend"],
  ["brunette", "Brunette"],
  ["brunette2", "Brunette2"],
  ["couple", "Couple"],
  ["cum-in-mouth", "Cum In Mouth"],
  ["cum-in-mouth2", "Cum In Mouth2"],
  ["cum-in-pussy", "Cum In Pussy"],
  ["cum-inside", "Cum Inside"],
  ["cumshot", "Cumshot"],
  ["cunnilingus", "Cunnilingus"],
  ["dirty-talk", "Dirty Talk"],
  ["doggystyle", "Doggystyle"],
  ["double-blowjob", "Double Blowjob"],
  ["exclusive", "Exclusive"],
  ["facial", "Facial"],
  ["facial-cumshot", "Facial Cumshot"],
  ["finger-fuck", "Finger Fuck"],
  ["girlfriend", "Girlfriend"],
  ["hairy", "Hairy"],
  ["hairy-pussy", "Hairy Pussy"],
  ["handjob", "Handjob"],
  ["hardcore", "Hardcore"],
  ["hardcore2", "Hardcore2"],
  ["hd", "HD"],
  ["hot-milf", "Hot Milf"],
  ["individual", "Individual"],
  ["insertions", "Insertions"],
  ["japanese", "Japanese"],
  ["japanese-close-up", "Japanese Close Up"],
  ["japanese2", "Japanese2"],
  ["kissing", "Kissing"],
  ["lesbian", "Lesbian"],
  ["lingerie", "Lingerie"],
  ["lingerie2", "Lingerie2"],
  ["maid", "Maid"],
  ["masturbating", "Masturbating"],
  ["masturbation", "Masturbation"],
  ["mature", "Mature"],
  ["mature-woman", "Mature Woman"],
  ["milf", "Milf"],
  ["mini-skirt", "Mini Skirt"],
  ["missionary", "Missionary"],
  ["mmf", "Mmf"],
  ["natural-boobs", "Natural Boobs"],
  ["natural-tits", "Natural Tits"],
  ["natural-tits2", "Natural Tits2"],
  ["nipple-play", "Nipple Play"],
  ["nurse", "Nurse"],
  ["office-lady", "Office Lady"],
  ["on-her-knees", "On Her Knees"],
  ["open-pussy", "Open Pussy"],
  ["outdoor", "Outdoor"],
  ["panties", "Panties"],
  ["perfect-ass", "Perfect Ass"],
  ["pink-pussy", "Pink Pussy"],
  ["pov", "Pov"],
  ["pussy-licking", "Pussy Licking"],
  ["pussy-to-mouth", "Pussy To Mouth"],
  ["reality", "Reality"],
  ["reverse-cowgirl", "Reverse Cowgirl"],
  ["riding", "Riding"],
  ["schoolgirl-18", "Schoolgirl 18+"],
  ["shaved", "Shaved"],
  ["shaved-pussy", "Shaved Pussy"],
  ["skinny", "Skinny"],
  ["small-cock", "Small Cock"],
  ["small-tits", "Small Tits"],
  ["squirting", "Squirting"],
  ["standing-sex", "Standing Sex"],
  ["stockings", "Stockings"],
  ["sucking", "Sucking"],
  ["talk", "Talk"],
  ["tattoo", "Tattoo"],
  ["teen-18", "Teen 18+"],
  ["thong", "Thong"],
  ["threesome", "Threesome"],
  ["tit-fuck", "Tit Fuck"],
  ["titjob", "Titjob"],
  ["toys", "Toys"],
  ["trimmed-pussy", "Trimmed Pussy"],
  ["undressing", "Undressing"],
  ["vibrator", "Vibrator"],
  ["vr", "VR"],
  ["wet-pussy", "Wet Pussy"]
];

function str(v) { return v == null ? "" : String(v); }
function intValue(v, fb) { const n = parseInt(v, 10); return isFinite(n) ? n : fb; }

function decodeEntities(s) {
  let out = str(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  out = out.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)));
  return out.trim();
}

async function httpGet(url, referer) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await host.http.get(url, {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Referer": referer || (HOST + "/"),
        },
        timeout: TIMEOUT,
      });
      if (resp && resp.body) return resp.body;
      lastErr = new Error("HTTP " + (resp ? resp.status : "no response"));
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return "";
}

async function fetchPage(url, referer) {
  let body = "";
  try {
    body = await httpGet(url, referer);
  } catch (e) {
    throw host.error((e && e.code) || "E_NETWORK", "javhdtube page fetch failed: " + url + " (" + (e && e.message) + ")");
  }
  if (!body) throw host.error("E_NETWORK", "javhdtube returned empty body: " + url);
  return body;
}

function parseCards(html) {
  const out = [];
  const seen = {};
  const blocks = str(html).split('<div class="item th">');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const marker = '<a class="th-image-link" href="';
    const p = block.indexOf(marker);
    if (p < 0) continue;
    const s = p + marker.length;
    const e = block.indexOf('"', s);
    if (e < 0) continue;
    const href = block.slice(s, e);
    if (href.indexOf("/video/") < 0 || seen[href]) continue;
    let title = "";
    const tp = block.indexOf('title="');
    if (tp >= 0) {
      const ts = tp + 7;
      const te = block.indexOf('"', ts);
      if (te >= 0) title = decodeEntities(block.slice(ts, te));
    }
    if (!title) continue;
    let cover = "";
    const cp = block.indexOf('data-original="');
    if (cp >= 0) {
      const cs = cp + 15;
      const ce = block.indexOf('"', cs);
      if (ce >= 0) cover = block.slice(cs, ce);
    }
    let remark = "";
    const rp = block.indexOf('<span class="th-duration">');
    if (rp >= 0) {
      const rs = rp + 26;
      const re = block.indexOf("</span>", rs);
      if (re >= 0) remark = block.slice(rs, re).trim();
    }
    seen[href] = true;
    out.push({ id: href, title: title.slice(0, 90), cover: cover, remarks: remark });
  }
  return out;
}

function catalogUrl(tid, pg) {
  const slug = tid || "latest-updates";
  const base = slug === "latest-updates" ? HOST + "/latest-updates/" : HOST + "/categories/" + slug + "/";
  return pg <= 1 ? base : base + pg + "/";
}

function metaContent(html, attr, key) {
  const marker = attr + '="' + key + '"';
  const p = str(html).indexOf(marker);
  if (p < 0) return "";
  const after = str(html).slice(p);
  const c = after.indexOf('content="');
  if (c < 0) return "";
  const s = c + 9;
  const e = after.indexOf('"', s);
  if (e < 0) return "";
  return decodeEntities(after.slice(s, e));
}

function extractVideoUrl(html) {
  const marker = "video_url: '";
  const p = str(html).indexOf(marker);
  if (p < 0) return "";
  const s = p + marker.length;
  const e = str(html).indexOf("'", s);
  return e >= 0 ? str(html).slice(s, e) : "";
}

function extract720p(html) {
  const marker = "_720p.mp4/?v-acctoken=";
  const p = str(html).indexOf(marker);
  if (p < 0) return "";
  let start = str(html).lastIndexOf("https://", p);
  if (start < 0) start = 0;
  const rest = str(html).slice(start);
  let end = rest.length;
  for (const ch of ['"', "'", "<", " ", "\n", "\r", "\t"]) {
    const i = rest.indexOf(ch);
    if (i >= 0 && i < end) end = i;
  }
  return rest.slice(0, end);
}

function formatDuration(seconds) {
  if (!(seconds > 0)) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const p2 = (n) => String(n).padStart(2, "0");
  return h > 0 ? h + ":" + p2(m) + ":" + p2(s) : m + ":" + p2(s);
}

function videoDuration(html) {
  const marker = 'duration" content="';
  const p = str(html).indexOf(marker);
  if (p < 0) return "";
  const s = p + marker.length;
  const e = str(html).indexOf('"', s);
  if (e < 0) return "";
  const n = parseInt(str(html).slice(s, e).trim(), 10);
  return isFinite(n) ? formatDuration(n) : "";
}

function normId(ids) {
  let v = ids;
  if (Array.isArray(v)) v = v.length ? v[0] : "";
  return str(v).trim();
}

async function resolveRedirect(url, referer) {
  try {
    const resp = await host.http.request({
      url: url,
      method: "GET",
      headers: { "User-Agent": UA, "Referer": referer || (HOST + "/"), "Range": "bytes=0-1023" },
      timeout: TIMEOUT,
    });
    if (resp && resp.url && /^https:\/\//i.test(resp.url) && resp.url.length > 20) return resp.url;
  } catch (e) { /* keep the original URL; players follow redirects too */ }
  return url;
}

async function home() {
  const categories = CATS.map(c => ({ id: c[0], name: c[1] }));
  const items = parseCards(await fetchPage(HOST + "/latest-updates/", HOST + "/"));
  return { categories: categories, items: items, hasMore: items.length > 0 };
}

async function category(arg) {
  const page = Math.max(1, intValue(arg && arg.page, 1));
  const tid = str(arg && arg.id).trim() || "latest-updates";
  const items = parseCards(await fetchPage(catalogUrl(tid, page), HOST + "/"));
  return { items: items, hasMore: items.length > 0 };
}

async function search(arg) {
  const keyword = str(arg && arg.keyword).trim();
  if (!keyword) return { items: [], hasMore: false };
  const url = HOST + "/search/" + encodeURIComponent(keyword) + "/";
  const items = parseCards(await fetchPage(url, HOST + "/")).slice(0, 60);
  return { items: items, hasMore: false };
}

async function detail(arg) {
  const nid = normId(arg && arg.id);
  if (!nid) throw host.error("E_PARSE", "empty detail id");
  const pageUrl = nid.indexOf("http") === 0 ? nid : HOST + "/" + nid.replace(/^\//, "");
  const html = await fetchPage(pageUrl, HOST + "/");
  const title = metaContent(html, "property", "og:title");
  if (!title) throw host.error("E_PARSE", "detail page has no og:title: " + pageUrl);
  const cover = metaContent(html, "property", "og:image");
  const desc = metaContent(html, "name", "description").slice(0, 400);
  const duration = videoDuration(html);
  const episodes = [];
  const u720 = extract720p(html);
  const u480 = extractVideoUrl(html);
  if (u720) episodes.push({ id: u720, name: "720p" });
  if (u480) episodes.push({ id: u480, name: "正片" });
  if (!episodes.length) episodes.push({ id: pageUrl, name: "正片" });
  return {
    id: pageUrl,
    title: title,
    cover: cover,
    desc: desc,
    tags: [],
    remarks: duration,
    lines: [{ name: "在线播放", episodes: episodes }],
  };
}

async function play(arg) {
  const raw = normId((arg && arg.episodeId) || (arg && arg.id));
  if (!raw) throw host.error("E_PARSE", "empty play id");
  const headers = { "User-Agent": UA, "Referer": HOST + "/" };
  let url = "";
  if (raw.indexOf(".mp4") >= 0) {
    url = await resolveRedirect(raw, HOST + "/");
  } else {
    const pageUrl = raw.split("$").slice(-1)[0];
    const html = await fetchPage(pageUrl, HOST + "/");
    url = extractVideoUrl(html) || extract720p(html);
    if (!url) throw host.error("E_PARSE", "no video_url on detail page: " + pageUrl);
    headers["Referer"] = encodeURI(pageUrl);
    url = await resolveRedirect(url, pageUrl);
  }
  if (!/^https:\/\//i.test(url)) throw host.error("E_PARSE", "play url is not an https direct link");
  const isHls = /\.m3u8($|\?)/i.test(url);
  if (isHls) {
    try {
      const resp = await host.http.get(url, { headers: headers, timeout: TIMEOUT });
      if (resp && resp.status === 200 && resp.body && resp.body.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const lines = resp.body.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.charAt(0) !== "#");
        if (lines.length) url = host.url.resolve(url, lines[0]);
      }
    } catch (e) { /* master playlist itself is playable; keep original */ }
  }
  return {
    streams: [{ url: url, format: isHls ? "hls" : "mp4", headers: headers, name: "在线播放" }],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default { home, category, search, detail, play };
