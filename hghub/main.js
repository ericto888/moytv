// HGhub — idj1 plugin (rewritten 1:1 from the builtin py spider hghub)
// Site: https://huangguoai.com (HGhub)
// Plain JSON API for lists/detail/search. Playback goes through the
// site's encrypted playback session (ECDH P-256 + HKDF-SHA256 +
// AES-256-GCM, protocol dx150-edge-v1), reimplemented here in pure JS
// exactly as the py spider does, with the plain /play endpoint as the
// fallback for video episodes (same order as the py spider).
// Covers: pic.qnlycc.cn returns AES-128-CBC encrypted bytes, not a plain
// image (verified 2026-11-26: a full fetch decrypted with the py key/iv
// yields a real JPEG). The py spider decrypts them in its local proxy;
// the plugin host only offers text http with no binary image transform,
// so the raw cover URL from the API is returned as-is and the client
// may not be able to render covers. Lists/detail/play are unaffected.

const BASE = "https://huangguoai.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 60000;
const RETRY = 3;

const CATS = [
    ["ai-duanju", "AI成人短剧"],
    ["ai-manju", "AI成人漫剧"],
    ["ai-huanlian", "AI换脸"],
    ["ai-mogai", "AI魔改"],
    ["chigua", "黄果吃瓜"],
];

// ---------------- byte / text helpers ----------------

function utf8Encode(s) {
    const out = [];
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
        let cp = str.charCodeAt(i);
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
            const lo = str.charCodeAt(i + 1);
            if (lo >= 0xdc00 && lo <= 0xdfff) {
                cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
                i++;
            }
        }
        if (cp < 0x80) out.push(cp);
        else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
        else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return out;
}

function utf8Decode(bytes) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
        const b = bytes[i];
        let cp, n;
        if (b < 0x80) { cp = b; n = 1; }
        else if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; n = 2; }
        else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; n = 3; }
        else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; n = 4; }
        else { cp = 0xfffd; n = 1; }
        if (n > 1) {
            let ok = i + n <= bytes.length;
            for (let j = 1; j < n && ok; j++) if ((bytes[i + j] & 0xc0) !== 0x80) ok = false;
            if (!ok) { cp = 0xfffd; n = 1; }
            else for (let j = 1; j < n; j++) cp = (cp << 6) | (bytes[i + j] & 0x3f);
        }
        i += n;
        if (cp > 0xffff) {
            cp -= 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        } else out += String.fromCharCode(cp);
    }
    return out;
}

const B64A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64EncodeBytes(bytes, urlSafe) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        out += B64A[a >> 2];
        out += B64A[((a & 3) << 4) | (b >> 4)];
        out += i + 1 < bytes.length ? B64A[((b & 15) << 2) | (c >> 6)] : "=";
        out += i + 2 < bytes.length ? B64A[c & 63] : "=";
    }
    if (urlSafe) out = out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return out;
}

function b64DecodeBytes(s) {
    const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/").replace(/[\s\r\n\t]/g, "");
    const rev = {};
    for (let i = 0; i < 64; i++) rev[B64A[i]] = i;
    const out = [];
    let acc = 0, bits = 0;
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (ch === "=") break;
        const v = rev[ch];
        if (v === undefined) continue;
        acc = (acc << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push((acc >> bits) & 0xff);
        }
    }
    return out;
}

function hexToBytes(hex) {
    const out = [];
    const t = String(hex || "");
    for (let i = 0; i + 1 < t.length; i += 2) out.push(parseInt(t.substr(i, 2), 16));
    return out;
}

// ---------------- SHA-256 (pure JS) ----------------

const SHAK = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Bytes(msg) {
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const data = msg.slice();
    const bitLenHi = Math.floor(msg.length / 0x20000000);
    const bitLenLo = (msg.length << 3) >>> 0;
    data.push(0x80);
    while (data.length % 64 !== 56) data.push(0);
    data.push((bitLenHi >>> 24) & 0xff, (bitLenHi >>> 16) & 0xff, (bitLenHi >>> 8) & 0xff, bitLenHi & 0xff);
    data.push((bitLenLo >>> 24) & 0xff, (bitLenLo >>> 16) & 0xff, (bitLenLo >>> 8) & 0xff, bitLenLo & 0xff);
    const w = new Array(64);
    function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) | 0; }
    for (let off = 0; off < data.length; off += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = ((data[off + i * 4] << 24) | (data[off + i * 4 + 1] << 16) | (data[off + i * 4 + 2] << 8) | data[off + i * 4 + 3]) | 0;
        }
        for (let i = 16; i < 64; i++) {
            const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) | 0;
            const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) | 0;
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let a = H[0] | 0, b = H[1] | 0, c = H[2] | 0, d = H[3] | 0, e = H[4] | 0, f = H[5] | 0, g = H[6] | 0, h = H[7] | 0;
        for (let i = 0; i < 64; i++) {
            const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) | 0;
            const ch = ((e & f) ^ (~e & g)) | 0;
            const t1 = (h + S1 + ch + SHAK[i] + w[i]) | 0;
            const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) | 0;
            const maj = ((a & b) ^ (a & c) ^ (b & c)) | 0;
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    const out = [];
    for (let i = 0; i < 8; i++) out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff);
    return out;
}

function hmacSha256(key, data) {
    let k = key.slice();
    if (k.length > 64) k = sha256Bytes(k);
    while (k.length < 64) k.push(0);
    const ipad = k.map((b) => b ^ 0x36);
    const opad = k.map((b) => b ^ 0x5c);
    return sha256Bytes(opad.concat(sha256Bytes(ipad.concat(data))));
}

function hkdfSha256(salt, ikm, info) {
    const prk = hmacSha256(salt, ikm);
    return hmacSha256(prk, info.concat([1]));
}

// ---------------- AES-256 encrypt block (pure JS, ported from py) ----------------

const SBOX = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
];
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function gmul(a, b) {
    let p = 0;
    for (let i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        const hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x1b;
        b >>= 1;
    }
    return p;
}
const GM2 = [], GM3 = [];
for (let i = 0; i < 256; i++) { GM2.push(gmul(i, 2)); GM3.push(gmul(i, 3)); }

function expand256(key) {
    const w = [];
    for (let i = 0; i < 8; i++) w.push(key.slice(i * 4, i * 4 + 4));
    for (let i = 8; i < 60; i++) {
        let t = w[i - 1].slice();
        if (i % 8 === 0) t = [SBOX[t[1]] ^ RCON[i / 8 - 1], SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
        else if (i % 8 === 4) t = [SBOX[t[0]], SBOX[t[1]], SBOX[t[2]], SBOX[t[3]]];
        const prev = w[i - 8];
        w.push([prev[0] ^ t[0], prev[1] ^ t[1], prev[2] ^ t[2], prev[3] ^ t[3]]);
    }
    return w;
}

function aes256EncryptBlock(block, w) {
    let s = [];
    for (let i = 0; i < 16; i++) s.push(block[i] ^ w[(i / 4) | 0][i % 4]);
    for (let rnd = 1; rnd < 14; rnd++) {
        s = s.map((b) => SBOX[b]);
        s = [s[0], s[5], s[10], s[15], s[4], s[9], s[14], s[3], s[8], s[13], s[2], s[7], s[12], s[1], s[6], s[11]];
        const out = new Array(16);
        for (let c = 0; c < 4; c++) {
            const col = s.slice(c * 4, c * 4 + 4);
            out[c * 4 + 0] = GM2[col[0]] ^ GM3[col[1]] ^ col[2] ^ col[3];
            out[c * 4 + 1] = col[0] ^ GM2[col[1]] ^ GM3[col[2]] ^ col[3];
            out[c * 4 + 2] = col[0] ^ col[1] ^ GM2[col[2]] ^ GM3[col[3]];
            out[c * 4 + 3] = GM3[col[0]] ^ col[1] ^ col[2] ^ GM2[col[3]];
        }
        s = out;
        for (let i = 0; i < 16; i++) s[i] ^= w[rnd * 4 + ((i / 4) | 0)][i % 4];
    }
    s = s.map((b) => SBOX[b]);
    s = [s[0], s[5], s[10], s[15], s[4], s[9], s[14], s[3], s[8], s[13], s[2], s[7], s[12], s[1], s[6], s[11]];
    for (let i = 0; i < 16; i++) s[i] ^= w[56 + ((i / 4) | 0)][i % 4];
    return s;
}

// ---------------- AES-256-GCM (ported from py) ----------------

function bytesToBig(bytes) {
    let v = 0n;
    for (let i = 0; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]);
    return v;
}
function bigToBytes(v, n) {
    const out = new Array(n);
    for (let i = n - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
    return out;
}

function ghash(hBytes, aad, ct) {
    function pad(b) {
        const out = b.slice();
        while (out.length % 16 !== 0) out.push(0);
        return out;
    }
    function mul128(x, y) {
        let z = 0n, v = y;
        for (let i = 0; i < 128; i++) {
            if ((x >> BigInt(127 - i)) & 1n) z ^= v;
            if (v & 1n) v = (v >> 1n) ^ 0xe1000000000000000000000000000000n;
            else v >>= 1n;
        }
        return z;
    }
    let data = pad(aad).concat(pad(ct));
    const lens = new Array(16).fill(0);
    let aBits = BigInt(aad.length) * 8n, cBits = BigInt(ct.length) * 8n;
    for (let i = 0; i < 8; i++) {
        lens[7 - i] = Number(aBits & 0xffn); aBits >>= 8n;
        lens[15 - i] = Number(cBits & 0xffn); cBits >>= 8n;
    }
    data = data.concat(lens);
    const hint = bytesToBig(hBytes);
    let y = 0n;
    for (let off = 0; off < data.length; off += 16) {
        y = mul128(y ^ bytesToBig(data.slice(off, off + 16)), hint);
    }
    return bigToBytes(y, 16);
}

function gcmCrypt(key, iv, aad, data) {
    const w = expand256(key);
    const j0 = iv.concat([0, 0, 0, 1]);
    const out = [];
    let ctr = 2;
    for (let off = 0; off < data.length; off += 16) {
        const ctrBytes = [(ctr >>> 24) & 0xff, (ctr >>> 16) & 0xff, (ctr >>> 8) & 0xff, ctr & 0xff];
        const ks = aes256EncryptBlock(iv.concat(ctrBytes), w);
        const blk = data.slice(off, off + 16);
        for (let i = 0; i < blk.length; i++) out.push(blk[i] ^ ks[i]);
        ctr++;
    }
    return {ct: out, w: w, j0: j0};
}

function gcmEncrypt(key, iv, aad, data) {
    const r = gcmCrypt(key, iv, aad, data);
    const h = aes256EncryptBlock(new Array(16).fill(0), r.w);
    const s = ghash(h, aad, r.ct);
    const ej0 = aes256EncryptBlock(r.j0, r.w);
    const tag = s.map((b, i) => b ^ ej0[i]);
    return {ct: r.ct, tag: tag};
}

function gcmDecrypt(key, iv, aad, ct, tag) {
    const w = expand256(key);
    const h = aes256EncryptBlock(new Array(16).fill(0), w);
    const j0 = iv.concat([0, 0, 0, 1]);
    const s = ghash(h, aad, ct);
    const ej0 = aes256EncryptBlock(j0, w);
    const expect = s.map((b, i) => b ^ ej0[i]);
    let same = expect.length === tag.length;
    for (let i = 0; i < expect.length && i < tag.length; i++) if (expect[i] !== tag[i]) same = false;
    if (!same) throw new Error("gcm tag mismatch");
    const out = [];
    let ctr = 2;
    for (let off = 0; off < ct.length; off += 16) {
        const ctrBytes = [(ctr >>> 24) & 0xff, (ctr >>> 16) & 0xff, (ctr >>> 8) & 0xff, ctr & 0xff];
        const ks = aes256EncryptBlock(iv.concat(ctrBytes), w);
        const blk = ct.slice(off, off + 16);
        for (let i = 0; i < blk.length; i++) out.push(blk[i] ^ ks[i]);
        ctr++;
    }
    return out;
}

// ---------------- EC P-256 (BigInt, ported from py) ----------------

const P256_P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
const P256_A = P256_P - 3n;
const P256_G = [BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
                BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")];
const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

function modPow(base, exp, mod) {
    let result = 1n;
    let b = ((base % mod) + mod) % mod;
    let e = exp;
    while (e > 0n) {
        if (e & 1n) result = (result * b) % mod;
        b = (b * b) % mod;
        e >>= 1n;
    }
    return result;
}
function modInv(a, mod) { return modPow(a, mod - 2n, mod); }
function modP(x) { return ((x % P256_P) + P256_P) % P256_P; }

function ecAdd(p1, p2) {
    if (p1 === null) return p2;
    if (p2 === null) return p1;
    const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
    if (x1 === x2 && modP(y1 + y2) === 0n) return null;
    let lam;
    if (x1 === x2 && y1 === y2) lam = modP((3n * x1 * x1 + P256_A) * modInv(2n * y1, P256_P));
    else lam = modP((y2 - y1) * modInv(x2 - x1, P256_P));
    const x3 = modP(lam * lam - x1 - x2);
    const y3 = modP(lam * (x1 - x3) - y1);
    return [x3, y3];
}

function ecMul(k, pt) {
    let r = null;
    let p = pt;
    let kk = k;
    while (kk > 0n) {
        if (kk & 1n) r = ecAdd(r, p);
        p = ecAdd(p, p);
        kk >>= 1n;
    }
    return r;
}

// ---------------- HTTP ----------------

function str(value) {
    if (value == null) return "";
    return String(value).trim();
}

function intValue(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
}

async function httpRaw(method, url, bodyStr, headers) {
    let lastErr = null;
    for (let attempt = 0; attempt < RETRY; attempt++) {
        try {
            const resp = await host.http.request({
                url: url, method: method, body: bodyStr || "",
                headers: headers || {}, timeout: TIMEOUT,
            });
            if (resp && (resp.status === 200 || resp.status === 206) && resp.body) {
                return resp.body;
            }
            if (resp && resp.body) return resp.body;
            lastErr = new Error("empty response status " + (resp ? resp.status : "?"));
        } catch (error) {
            lastErr = error;
        }
    }
    if (lastErr) throw lastErr;
    return "";
}

async function httpGetText(url) {
    try {
        return await httpRaw("GET", url, "", {
            "User-Agent": UA, "Accept": "application/json", "Referer": BASE + "/",
        });
    } catch (error) {
        return "";
    }
}

async function apiGet(path) {
    const text = await httpGetText(BASE + path);
    if (!text) return {};
    let data;
    try { data = JSON.parse(text); } catch (error) { return {}; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    if (data.status !== undefined && data.status !== null && data.status !== 1) return {};
    if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) return data.data;
    return data;
}

async function postJsonRaw(url, obj) {
    const bodyStr = JSON.stringify(obj);
    const text = await httpRaw("POST", url, bodyStr, {
        "User-Agent": UA,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Referer": BASE + "/",
    });
    if (!text) throw new Error("empty post response");
    return JSON.parse(text);
}

// ---------------- encrypted playback session (dx150-edge-v1) ----------------

const ENC_PROTO = "dx150-edge-v1";
const ENC_SCOPE = "playback";
let encSessionCache = null;

async function newEncSession() {
    const randHex = host.crypto.randomHex(32);
    const d = (bytesToBig(hexToBytes(randHex)) % (P256_N - 1n)) + 1n;
    const q = ecMul(d, P256_G);
    const pub = [4].concat(bigToBytes(q[0], 32), bigToBytes(q[1], 32));
    const hello = await postJsonRaw(BASE + "/api/playback/request", {
        v: 1, type: "hello", client_pub: b64EncodeBytes(pub, true),
    });
    if (!hello || hello.v !== 1 || hello.type !== "hello") throw new Error("bad hello");
    const sess = {
        kid: hello.kid, sid: hello.sid, site: hello.site,
        seq: 0, base: BASE,
    };
    const salt = b64DecodeBytes(hello.salt);
    const srv = b64DecodeBytes(hello.server_pub);
    if (salt.length !== 32 || srv.length !== 65 || srv[0] !== 4) throw new Error("bad hello keys");
    const sx = bytesToBig(srv.slice(1, 33));
    const sy = bytesToBig(srv.slice(33, 65));
    const shared = ecMul(d, [sx, sy]);
    const secret = bigToBytes(shared[0], 32);
    sess.info = [ENC_PROTO, ENC_SCOPE, sess.site, sess.kid, sess.sid].join("\n");
    sess.reqKey = hkdfSha256(salt, secret, utf8Encode(sess.info + "\nreq"));
    sess.resKey = hkdfSha256(salt, secret, utf8Encode(sess.info + "\nres"));
    const nowSec = Math.floor(Date.now() / 1000);
    sess.clockOff = intValue(hello.server_time, nowSec) - nowSec;
    sess.expires = nowSec + (intValue(hello.expires_at, nowSec) - intValue(hello.server_time, nowSec)) - 10;
    return sess;
}

async function getEncSession() {
    const nowSec = Math.floor(Date.now() / 1000);
    if (encSessionCache && nowSec < encSessionCache.expires && encSessionCache.seq < 16000) {
        return encSessionCache;
    }
    let sess = null;
    for (let attempt = 0; attempt < 2 && !sess; attempt++) {
        try { sess = await newEncSession(); } catch (error) { sess = null; }
    }
    if (!sess) return null;
    encSessionCache = sess;
    return sess;
}

async function encCallOnce(sess, method, path, bodyBytes, ctype) {
    sess.seq += 1;
    const seq = sess.seq;
    const ts = Math.floor(Date.now() / 1000) + sess.clockOff;
    const iv = [0, 0, 0, 0, 0, 0, 0, 0, (seq >>> 24) & 0xff, (seq >>> 16) & 0xff, (seq >>> 8) & 0xff, seq & 0xff];
    const aadReq = utf8Encode(sess.info + "\nreq\n" + seq + "\n" + ts);
    const aadRes = utf8Encode(sess.info + "\nres\n" + seq + "\n" + ts);
    const pkt = {
        method: method, path: path,
        body: b64EncodeBytes(bodyBytes || [], false),
        content_type: ctype || "",
    };
    const plain = utf8Encode(JSON.stringify({request: pkt}));
    const enc = gcmEncrypt(sess.reqKey, iv, aadReq, plain);
    const res = await postJsonRaw(BASE + "/api/playback/request", {
        v: 1, type: "call", kid: sess.kid, sid: sess.sid,
        seq: seq, ts: ts, ciphertext: b64EncodeBytes(enc.ct.concat(enc.tag), true),
    });
    if (!res || res.v !== 1 || res.type !== "result") throw new Error("bad result");
    if (res.sid !== sess.sid || res.kid !== sess.kid) throw new Error("session mismatch");
    if (res.seq !== seq || res.ts !== ts) throw new Error("seq mismatch");
    const raw = b64DecodeBytes(res.ciphertext);
    const innerText = utf8Decode(gcmDecrypt(sess.resKey, iv, aadRes, raw.slice(0, raw.length - 16), raw.slice(raw.length - 16)));
    const inner = JSON.parse(innerText);
    if (inner.status !== 200) return {};
    const bodyB64 = inner.body || "";
    if (!bodyB64) return {};
    try {
        return JSON.parse(utf8Decode(b64DecodeBytes(bodyB64)));
    } catch (error) {
        return {};
    }
}

async function encCall(method, path, bodyBytes, ctype) {
    let sess = await getEncSession();
    if (!sess) return {};
    try {
        return await encCallOnce(sess, method, path, bodyBytes, ctype);
    } catch (error) {
        encSessionCache = null;
        sess = await getEncSession();
        if (!sess) return {};
        try {
            return await encCallOnce(sess, method, path, bodyBytes, ctype);
        } catch (error2) {
            return {};
        }
    }
}

async function playVideoEnc(vid, ep) {
    try {
        const data = await encCall("POST",
            "/api/videos/" + encodeURIComponent(vid) + "/episodes/" + encodeURIComponent(ep) + "/playback",
            [], "");
        const inner = (data && data.data) || {};
        const streams = inner.streams || {};
        return str(streams.main || streams.preview || streams.hevc || "");
    } catch (error) {
        return "";
    }
}

async function playPostEnc(pid) {
    try {
        const data = await encCall("POST",
            "/api/posts/" + encodeURIComponent(pid) + "/playback", [], "");
        const inner = (data && data.data) || {};
        const videos = inner.videos || [];
        if (videos.length && videos[0] && typeof videos[0] === "object") return str(videos[0].url || "");
        return "";
    } catch (error) {
        return "";
    }
}

// ---------------- cards (same mapping as py) ----------------

function fixPic(raw) {
    const u = str(raw);
    if (!u) return "";
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASE + u;
    return u;
}

function card(item) {
    if (!item || typeof item !== "object") return null;
    if (item.id === undefined || item.id === null) return null;
    const title = str(item.title);
    if (!title) return null;
    const ep = intValue(item.episode_count, 0);
    let remarks = "";
    if (ep) remarks = ep + "集";
    const score = item.score;
    if (score !== undefined && score !== null && score !== "" && score !== 0 && score !== "0") {
        remarks = (remarks ? remarks + " " : "") + score + "分";
    }
    const created = str(item.created_at);
    if (created.length >= 4) remarks = (remarks ? remarks + " " : "") + created.slice(0, 4);
    const out = {id: String(item.id), title: title, remarks: remarks, tags: []};
    const pic = fixPic(item.cover || "");
    if (pic) out.cover = pic;
    const desc = str(item.description || "");
    if (desc) out.desc = desc.slice(0, 300);
    return out;
}

function postCard(item) {
    if (!item || typeof item !== "object") return null;
    if (item.id === undefined || item.id === null) return null;
    const title = str(item.title);
    if (!title) return null;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    let remarks = tags.length ? str(tags[0]) : "";
    const created = str(item.created_at);
    if (created.length >= 4) remarks = (remarks ? remarks + " " : "") + created.slice(0, 4);
    const out = {id: "post:" + item.id, title: title, remarks: remarks, tags: []};
    const pic = fixPic(item.cover || "");
    if (pic) out.cover = pic;
    const desc = str(item.desc || "");
    if (desc) out.desc = desc.slice(0, 300);
    return out;
}

function stripHtml(s) {
    let t = String(s || "").replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
    t = t.replace(/<[^>]+>/g, " ");
    t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");
    return t.replace(/\s+/g, " ").trim();
}

// ---------------- idj1 contract ----------------

async function home() {
    const categories = CATS.map((c) => ({id: c[0], name: c[1]}));
    const data = await apiGet("/api/videos?page=1&size=20");
    const items = [];
    for (const it of (data.items || [])) {
        const c = card(it);
        if (c) items.push(c);
    }
    return {categories: categories, items: items, hasMore: items.length > 0};
}

async function category(arg) {
    const page = Math.max(1, intValue(arg && arg.page, 1));
    const tid = str(arg && arg.id) || "ai-duanju";
    let data, items = [];
    if (tid === "chigua") {
        data = await apiGet("/api/posts?page=" + page + "&size=20");
        for (const it of (data.items || [])) {
            const c = postCard(it);
            if (c) items.push(c);
        }
    } else {
        data = await apiGet("/api/videos/category/" + encodeURIComponent(tid) + "?page=" + page + "&size=20");
        for (const it of (data.items || [])) {
            const c = card(it);
            if (c) items.push(c);
        }
    }
    const pages = intValue((data.pagination || {}).pages, 0);
    return {items: items, hasMore: pages ? page < pages : items.length >= 20};
}

async function search(arg) {
    const keyword = str(arg && arg.keyword);
    const page = Math.max(1, intValue(arg && arg.page, 1));
    if (!keyword) return {items: [], hasMore: false};
    const data = await apiGet("/api/search?q=" + encodeURIComponent(keyword) + "&page=" + page + "&size=20");
    const items = [];
    for (const it of (data.items || [])) {
        const c = card(it);
        if (c) items.push(c);
    }
    const pages = intValue((data.pagination || {}).pages, 0);
    return {items: items, hasMore: pages ? page < pages : items.length >= 20};
}

async function detail(arg) {
    const raw = arg && arg.id;
    const vid = str(Array.isArray(raw) ? raw[0] : raw);
    if (!vid) throw host.error("E_PARSE", "详情 id 为空");

    if (vid.startsWith("post:")) {
        const pid = vid.slice("post:".length);
        const data = await apiGet("/api/posts/" + encodeURIComponent(pid));
        if (!data || !data.title) throw host.error("E_NETWORK", "帖子详情取不到");
        let content = str(data.desc || "");
        if (!content) content = stripHtml(str(data.content || "")).slice(0, 1000);
        const tags = Array.isArray(data.tags) ? data.tags.map((t) => str(t)) : [];
        const out = {
            id: vid, title: str(data.title), desc: content,
            tags: tags.length ? tags : ["黄果吃瓜"],
            lines: [{name: "在线播放", episodes: [{id: "post:" + pid, name: "正片"}]}],
        };
        const pic = fixPic(data.cover || "");
        if (pic) out.cover = pic;
        return out;
    }

    const data = await apiGet("/api/videos/" + encodeURIComponent(vid));
    if (!data || !data.title) throw host.error("E_NETWORK", "视频详情取不到");
    const episodes = [];
    for (const ep of (data.episodes || [])) {
        if (!ep || typeof ep !== "object") continue;
        const num = intValue(ep.ep_num, 0);
        if (num < 1) continue;
        episodes.push({id: vid + ":" + num, name: "第" + num + "集"});
    }
    if (!episodes.length) episodes.push({id: vid + ":1", name: "第1集"});
    const crumbs = Array.isArray(data.breadcrumb) ? data.breadcrumb : [];
    const typename = crumbs.length && crumbs[0] ? str(crumbs[0].name || "") : "";
    const tags = Array.isArray(data.tags) ? data.tags.map((t) => str(t)).slice(0, 8) : [];
    if (typename && tags.indexOf(typename) < 0) tags.unshift(typename);
    const author = (data.author && typeof data.author === "object") ? str(data.author.name || "") : "";
    const created = str(data.created_at);
    const parts = [];
    const descText = str(data.description || "");
    if (descText) parts.push(descText);
    if (author) parts.push("作者：" + author);
    if (created) parts.push("发布：" + created);
    const score = data.score;
    const out = {
        id: vid, title: str(data.title), desc: parts.join("\n"),
        tags: tags,
        lines: [{name: "在线播放", episodes: episodes}],
    };
    if (score !== undefined && score !== null && score !== "" && score !== 0 && score !== "0") {
        out.remarks = String(score) + "分";
    }
    const pic = fixPic(data.cover || "");
    if (pic) out.cover = pic;
    return out;
}

async function resolveMaster(url, headers) {
    if (!/\.m3u8($|\?)/i.test(url)) return url;
    try {
        const text = await httpRaw("GET", url, "", headers);
        if (!text || text.indexOf("#EXT-X-STREAM-INF") < 0) return url;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
                for (let j = i + 1; j < lines.length; j++) {
                    const line = lines[j].trim();
                    if (line && line.charAt(0) !== "#") {
                        const variant = host.url.resolve(url, line);
                        if (variant.startsWith("https://")) return variant;
                        return url;
                    }
                }
            }
        }
    } catch (error) {
        // fall through with the master url
    }
    return url;
}

async function play(arg) {
    const raw = str((arg && arg.episodeId) || (arg && arg.id));
    if (!raw) throw host.error("E_PARSE", "播放 id 为空");
    const headers = {"User-Agent": UA, "Referer": BASE + "/"};
    let url = "";
    if (raw.startsWith("http") && (/\.m3u8/i.test(raw) || /\.mp4/i.test(raw))) {
        url = raw;
    } else if (raw.startsWith("post:")) {
        url = await playPostEnc(raw.slice("post:".length));
    } else if (/^\d+:\d+$/.test(raw)) {
        const parts = raw.split(":");
        url = await playVideoEnc(parts[0], parts[1]);
        if (!url) {
            const data = await apiGet("/api/videos/" + encodeURIComponent(parts[0]) +
                "/play?ep=" + encodeURIComponent(parts[1]) + "&page_texts=0");
            url = str(data.video_url || data.video_url_hevc || "");
        }
    } else if (raw.startsWith("http")) {
        url = raw;
    }
    if (!url) throw host.error("E_NETWORK", "未取到播放地址");
    if (!url.startsWith("https://")) throw host.error("E_PARSE", "播放地址不是 https：" + url.slice(0, 80));
    url = await resolveMaster(url, headers);
    const isHls = /\.m3u8($|\?)/i.test(url);
    return {
        streams: [{
            url: url,
            format: isHls ? "hls" : "mp4",
            headers: headers,
            name: "HGhub",
        }],
        expiresAt: Date.now() + 3600 * 1000,
    };
}

export default {home: home, category: category, search: search, detail: detail, play: play};
