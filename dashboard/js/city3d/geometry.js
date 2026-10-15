// Mesh arrays for the buildings (city3d/model.js entries): walls with facade attributes, flat caps, parapets, pitched roofs,
// spires and generic roof furniture, all as indexed triangles in plain typed arrays. Pure: the caller supplies a polygon
// triangulator (three's ShapeUtils in the browser) so node tests can run it too. Site frame in, three.js frame out
// (x east, y up, z = -north), the same as the other 3D modules.
import { repPoint, centroid, inRing } from './model.js';
import { roofColour, paletteOf } from './facades.js';

const hex = (s) => { const v = parseInt(String(s).slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class Pack {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.fa = []; this.fb = []; this.hh = []; this.idx = []; this.n = 0; }
  /** A vertex at site (x, y, z) with a site-frame normal. fa = (u, v, bays, floorH), fb = (style, seed, kind, jitter). */
  v(x, y, z, n, c, fa, fb, h) {
    this.pos.push(x, z, -y); this.nor.push(n[0], n[2], -n[1]); this.col.push(c[0], c[1], c[2]); this.fa.push(fa[0], fa[1], fa[2], fa[3]); this.fb.push(fb[0], fb[1], fb[2], fb[3]); this.hh.push(h);
    return this.n++;
  }
  /** A triangle wound so that its front faces the (three.js frame) direction n. */
  tri(a, b, c, n) {
    const P = this.pos, ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2];
    const ux = P[3 * b] - ax, uy = P[3 * b + 1] - ay, uz = P[3 * b + 2] - az, vx = P[3 * c] - ax, vy = P[3 * c + 1] - ay, vz = P[3 * c + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  get triangles() { return this.idx.length / 3; }
  arrays() {
    return { position: Float32Array.from(this.pos), normal: Float32Array.from(this.nor), color: Float32Array.from(this.col), fa: Float32Array.from(this.fa), fb: Float32Array.from(this.fb), h: Float32Array.from(this.hh), index: this.n > 65535 ? Uint32Array.from(this.idx) : Uint16Array.from(this.idx) };
  }
}

const ringPts = (p) => { const r = []; for (let i = 0; i < p.length; i += 2) r.push([p[i], p[i + 1]]); return r; };
const signedArea = (p) => { let a = 0; const n = p.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; } return a / 2; };

/** The ring pushed outward by about `eps` metres (scaled about its centroid), so coincident walls of stacked parts never fight. */
function inflate(p, eps) {
  if (!(eps > 0)) return p;
  const [cx, cy] = centroid(p), out = new Array(p.length); let r = 0; const n = p.length / 2;
  for (let i = 0; i < n; i++) r += Math.hypot(p[2 * i] - cx, p[2 * i + 1] - cy);
  r = Math.max(2, r / n); const k = 1 + eps / r;
  for (let i = 0; i < n; i++) { out[2 * i] = cx + (p[2 * i] - cx) * k; out[2 * i + 1] = cy + (p[2 * i + 1] - cy) * k; }
  return out;
}

/**
 * Build the meshes for `entries`. o: {triangulate(outer [[x,y]], holes [[[x,y]]]) -> [[a, b, c], ...] indices into outer then holes,
 * colorFor(h, isRoof) -> [r, g, b], parapets (default true: near buildings only)}.
 * Returns {arrays, starts (vertex index per entry), ids (building index per entry), stats}.
 */
export function buildPack(entries, o) {
  const pk = new Pack(), starts = [], ids = [], stats = { walls: 0, caps: 0, parapets: 0, pitched: 0, decor: 0 };
  const tri2 = o.triangulate;
  for (const e of entries) {
    starts.push(pk.n); ids.push(e.i);
    const multi = e.parts.length > 1;
    e.parts.forEach((q, rank) => drawPart(pk, e, q, multi ? Math.min(0.4, 0.02 * rank) : 0, o, tri2, stats));
    for (const d of e.decor) { drawDecor(pk, e, d, o); stats.decor++; }
  }
  return { arrays: pk.arrays(), starts: Int32Array.from(starts), ids: Int32Array.from(ids), stats, triangles: pk.triangles };
}

function drawPart(pk, e, q, eps, o, tri2, stats) {
  const st = q.style, plain = st.style === 9;
  const ramp = o.colorFor(q.h, false), rampRoof = o.colorFor(q.h, true);
  const own = !!q.col;
  const wallCol = own ? mixc(ramp, hex(q.col), 0.7) : ramp;
  const roofCol = own ? mixc(rampRoof, hex(q.col), 0.5) : rampRoof;
  const jit = ((((e.seed * 977) % 1) + 1) % 1);
  let pal = paletteOf(e.seed);
  if (st.brick === 1) pal = st.style === 0 ? 0 : 1; else if (st.brick === 2) pal = st.style === 0 ? 1 : 2;     // an OpenStreetMap material picks the palette
  const fbWall = [plain ? 9 : st.style, e.seed, plain ? 2 : 0, (own ? 1 : 0) + (pal + 0.1 + 0.8 * jit) / 4];
  const z0 = q.base_m <= 0.5 ? Math.min(e.g, 0) - 1.5 : q.base;
  const ring = inflate(q.p, eps);
  const pitched = q.roofShape !== 'flat';
  const zEave = pitched ? q.eaveZ : q.top;
  const parapet = o.parapets !== false && e.near && q.exposed && !pitched && q.kind !== 'spire' && q.area >= 20 && q.top - z0 > 6;
  const ph = e.roof > 120 ? 1.2 : 0.9;
  // slope: height of the roof at a vertex
  let zAt = () => q.top;
  if (q.roofShape === 'slope' && q.dir != null) {
    const fx = Math.sin((q.dir * Math.PI) / 180), fy = Math.cos((q.dir * Math.PI) / 180), [cx, cy] = centroid(ring);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < ring.length; i += 2) { const u = (ring[i] - cx) * fx + (ring[i + 1] - cy) * fy; lo = Math.min(lo, u); hi = Math.max(hi, u); }
    zAt = (x, y) => { const u = (x - cx) * fx + (y - cy) * fy, t = hi > lo ? (hi - u) / (hi - lo) : 0; return q.eaveZ + (q.top - q.eaveZ) * Math.max(0, Math.min(1, t)); };
  }
  const slope = q.roofShape === 'slope' && q.dir != null;
  const rings = [{ p: ring, hole: false }, ...(q.holes || []).map((h) => ({ p: h, hole: true }))];
  for (const { p, hole } of rings) {
    const n = p.length / 2, sg = (hole ? -1 : 1) * (signedArea(p) > 0 ? 1 : -1);
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n, ax = p[2 * j], ay = p[2 * j + 1], bx = p[2 * j2], by = p[2 * j2 + 1], len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      const nx = (sg * (by - ay)) / len, ny = (-sg * (bx - ax)) / len;
      const za = slope ? zAt(ax, ay) : zEave, zb = slope ? zAt(bx, by) : zEave;
      if (Math.max(za, zb) - z0 <= 0.01) continue;
      wallQuad(pk, [ax, ay], [bx, by], z0, za, zb, [nx, ny], wallCol, fbWall, e, q, len, plain || len < 1.4);
      stats.walls++;
      if (parapet && !hole) {
        const pc = mixc(wallCol, [0.85, 0.83, 0.8], 0.35), fbp = [9, e.seed, 2, 0], ix = nx * 0.3, iy = ny * 0.3;
        const tz = zEave, tp = zEave + ph;
        const mk = (x, y, z, n, c) => pk.v(x, y, z, n, c, [0, z - e.g, 1, st.floorH], fbp, q.h);
        // outer strip, inner face and the ledge between them
        let a0 = mk(ax, ay, tz, [nx, ny, 0], pc), b0 = mk(bx, by, tz, [nx, ny, 0], pc), b1 = mk(bx, by, tp, [nx, ny, 0], pc), a1 = mk(ax, ay, tp, [nx, ny, 0], pc);
        pk.tri(a0, b0, b1, [nx, 0, -ny]); pk.tri(a0, b1, a1, [nx, 0, -ny]);
        a0 = mk(ax - ix, ay - iy, tz, [-nx, -ny, 0], pc); b0 = mk(bx - ix, by - iy, tz, [-nx, -ny, 0], pc); b1 = mk(bx - ix, by - iy, tp, [-nx, -ny, 0], pc); a1 = mk(ax - ix, ay - iy, tp, [-nx, -ny, 0], pc);
        pk.tri(a0, b0, b1, [-nx, 0, ny]); pk.tri(a0, b1, a1, [-nx, 0, ny]);
        a0 = mk(ax, ay, tp, [0, 0, 1], pc); b0 = mk(bx, by, tp, [0, 0, 1], pc); b1 = mk(bx - ix, by - iy, tp, [0, 0, 1], pc); a1 = mk(ax - ix, ay - iy, tp, [0, 0, 1], pc);
        pk.tri(a0, b0, b1, [0, 1, 0]); pk.tri(a0, b1, a1, [0, 1, 0]);
        stats.parapets++;
      }
    }
  }
  // the top: a flat cap, a sloped plane, or a pyramid / dome / spire
  if (q.roofShape === 'flat' || (q.roofShape === 'slope' && !slope)) { cap(pk, ring, q.holes || [], q.top, roofCol, [9, e.seed, 1, 0], e, q, tri2, null); stats.caps++; }
  else if (slope) { cap(pk, ring, q.holes || [], q.top, roofCol, [9, e.seed, 3, 0], e, q, tri2, zAt); stats.caps++; }
  else { pitchedRoof(pk, ring, q, e, mixc(roofColour(q.roofShape, e.meta.year), roofCol, 0.2)); stats.pitched++; }
}

function wallQuad(pk, a, b, z0, za, zb, n, c, fb, e, q, len, plain) {
  const nB = Math.max(1, Math.round(len / q.style.bay)), fh = q.style.floorH, kind = plain ? 2 : fb[2];
  const f2 = [fb[0], fb[1], kind, fb[3]], nn = [n[0], n[1], 0];
  const v0 = pk.v(a[0], a[1], z0, nn, c, [0, z0 - e.g, nB, fh], f2, q.h), v1 = pk.v(b[0], b[1], z0, nn, c, [1, z0 - e.g, nB, fh], f2, q.h);
  const v2 = pk.v(b[0], b[1], zb, nn, c, [1, zb - e.g, nB, fh], f2, q.h), v3 = pk.v(a[0], a[1], za, nn, c, [0, za - e.g, nB, fh], f2, q.h);
  const n3 = [n[0], 0, -n[1]];
  pk.tri(v0, v1, v2, n3); pk.tri(v0, v2, v3, n3);
}

function cap(pk, ring, holes, z, c, fb, e, q, tri2, zAt) {
  const outer = ringPts(ring), hs = holes.map(ringPts), all = [...outer, ...hs.flat()];
  const tris = tri2(outer, hs);
  if (!tris || !tris.length) return;
  const vi = all.map(([x, y]) => pk.v(x, y, zAt ? zAt(x, y) : z, [0, 0, 1], c, [0, 0, 1, 3], fb, q.h));
  let nn = [0, 1, 0];
  if (zAt && tris.length) { // a sloped plane: the normal of its first triangle
    const [a, b, d] = tris[0], A = [...all[a], zAt(...all[a])], B = [...all[b], zAt(...all[b])], D = [...all[d], zAt(...all[d])];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
    const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];   // site frame
    const l = Math.hypot(...cr) || 1, s = cr[2] < 0 ? -1 : 1;
    for (const k of [a, b, d]) { const i = vi[k]; pk.nor[3 * i] = (s * cr[0]) / l; pk.nor[3 * i + 1] = (s * cr[2]) / l; pk.nor[3 * i + 2] = -(s * cr[1]) / l; }
    nn = [(s * cr[0]) / l, (s * cr[2]) / l, -(s * cr[1]) / l];
  }
  for (const [a, b, d] of tris) pk.tri(vi[a], vi[b], vi[d], nn);
}

/** Pyramid, hip and cone roofs rise from the eave ring to an apex over the middle; a dome through two lower rings; a spire from its base. */
function pitchedRoof(pk, ring, q, e, col) {
  const n = ring.length / 2, [ax, ay] = repPoint(ring), zE = q.eaveZ, zT = q.top;
  const levels = q.roofShape === 'dome' ? [[1, 0], [0.84, 0.5], [0.5, 0.86], [0, 1]] : [[1, 0], [0, 1]];
  const at = (k, j) => { const [s, f] = levels[k]; return [ax + (ring[2 * j] - ax) * s, ay + (ring[2 * j + 1] - ay) * s, zE + (zT - zE) * f]; };
  const fb = [9, e.seed, 3, 0];
  const face = (P, Q, R) => {
    const u = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]], w = [R[0] - P[0], R[1] - P[1], R[2] - P[2]];
    let c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...c) || 1;
    if (c[2] < 0) c = [-c[0], -c[1], -c[2]];           // faces upward or outward, never into the building
    const nrm = [c[0] / l, c[1] / l, c[2] / l];
    const ids = [P, Q, R].map((X) => pk.v(X[0], X[1], X[2], nrm, col, [0, 0, 1, 3], fb, q.h));
    pk.tri(ids[0], ids[1], ids[2], [nrm[0], nrm[2], -nrm[1]]);
  };
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    for (let k = 0; k + 1 < levels.length; k++) {
      const A = at(k, j), B = at(k, j2), C = at(k + 1, j2), D = at(k + 1, j);
      if (levels[k + 1][0] === 0) face(A, B, D); else { face(A, B, C); face(A, C, D); }
    }
  }
}

function drawDecor(pk, e, d, o) {
  const c = mixc(o.colorFor(e.roof, false), [0.5, 0.5, 0.52], 0.45), fb = [9, e.seed, 2, 0], H = e.roof;
  const quad = (A, B, z0, z1, n, col) => {
    const nn = [n[0], n[1], 0], mk = (p, z) => pk.v(p[0], p[1], z, nn, col, [0, z - e.g, 1, 3], fb, H);
    const a = mk(A, z0), b = mk(B, z0), cc = mk(B, z1), dd = mk(A, z1);
    pk.tri(a, b, cc, [n[0], 0, -n[1]]); pk.tri(a, cc, dd, [n[0], 0, -n[1]]);
  };
  if (d.kind === 'box') {
    const co = Math.cos(d.rot), si = Math.sin(d.rot), hw = d.w / 2, hd = d.d / 2;
    const P = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [d.x + x * co - y * si, d.y + x * si + y * co]);
    for (let k = 0; k < 4; k++) {
      const A = P[k], B = P[(k + 1) % 4], l = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
      quad(A, B, d.z0, d.z1, [(B[1] - A[1]) / l, -(B[0] - A[0]) / l], c);
    }
    const ids = P.map((p) => pk.v(p[0], p[1], d.z1, [0, 0, 1], mixc(c, [0.9, 0.9, 0.9], 0.2), [0, 0, 1, 3], [9, e.seed, 1, 0], H));
    pk.tri(ids[0], ids[1], ids[2], [0, 1, 0]); pk.tri(ids[0], ids[2], ids[3], [0, 1, 0]);
  } else {                                                // a rooftop wooden water tank: a drum on a short skirt under a cone
    const wood = [0.42, 0.31, 0.23], N = 8, r = d.r, zb = d.z0 + 1.4, zt = d.z1 - 1.3;
    for (let k = 0; k < N; k++) {
      const a1 = (k / N) * Math.PI * 2, a2 = ((k + 1) / N) * Math.PI * 2, A = [d.x + Math.cos(a1) * r, d.y + Math.sin(a1) * r], B = [d.x + Math.cos(a2) * r, d.y + Math.sin(a2) * r];
      const m = (a1 + a2) / 2, nn = [Math.cos(m), Math.sin(m)];
      quad(A, B, zb, zt, nn, wood);
      const A2 = [d.x + Math.cos(a1) * r * 0.9, d.y + Math.sin(a1) * r * 0.9], B2 = [d.x + Math.cos(a2) * r * 0.9, d.y + Math.sin(a2) * r * 0.9];
      quad(A2, B2, d.z0, zb, nn, mixc(wood, [0.15, 0.15, 0.16], 0.6));     // the legs, as one dark band
      const apex = pk.v(d.x, d.y, d.z1, [0, 0, 1], [0.3, 0.3, 0.32], [0, 0, 1, 3], [9, e.seed, 3, 0], H);
      const a = pk.v(A[0], A[1], zt, [nn[0], nn[1], 0.8], [0.3, 0.3, 0.32], [0, 0, 1, 3], [9, e.seed, 3, 0], H), b = pk.v(B[0], B[1], zt, [nn[0], nn[1], 0.8], [0.3, 0.3, 0.32], [0, 0, 1, 3], [9, e.seed, 3, 0], H);
      pk.tri(a, b, apex, [nn[0], 0.8, -nn[1]]);
    }
  }
}
export { inRing };
