// VJAV — idj1 插件（由 TVBox 蜘蛛 vjav.py v2 改写，2026-10-22 摸站，2026-11-24 复核）
// 站点：https://vjav.com（Vue SPA，全走 JSON 接口，无盾、无加密、无付费墙）
// 列表：/api/json/videos2；详情：/api/json/video；播放：/api/videofile.php
// 取 is_default 项的 video_url，站方自定义字母表 base64 变体解码（字母表下标
// 0/1/2/4/12 是西里尔同形字母 А/В/С/Е/М）→ https://vjav.com/get_file/..._hq.mp4
// 直链 MP4（签名 ti 约 24 小时有效，详情只放观看页地址，点播时现取现解）。
//
// 相对原蜘蛛丢掉 / 降级的能力：
// - 标题/女优名中文化不做：原蜘蛛走 Google 翻译批量接口，idj 侧无翻译服务，
//   且每页一译会烧掉 host 60 次/调用的请求预算；标题与女优名保留站方英文
//   原文，分类名保留 py 的中文映射（CATS_ZH）。
// - 分类不用实时拉取：home() 只取 1 次最新列表，分类用 2026-11-24 live
//   快照（157 个，去 jav-uncensored 后 156 个 + 6 个固定分类 = 162 个）；
//   站方新增分类（本次快照比 py 多 1 个 gothic）要等插件更新才进。
// - 女优索引 / 播放列表原来是 CatVod 的 vod_tag:"folder" 文件夹语义，idj
//   无文件夹原语——改成：分类里点开女优/播放列表后进详情页，详情页只有
//   一条线路「作品」（分集即该女优/播放列表第 1 页视频）；只取第 1 页，
//   不翻页（与 HQPorner 女优先例同款）。
// - 详情里的 pv 预告片（_tr.mp4，约 190KB）绝不能当正片，插件不取它。
// - 搜索短词限制如实透传：关键词少于 2 字符站方回 videos_not_found，插件
//   回空列表，不伪造结果。

const SITE = "https://vjav.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TIMEOUT = 20000;
const PAGE_SIZE = 24;
const MODELS_PAGE_SIZE = 40;

const FIXED = [
    ["latest", "最新视频", "latest-updates"],
    ["toprated", "最佳视频", "top-rated"],
    ["popular", "热门视频", "most-popular"],
    ["uncensored", "无码专区", ""],
    ["models", "女优索引", ""],
    ["playlists", "播放列表", ""],
];

// VJAV 分类快照：2026-11-24 live /api/json/categories 实测 157 个（去 jav-uncensored 后 156 个）
// 名称优先用 vjav.py 的 CATS_ZH 中文名，无中文名时用站方英文 title。
const CATS = [
    ["asian", "亚洲人"],
    ["japanese", "日本"],
    ["hd", "HD"],
    ["jav-censored", "日本AV截尾"],
    ["brunette", "黑发美女"],
    ["big-tits", "大奶"],
    ["female-orgasm", "女性高潮"],
    ["blowjob", "口交"],
    ["compilation", "合辑"],
    ["milf", "欠干辣妈"],
    ["hairy", "浓毛"],
    ["amateur", "素人自拍"],
    ["lingerie", "性感内衣"],
    ["creampie", "体内射精"],
    ["pov", "第一人称视角"],
    ["dildos-toys", "假阴茎和性爱玩具"],
    ["college2", "青少年(18+)"],
    ["fetish", "恋物"],
    ["deep-throat", "深喉"],
    ["big-butt", "大屁股"],
    ["jav-idols", "日本AV偶像"],
    ["handjob", "手淫"],
    ["cumshots", "射精"],
    ["cunnilingus", "舔阴"],
    ["mature", "熟女"],
    ["step-fantasy", "继亲幻想"],
    ["pantyhose", "丝袜"],
    ["threesomes", "三人行"],
    ["fingering", "指交"],
    ["Oldie", "老人"],
    ["hardcore", "硬调色情"],
    ["bbw", "丰满大美女"],
    ["big-dick", "大鸡巴"],
    ["group-sex", "群交"],
    ["small-tits", "贫乳"],
    ["lesbian", "女同"],
    ["public", "公共场所"],
    ["bdsm", "虐恋"],
    ["wife", "妻子"],
    ["anal", "肛交"],
    ["babes", "宝贝"],
    ["facial", "射精在脸上"],
    ["massage", "按摩"],
    ["gangbang", "群交"],
    ["bandages-houtai", "绷带"],
    ["masturbate", "自慰"],
    ["titty-fucking-paizuri", "山雀之间鸡巴"],
    ["squirting", "潮吹"],
    ["casting", "试镜"],
    ["cuckold", "妻子外遇"],
    ["bathroom", "浴室"],
    ["solo-girl", "自慰"],
    ["outdoor", "户外"],
    ["doggy-style", "老汉推车"],
    ["redhead", "红头发"],
    ["college", "大学"],
    ["voyeur", "窥淫"],
    ["interracial", "跨种族"],
    ["couple", "夫妇"],
    ["foot-fetish", "恋足癖"],
    ["cosplay", "角色扮演"],
    ["pissing", "小便"],
    ["reality", "现实"],
    ["office-lady-oh-el", "办公室"],
    ["bukkake", "颜射"],
    ["teacher-sensei", "性爱教师"],
    ["blonde", "金发女郎"],
    ["showers", "淋浴"],
    ["dp", "双龙入洞"],
    ["femdom", "女王扮演"],
    ["rimming", "舔肛"],
    ["big-natural-tits", "天然巨乳"],
    ["shaved", "刮毛"],
    ["natural-tits", "天然女性乳房"],
    ["breast-play-oppaifechi", "乳房玩"],
    ["skinny", "娇小"],
    ["bikini", "ビキニ"],
    ["tattoos", "纹身"],
    ["fisting", "拳交"],
    ["close-up", "特写"],
    ["panties", "女性内裤"],
    ["korean", "韩国"],
    ["webcam", "网络摄像头"],
    ["strapon", "捆绑"],
    ["nurse-naasu", "看護師"],
    ["slave", "奴隶"],
    ["upskirts", "裙底风光"],
    ["swallow", "吞精"],
    ["domination", "支配"],
    ["medical", "医疗人员"],
    ["69", "69"],
    ["vintage", "经典老片"],
    ["hidden-cams", "隐藏摄像机"],
    ["face-sitting", "坐脸"],
    ["pregnant", "孕妇"],
    ["nipples", "乳头"],
    ["secretary", "秘书"],
    ["softcore", "软色情"],
    ["party", "派对"],
    ["maid-meido", "女佣"],
    ["girlfriend", "女朋友"],
    ["cougar", "欲望熟女"],
    ["muscular-man", "肌肉男"],
    ["pick-up-nanpa", "即兴性爱"],
    ["gagging", "作呕"],
    ["striptease", "脱衣舞"],
    ["car", "汽车"],
    ["celebrities", "名人"],
    ["high-heels", "高跟鞋"],
    ["swimsuit-mizugi", "泳装"],
    ["bus", "公车痴汉"],
    ["shibari-bondage", "日式绑缚"],
    ["chinese", "中国人"],
    ["latex", "乳胶紧身衣"],
    ["handcuffs", "手铐"],
    ["business-woman", "办公室女郎"],
    ["sports", "运动"],
    ["kimono", "和服"],
    ["beach", "ビーチ"],
    ["foot-job-ashifechi", "足交"],
    ["grannies", "老奶奶"],
    ["soap-play-soopufechi", "肥皂"],
    ["cfnm", "衣女裸男"],
    ["device-bondage", "器械束缚"],
    ["spanking", "打屁股"],
    ["changing-room", "更衣室"],
    ["behind-the-scenes", "幕后花絮"],
    ["mistress", "女主人"],
    ["fake-tits", "假奶"],
    ["hanging", "悬吊"],
    ["yoga", "瑜伽"],
    ["european", "欧洲人"],
    ["gym-reotaado", "健身房"],
    ["fishnet", "渔网"],
    ["submissive", "顺从"],
    ["swingers", "交换伴侣"],
    ["kitchen", "厨房"],
    ["cat-fights", "女女打架"],
    ["funny", "有趣的"],
    ["fucking-machines", "性爱机器"],
    ["whipping", "鞭打"],
    ["medium-tits", "大乳头"],
    ["cheerleaders", "啦啦队"],
    ["glory-hole", "偷窥孔"],
    ["pegging", "假阳具"],
    ["joint-fucking-wakifechi", "共同性爱"],
    ["live-shows", "现场表演"],
    ["bisexual", "双性恋"],
    ["smoking", "吸烟"],
    ["interview", "访问"],
    ["race-queen-reesu-kuiin", "赛车女郎"],
    ["shaving-manko-teimou", "刮"],
    ["bar", "酒吧"],
    ["hogtied", "四马绑缚"],
    ["russian", "俄罗斯人"],
    ["gothic", "Gothic"],
];

function str(value) {
    if (value == null) return "";
    return String(value);
}

function absUrl(url, base) {
    const value = str(url).trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (/^\/\//.test(value)) return "https:" + value;
    if (/^\//.test(value)) return base.replace(/\/+$/, "") + value;
    return base.replace(/\/+$/, "") + "/" + value;
}

function cleanText(value) {
    return str(value)
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

function firstMatch(text, regex, index) {
    const match = regex.exec(text || "");
    return match ? str(match[index == null ? 1 : index]) : "";
}

async function fetchJson(path) {
    const url = path.indexOf("http") === 0 ? path : SITE + path;
    const resp = await host.http.request({
        url: url,
        method: "GET",
        headers: {"User-Agent": UA, "Accept": "application/json, */*", "Referer": SITE + "/"},
        timeout: TIMEOUT,
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error("HTTP " + resp.status);
    const body = resp.body == null ? "" : String(resp.body);
    return JSON.parse(body);
}

function videosPath(sort, count, section, oid, page) {
    return "/api/json/videos2/86400/str/" + sort + "/" + count + "/" +
        section + "." + oid + "." + page + ".all...json";
}

async function fetchVideos(section, oid, page, sort) {
    const data = await fetchJson(videosPath(sort || "latest-updates", PAGE_SIZE, section, oid, page));
    return (data && typeof data === "object") ? data : {};
}

function videoCard(v) {
    const vid = str(v.video_id || "");
    return {
        id: vid,
        title: v.title || vid,
        cover: v.scr || "",
        remarks: v.duration || "",
        duration: v.duration || "",
        tags: [],
    };
}

function videoItems(data) {
    const out = [];
    const videos = (data && data.videos) || [];
    for (const v of videos) {
        if (v && v.video_id) out.push(videoCard(v));
    }
    return out;
}

function pageTotal(data) {
    let total = 0;
    try { total = parseInt(data.total_count || "0", 10) || 0; } catch (error) { total = 0; }
    return total;
}

// 自定义字母表 base64 变体解码（与站方前端 Download/Video 组件同算法）。
// 字母表 = 拉丁 base64 序（末尾 .,~ 代替 +/=），下标 0/1/2/4/12 是西里尔同形字母。
function decodeVideofileUrl(enc) {
    const base = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,~".split("");
    const cyr = {0: "А", 1: "В", 2: "С", 4: "Е", 12: "М"};
    for (const idx in cyr) base[idx] = cyr[idx];
    const alpha = base.join("");
    let clean = "";
    for (const ch of str(enc)) {
        if (alpha.indexOf(ch) >= 0) clean += ch;
    }
    function idxAt(pos) {
        if (pos >= clean.length) return 64;
        return alpha.indexOf(clean[pos]);
    }
    let out = "";
    let i = 0;
    while (i < clean.length) {
        const o = idxAt(i);
        const a = idxAt(i + 1);
        const b = idxAt(i + 2);
        const c = idxAt(i + 3);
        i += 4;
        if (o < 0 || a < 0) break;
        out += String.fromCharCode((o << 2) | (a >> 4));
        if (b !== 64 && b >= 0) out += String.fromCharCode(((15 & a) << 4) | (b >> 2));
        if (c !== 64 && c >= 0) out += String.fromCharCode(((3 & b) << 6) | c);
    }
    if (out.indexOf("%") >= 0) {
        try { out = decodeURIComponent(out); } catch (error) { /* 保持原样 */ }
    }
    return out;
}

function allCategories() {
    const list = [];
    for (const row of FIXED) list.push({id: row[0], name: row[1]});
    for (const row of CATS) list.push({id: "cat@@" + row[0], name: row[1]});
    return list;
}

function catNameByDir(dir) {
    for (const row of CATS) {
        if (row[0] === dir) return row[1];
    }
    return dir;
}

// ---------- idj1 契约 ----------

async function home() {
    let items = [];
    try {
        const data = await fetchVideos("", "", 1, "latest-updates");
        items = videoItems(data).slice(0, PAGE_SIZE);
    } catch (error) {
        items = [];
    }
    return {categories: allCategories(), items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, parseInt((arg && arg.page) || "1", 10) || 1);
    const tid = str(arg && arg.id);
    let items = [];
    let hasMore = false;
    try {
        if (tid === "models") {
            const data = await fetchJson("/api/json/models/86400/str/filt........../most-popular/" +
                MODELS_PAGE_SIZE + "/" + page + ".json");
            const models = data.models || [];
            for (const m of models) {
                if (!m.dir) continue;
                const stats = m.statistics || {};
                items.push({
                    id: "model@@" + m.dir,
                    title: m.title || m.dir,
                    cover: m.img || "",
                    remarks: (stats.videos || "") + " 部作品",
                    duration: "",
                    tags: [],
                });
            }
            const total = pageTotal(data);
            hasMore = total > page * MODELS_PAGE_SIZE;
        } else if (tid === "playlists") {
            const data = await fetchJson("/api/json/playlists/86400/most-popular/" +
                PAGE_SIZE + "/all." + page + ".str..json");
            const lists = data.playlists || [];
            for (const p of lists) {
                if (!p.playlist_id) continue;
                const thumbs = p.thumbs || [];
                const stats = p.statistics || {};
                items.push({
                    id: "playlist@@" + str(p.playlist_id),
                    title: p.title || str(p.playlist_id),
                    cover: thumbs.length ? thumbs[0] : "",
                    remarks: (stats.videos || "") + " 部视频",
                    duration: "",
                    tags: [],
                });
            }
            const total = pageTotal(data);
            hasMore = total > page * PAGE_SIZE;
        } else if (tid.indexOf("model@@") === 0) {
            const data = await fetchVideos("model", tid.slice(7), page, "latest-updates");
            items = videoItems(data);
            hasMore = items.length >= PAGE_SIZE;
        } else if (tid.indexOf("playlist@@") === 0) {
            const data = await fetchVideos("playlist", tid.slice(10), page, "latest-updates");
            items = videoItems(data);
            hasMore = items.length >= PAGE_SIZE;
        } else if (tid.indexOf("cat@@") === 0) {
            const data = await fetchVideos("categories", tid.slice(5), page, "latest-updates");
            items = videoItems(data);
            hasMore = items.length >= PAGE_SIZE;
        } else if (tid === "uncensored") {
            const data = await fetchVideos("categories", "jav-uncensored", page, "latest-updates");
            items = videoItems(data);
            hasMore = items.length >= PAGE_SIZE;
        } else if (tid === "latest" || tid === "toprated" || tid === "popular") {
            let sort = "latest-updates";
            for (const row of FIXED) {
                if (row[0] === tid) sort = row[2];
            }
            const data = await fetchVideos("", "", page, sort);
            items = videoItems(data);
            hasMore = items.length >= PAGE_SIZE;
        } else {
            const data = await fetchVideos("", "", page, "latest-updates");
            items = videoItems(data);
            hasMore = items.length >= PAGE_SIZE;
        }
    } catch (error) {
        items = [];
        hasMore = false;
    }
    return {items: items, hasMore: hasMore};
}

async function search(arg) {
    const page = Math.max(1, parseInt((arg && arg.page) || "1", 10) || 1);
    const keyword = str(arg && arg.keyword).trim();
    if (!keyword) return {items: [], hasMore: false};
    let items = [];
    let hasMore = false;
    try {
        const params = "86400/str/relevance/" + PAGE_SIZE + "/search.." + page + ".all...";
        const data = await fetchJson("/api/videos2.php?params=" + params + "&s=" + encodeURIComponent(keyword));
        if (data && !data.error) {
            items = videoItems(data);
            hasMore = items.length >= PAGE_SIZE;
        }
    } catch (error) {
        items = [];
    }
    return {items: items, hasMore: hasMore};
}

async function detail(arg) {
    const rawId = str(arg && arg.id);
    if (!rawId) throw new Error("无效的影片 ID");

    // 女优 / 播放列表文件夹：详情页只有一条线路「作品」，分集即第 1 页视频。
    if (rawId.indexOf("model@@") === 0 || rawId.indexOf("playlist@@") === 0) {
        const isModel = rawId.indexOf("model@@") === 0;
        const oid = isModel ? rawId.slice(7) : rawId.slice(10);
        let videos = [];
        try {
            const data = await fetchVideos(isModel ? "model" : "playlist", oid, 1, "latest-updates");
            videos = videoItems(data);
        } catch (error) {
            videos = [];
        }
        return {
            id: rawId,
            title: oid,
            cover: videos.length ? videos[0].cover : "",
            desc: "共 " + videos.length + " 部作品（第一页）",
            tags: [],
            lines: [{
                name: "作品",
                episodes: videos.map(function (v) { return {id: v.id, name: v.title}; }),
            }],
        };
    }

    const numMatch = /\d+/.exec(rawId);
    const vid = numMatch ? numMatch[0] : rawId;
    const n = parseInt(vid, 10) || 0;
    const bucket = Math.floor(n / 1000000) * 1000000 + "/" + Math.floor(n / 1000) * 1000;
    let v = null;
    try {
        const data = await fetchJson("/api/json/video/86400/" + bucket + "/" + vid + ".json");
        v = (data && data.video) || null;
    } catch (error) {
        v = null;
    }
    if (!v) {
        return {
            id: rawId, title: vid, cover: "", desc: "", tags: [],
            lines: [{name: "VJAV", episodes: [{id: vid, name: "播放"}]}],
        };
    }
    const cats = v.categories || {};
    const typeNames = [];
    for (const key in cats) {
        const c = cats[key] || {};
        typeNames.push(catNameByDir(c.dir || "") || c.title || "");
    }
    let actor = "";
    const models = v.models;
    const names = [];
    if (models && typeof models === "object") {
        for (const key in models) {
            const m = models[key] || {};
            if (m.title) names.push(m.title);
        }
    }
    if (!names.length) {
        const suggested = v.models_suggested || [];
        for (const s of suggested) {
            if (s) names.push(s);
        }
    }
    actor = names.join("、");
    const user = v.user || {};
    const watch = SITE + "/videos/" + vid + "/" + (v.dir || "") + "/";
    const desc = [v.description || "", actor ? "女优：" + actor : ""].filter(Boolean).join("\n");
    return {
        id: rawId,
        title: v.title || vid,
        cover: v.thumbsrc || v.thumb || "",
        desc: desc,
        duration: v.duration || "",
        tags: typeNames,
        lines: [{name: "VJAV", episodes: [{id: watch, name: "播放"}]}],
    };
}

async function play(arg) {
    const raw = str((arg && arg.id) || (arg && arg.episodeId));
    if (!raw) throw new Error("无效的播放地址");
    if (/get_file/i.test(raw) || /\.mp4(\?|$)/i.test(raw.split("?")[0])) {
        return {
            streams: [{
                url: raw, format: "mp4",
                headers: {"User-Agent": UA, "Referer": SITE + "/"},
                name: "VJAV",
            }],
        };
    }
    const m = /\/videos\/(\d+)/.exec(raw) || /^(\d+)$/.exec(raw.trim());
    const vid = m ? m[1] : "";
    if (!vid) throw new Error("无效的播放地址");
    const data = await fetchJson("/api/videofile.php?video_id=" + vid + "&lifetime=8640000");
    const entries = Array.isArray(data) ? data : [];
    let chosen = null;
    for (const e of entries) {
        if (str(e.is_default) === "1") { chosen = e; break; }
    }
    if (!chosen && entries.length) chosen = entries[0];
    if (!chosen || !chosen.video_url) throw new Error("未找到可用播放地址");
    const decoded = decodeVideofileUrl(chosen.video_url);
    if (!decoded) throw new Error("未找到可用播放地址");
    const url = decoded.indexOf("http") === 0 ? decoded : SITE + decoded;
    return {
        streams: [{
            url: url, format: "mp4",
            headers: {"User-Agent": UA, "Referer": SITE + "/"},
            name: "VJAV",
        }],
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
