// JAVMIT - idj1 plugin (rewritten 1:1 from the built-in py spider javmit)
// Site: https://javmit.com (WordPress). Category pages list v-card articles,
// detail pages carry the stream in og:video (master m3u8 on s*.javmit.com),
// play resolves the master playlist to its first variant inside play().

const HOST = "https://javmit.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 60000;

const CATS = [
  ["creampie", "CREAMPIE"],
  ["solowork", "SOLOWORK"],
  ["big-tits", "BIG TITS"],
  ["married", "MARRIED"],
  ["amateur", "AMATEUR"],
  ["blowjob", "BLOWJOB"],
  ["slut", "SLUT"],
  ["ol", "OL"],
  ["beautiful-girl", "BEAUTIFUL GIRL"],
  ["slender", "SLENDER"],
  ["pov", "POV"],
  ["boobs-fetish", "BOOBS FETISH"],
  ["3p", "3P"],
  ["mature", "MATURE"],
  ["squirting", "SQUIRTING"],
  ["orgasm", "ORGASM"],
  ["big-breasts", "BIG BREASTS"],
  ["individual", "INDIVIDUAL"],
  ["cuckold", "CUCKOLD"],
  ["mature-woman", "MATURE WOMAN"],
  ["back", "BACK"],
  ["drama", "DRAMA"],
  ["schoolgirls", "SCHOOLGIRLS"],
  ["cunnilingus", "CUNNILINGUS"],
  ["facials", "FACIALS"],
  ["big-butt", "BIG BUTT"],
  ["uniform", "UNIFORM"],
  ["kissing", "KISSING"],
  ["cowgirl", "COWGIRL"],
  ["titty-fuck", "TITTY FUCK"],
  ["orgy", "ORGY"],
  ["toy", "TOY"],
  ["documentary", "DOCUMENTARY"],
  ["nasty", "NASTY"],
  ["deep-throat", "DEEP THROAT"],
  ["mother", "MOTHER"],
  ["uncategorized", "UNCATEGORIZED"],
  ["cosplay", "COSPLAY"],
  ["affair", "AFFAIR"],
  ["shaved", "SHAVED"],
  ["humiliation", "HUMILIATION"],
  ["bukkake", "BUKKAKE"],
  ["subtitles", "字幕付き"],
  ["debut-production", "DEBUT PRODUCTION"],
  ["handjob", "HANDJOB"],
  ["anal", "ANAL"],
  ["original", "ORIGINAL"],
  ["planning", "PLANNING"],
  ["pantyhose", "PANTYHOSE"],
  ["voyeur", "VOYEUR"],
  ["incest", "INCEST"],
  ["dirty-talk", "DIRTY TALK"],
  ["other-fetish", "OTHER FETISH"],
  ["lotion", "LOTION"],
  ["lesbian", "LESBIAN"],
  ["gal", "GAL"],
  ["cum", "CUM"],
  ["nampa", "NAMPA"],
  ["transsexual", "TRANSSEXUAL"],
  ["urination", "URINATION"],
  ["sweat", "SWEAT"],
  ["mini", "MINI"],
  ["close-up", "CLOSE UP"],
  ["cross-dressing", "CROSS DRESSING"],
  ["big-breast-fetish", "BIG BREAST FETISH"],
  ["beauty-shop", "BEAUTY SHOP"],
  ["outdoors", "OUTDOORS"],
  ["leg-fetish", "LEG FETISH"],
  ["action", "ACTION"],
  ["bbw", "BBW"],
  ["special-effects", "SPECIAL EFFECTS"],
  ["school-uniform", "SCHOOL UNIFORM"],
  ["busty-fetish", "BUSTY FETISH"],
  ["vibe", "VIBE"],
  ["lesbian-kiss", "LESBIAN KISS"],
  ["huge-butt", "HUGE BUTT"],
  ["4hr", "4HR"],
  ["prank", "PRANK"],
  ["petite", "PETITE"],
  ["drug", "DRUG"],
  ["foot-fetish", "FOOT FETISH"],
  ["panty-flash", "PANTY FLASH"],
  ["butt-fetish", "BUTT FETISH"],
  ["bunny-girl", "BUNNY GIRL"],
  ["old-friend", "OLD FRIEND"],
  ["loli", "LOLI"],
  ["hardcore", "HARDCORE"],
  ["69", "69"],
  ["hd", "HD"],
  ["dance", "DANCE"],
  ["rape", "RAPE"],
  ["black-actor", "BLACK ACTOR"],
  ["digital-mosaic", "DIGITAL MOSAIC"],
  ["hentai-collab", "HENTAI COLLAB"],
  ["4k", "4K"],];

function str(value) {
  if (value == null) return "";
  return String(value).trim();
}

function normId(ids) {
  if (Array.isArray(ids)) ids = ids.length ? ids[0] : "";
  return str(ids);
}

function normPg(pg) {
  const n = parseInt(pg, 10);
  return isFinite(n) && n >= 1 ? n : 1;
}

function trunc(s, n) {
  s = s || "";
  return s.length > n ? s.slice(0, n) : s;
}

function decodeEntities(s) {
  if (!s) return "";
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

function cleanText(t) {
  if (!t) return "";
  return decodeEntities(String(t).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function cleanCardTitle(raw) {
  let s = decodeEntities(raw);
  const i = s.indexOf("[Download and Stream]");
  if (i >= 0) s = s.slice(0, i).trim();
  return trunc(s, 90);
}

function pageHeaders(referer) {
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": referer || HOST + "/",
  };
}

async function httpGet(url, referer) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await host.http.get(url, {headers: pageHeaders(referer), timeout: TIMEOUT});
      if (resp && resp.status === 200 && resp.body) return resp.body;
      if (resp && resp.body) return resp.body;
    } catch (e) {
      // retry
    }
  }
  return "";
}

function parseCards(html) {
  const out = [];
  const seen = {};
  const parts = String(html || "").split('<article class="v-card"');
  for (let i = 1; i < parts.length; i++) {
    let block = parts[i];
    const end = block.indexOf("</article>");
    if (end >= 0) block = block.slice(0, end);
    const p = block.indexOf('<a href="https://javmit.com/');
    if (p < 0) continue;
    const s = p + 9;
    const e = block.slice(s).indexOf('"');
    if (e < 0) continue;
    const href = block.slice(s, s + e);
    if (href.endsWith("/feed/") || href.indexOf("/category/") >= 0 || href.indexOf("/tag/") >= 0) continue;
    if (seen[href]) continue;
    const p2 = block.indexOf('alt="');
    if (p2 < 0) continue;
    const s2 = p2 + 5;
    const e2 = block.slice(s2).indexOf('"');
    const title = e2 >= 0 ? cleanCardTitle(block.slice(s2, s2 + e2)) : "";
    if (!title) continue;
    let cover = "";
    const p3 = block.indexOf('src="https://javmit.com/wp-content/uploads/');
    if (p3 >= 0) {
      const s3 = p3 + 5;
      const e3 = block.slice(s3).indexOf('"');
      if (e3 >= 0) cover = block.slice(s3, s3 + e3);
    }
    let remark = "";
    const p4 = block.indexOf('<div class="vc-dur">');
    if (p4 >= 0) {
      const s4 = p4 + 20;
      const e4 = block.slice(s4).indexOf("</div>");
      if (e4 >= 0) remark = block.slice(s4, s4 + e4).trim();
    }
    seen[href] = true;
    out.push({id: href, title: title, cover: cover, remarks: remark, duration: remark, tags: []});
  }
  return out;
}

function catalogUrl(slug, pg) {
  slug = slug || "creampie";
  if (pg <= 1) return HOST + "/category/" + slug + "/";
  return HOST + "/category/" + slug + "/page/" + pg + "/";
}

async function catalog(tid, pg) {
  return parseCards(await httpGet(catalogUrl(tid, pg), HOST + "/"));
}

function metaValue(html, attr, key) {
  const marker = attr + '="' + key + '"';
  const p = html.indexOf(marker);
  if (p < 0) return "";
  const after = html.slice(p);
  const c = after.indexOf('content="');
  if (c < 0) return "";
  const s = c + 9;
  const e = after.slice(s).indexOf('"');
  if (e < 0) return "";
  return decodeEntities(after.slice(s, s + e));
}

function detailCover(html) {
  const marker = 'src="https://javmit.com/wp-content/uploads/';
  let rest = html;
  while (true) {
    const p = rest.indexOf(marker);
    if (p < 0) return "";
    const s = p + 5;
    const e = rest.slice(s).indexOf('"');
    if (e >= 0) {
      const url = rest.slice(s, s + e);
      if (url.indexOf("-cover") >= 0) return url;
    }
    rest = rest.slice(p + 1);
  }
}

function fmtDuration(sec) {
  const n = parseInt(sec, 10);
  if (!isFinite(n) || n <= 0) return "";
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const mm = (m < 10 ? "0" : "") + m;
  const ss = (s < 10 ? "0" : "") + s;
  if (h > 0) return h + ":" + mm + ":" + ss;
  return m + ":" + ss;
}

function videoDuration(html) {
  const marker = 'video:duration" content="';
  const p = html.indexOf(marker);
  if (p < 0) return "";
  const s = p + marker.length;
  const e = html.slice(s).indexOf('"');
  if (e < 0) return "";
  return fmtDuration(html.slice(s, s + e));
}

async function home() {
  const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
  const items = await catalog(CATS[0][0], 1);
  return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
  const pg = normPg(arg && arg.page);
  const tid = normId(arg && arg.id) || "creampie";
  const items = await catalog(tid, pg);
  return {items: items, hasMore: items.length > 0};
}

async function search(arg) {
  const keyword = str(arg && arg.keyword);
  const pg = normPg(arg && arg.page);
  if (!keyword) return {items: [], hasMore: false};
  const url = HOST + "/?s=" + encodeURIComponent(keyword);
  const html = await httpGet(url, HOST + "/");
  return {items: parseCards(html).slice(0, 60), hasMore: false, page: pg};
}

async function detail(arg) {
  const nid = normId(arg && arg.id);
  if (!nid) return {id: "", title: "", cover: "", desc: "", tags: [], lines: []};
  const pageUrl = nid.startsWith("http") ? nid : HOST + "/" + nid.replace(/^\/+|\/+$/g, "") + "/";
  const html = await httpGet(pageUrl, HOST + "/");
  if (!html) return {id: pageUrl, title: pageUrl, cover: "", desc: "", tags: [], lines: []};
  let title = metaValue(html, "property", "og:title");
  const i = title.indexOf(" - JAVMIT");
  if (i >= 0) title = title.slice(0, i).trim();
  if (!title) return {id: pageUrl, title: pageUrl, cover: "", desc: "", tags: [], lines: []};
  const cover = detailCover(html);
  const descText = trunc(metaValue(html, "name", "description"), 400);
  const duration = videoDuration(html);
  const parts = [];
  if (descText) parts.push(descText);
  if (duration) parts.push("时长：" + duration);
  const playTitle = trunc(title, 60);
  return {
    id: pageUrl,
    title: title,
    cover: cover,
    desc: parts.join("\n"),
    duration: duration,
    remarks: duration,
    tags: [],
    lines: [{name: "在线播放", episodes: [{id: pageUrl, name: playTitle}]}],
  };
}

async function resolveMaster(url, headers) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await host.http.get(url, {headers: headers, timeout: TIMEOUT});
      const text = resp && resp.body ? String(resp.body) : "";
      if (!text) continue;
      if (text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
      const lines = text.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.length > 0);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].charAt(0) !== "#") return host.url.resolve(url, lines[j]);
          }
        }
      }
      return url;
    } catch (e) {
      // retry, then fall back to the master url
    }
  }
  return url;
}

async function play(arg) {
  let raw = normId((arg && arg.episodeId) || (arg && arg.id));
  if (raw.indexOf(".m3u8") >= 0) {
    return {
      streams: [{url: raw, format: "hls", headers: {"User-Agent": UA, "Referer": HOST + "/"}, name: "JAVMIT"}],
      expiresAt: Date.now() + 3600 * 1000,
    };
  }
  const pageUrl = raw.split("$").pop().trim();
  if (!pageUrl) throw new Error("invalid play id");
  const html = await httpGet(pageUrl, HOST + "/");
  let m3u8 = "";
  if (html) {
    const m = /property="og:video" content="([^"]+\.m3u8[^"]*)"/.exec(html);
    if (m) m3u8 = m[1];
  }
  if (!m3u8) throw new Error("no stream found");
  const headers = {"User-Agent": UA, "Referer": pageUrl};
  const finalUrl = await resolveMaster(m3u8, headers);
  return {
    streams: [{url: finalUrl, format: "hls", headers: headers, name: "JAVMIT"}],
    expiresAt: Date.now() + 3600 * 1000,
  };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
