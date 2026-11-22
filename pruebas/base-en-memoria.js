// Base en memoria para pruebas (reemplaza a MongoDB). Implementa lo que usa el proyecto.
import 'mingo/init/system';
import { Query, Aggregator } from 'mingo';
const store = globalThis.__FAKE_DB__ ||= {};
const clone = o => o === undefined ? undefined : structuredClone(o);
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, p, v) { const ks = p.split('.'); let a = o; for (const k of ks.slice(0, -1)) { if (a[k] == null || typeof a[k] !== 'object') a[k] = {}; a = a[k]; } a[ks.at(-1)] = v; }
function unsetPath(o, p) { const ks = p.split('.'); let a = o; for (const k of ks.slice(0, -1)) { a = a?.[k]; if (!a) return; } delete a[ks.at(-1)]; }
function applyUpdate(doc, u, q, isInsert) {
  const pos = p => { if (!p.includes('.$.')) return p; const [arr, rest] = p.split('.$.'); const lst = getPath(doc, arr) || [];
    const cond = Object.entries(q).find(([k]) => k.startsWith(arr + '.')); const sub = cond[0].slice(arr.length + 1);
    const i = lst.findIndex(x => getPath(x, sub) === cond[1]); return `${arr}.${i}.${rest}`; };
  for (const [k, v] of Object.entries(u.$set || {})) setPath(doc, pos(k), clone(v));
  for (const k of Object.keys(u.$unset || {})) unsetPath(doc, pos(k));
  for (const [k, v] of Object.entries(u.$inc || {})) setPath(doc, pos(k), (getPath(doc, pos(k)) || 0) + v);
  for (const [k, v] of Object.entries(u.$push || {})) { const arr = getPath(doc, k) || []; const nuevos = v && v.$each ? v.$each : [v];
    let r = [...arr, ...clone(nuevos)]; if (v && v.$slice != null) r = v.$slice < 0 ? r.slice(v.$slice) : r.slice(0, v.$slice); setPath(doc, k, r); }
  if (isInsert) for (const [k, v] of Object.entries(u.$setOnInsert || {})) setPath(doc, k, clone(v));
}
function proj(d, p) {
  if (!d) return d; if (!p) return clone(d);
  const vals = Object.values(p);
  if (vals.every(v => !v)) { const o = clone(d); for (const k of Object.keys(p)) unsetPath(o, k); return o; }
  const o = { _id: d._id }; for (const k of Object.keys(p)) if (p[k] && k !== '_id') { const v = getPath(d, k); if (v !== undefined) setPath(o, k, clone(v)); } if (p._id === 0) delete o._id; return o;
}
let oid = 1;
// Cada operación cede el turno (como una base de datos real por red): así las pruebas
// "al mismo tiempo" sí se intercalan y se ven las carreras.
const turno = () => new Promise(r => setImmediate(r));
class Cursor { constructor(r) { this.r = r; } sort(s) { const ks = Object.entries(s); this.r.sort((a, b) => { for (const [k, dir] of ks) { const x = getPath(a, k), y = getPath(b, k); if (x > y) return dir; if (x < y) return -dir; } return 0; }); return this; }
  skip(n) { this.r = this.r.slice(n); return this; } limit(n) { if (n) this.r = this.r.slice(0, n); return this; } project() { return this; } async toArray() { await turno(); return this.r.map(clone); } }
const errDup = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000, name: 'MongoServerError' });
class Col {
  constructor(n) { this.n = n; this.d = store[n] ||= []; }
  m(q) { const Q = new Query(q || {}); return this.d.filter(x => Q.test(x)); }
  find(q, o) { return new Cursor(this.m(q).map(d => proj(d, o?.projection))); }
  async findOne(q, o) { await turno(); const r = this.m(q)[0]; return r ? proj(r, o?.projection) : null; }
  async insertOne(doc) { await turno(); if (doc._id != null && this.d.some(x => x._id === doc._id)) throw errDup(); doc._id ??= oid++; this.d.push(clone(doc)); return { insertedId: doc._id }; }
  async insertMany(l) { for (const d of l) await this.insertOne(d); }
  async updateOne(q, u, o = {}) { await turno(); const r = this.m(q)[0]; if (r) { applyUpdate(r, u, q); return { matchedCount: 1, modifiedCount: 1 }; }
    if (o.upsert) { const n = { _id: oid++ }; for (const [k, v] of Object.entries(q)) if (!k.startsWith('$') && (typeof v !== 'object' || v === null)) setPath(n, k, v); applyUpdate(n, u, q, true); this.d.push(n); return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }; }
    return { matchedCount: 0, modifiedCount: 0 }; }
  async updateMany(q, u) { await turno(); const r = this.m(q); r.forEach(d => applyUpdate(d, u, q)); return { matchedCount: r.length, modifiedCount: r.length }; }
  async findOneAndUpdate(q, u, o = {}) { await turno(); const r = this.m(q)[0];
    if (r) { const antes = clone(r); applyUpdate(r, u, q); return proj(o.returnDocument === 'after' ? r : antes, o.projection); }
    if (o.upsert) { const n = { _id: q._id ?? oid++ }; for (const [k, v] of Object.entries(q)) if (!k.startsWith('$') && typeof v !== 'object') setPath(n, k, v); applyUpdate(n, u, q, true); this.d.push(n); return o.returnDocument === 'after' ? clone(n) : null; }
    return null; }
  async deleteOne(q) { await turno(); const r = this.m(q)[0]; if (!r) return { deletedCount: 0 }; this.d.splice(this.d.indexOf(r), 1); return { deletedCount: 1 }; }
  async deleteMany(q) { await turno(); const r = this.m(q); r.forEach(x => this.d.splice(this.d.indexOf(x), 1)); return { deletedCount: r.length }; }
  async countDocuments(q) { await turno(); return this.m(q).length; }
  async distinct(k, q) { await turno(); return [...new Set(this.m(q).map(x => getPath(x, k)).filter(v => v != null))]; }
  aggregate(p) { const r = new Aggregator(p).run(clone(this.d)); return { toArray: async () => { await turno(); return r; } }; }
  async createIndex() {} async bulkWrite() { return {}; }
}
export const fake = store;
globalThis.__FAKE_PING_FALLA__ = false;
export async function getDB() { return { collection: n => new Col(n), command: async () => { await turno(); if (globalThis.__FAKE_PING_FALLA__) throw Object.assign(new Error('connection refused'), { name: 'MongoNetworkError' }); return { ok: 1 }; } }; }
export async function asegurarIndicesBase() {}
export function invalidarSyncCache() {}
