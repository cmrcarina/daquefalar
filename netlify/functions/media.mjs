// GET /media/:key — serve imagens e vídeos guardados no Netlify Blobs (com suporte a Range para vídeo)
import { armazem, PARTE } from "../lib/comum.mjs";

const chaveValida = (k) => /^[a-z0-9][a-z0-9._-]{4,120}$/.test(k || "");

export default async (req, ctx) => {
  const key = ctx.params.key;
  if (!chaveValida(key)) return new Response("Não encontrado", { status: 404 });
  const st = armazem();
  const m = await st.get(`m/${key}`, { type: "json" });
  if (!m || !m.completo) return new Response("Não encontrado", { status: 404 });

  const base = {
    "content-type": m.tipo || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    etag: `"${key}"`,
  };
  if (req.headers.get("if-none-match") === `"${key}"`) return new Response(null, { status: 304, headers: base });

  const total = m.tamanho;
  let ini = 0, fim = total - 1, parcial = false;
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if (r) {
    parcial = true;
    if (r[1] === "" && r[2] !== "") { ini = Math.max(0, total - Number(r[2])); }
    else { ini = Number(r[1] || 0); if (r[2] !== "") fim = Math.min(Number(r[2]), total - 1); }
    if (ini >= total || ini > fim) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${total}` } });
  }
  // Cada resposta leva no máximo uma parte (limite de tamanho das funções)
  if (fim - ini + 1 > PARTE) { fim = ini + PARTE - 1; parcial = true; }

  const p0 = Math.floor(ini / PARTE), p1 = Math.floor(fim / PARTE);
  const pedacos = [];
  for (let i = p0; i <= p1; i++) {
    const buf = await st.get(`p/${key}/${i}`, { type: "arrayBuffer" });
    if (!buf) return new Response("Ficheiro incompleto", { status: 404 });
    pedacos.push(new Uint8Array(buf));
  }
  let junto = pedacos[0];
  if (pedacos.length > 1) {
    junto = new Uint8Array(pedacos.reduce((n, x) => n + x.byteLength, 0));
    let o = 0; for (const x of pedacos) { junto.set(x, o); o += x.byteLength; }
  }
  const off = ini - p0 * PARTE;
  const corpo = junto.subarray(off, off + (fim - ini + 1));
  const headers = { ...base, "content-length": String(corpo.byteLength) };
  if (parcial) headers["content-range"] = `bytes ${ini}-${fim}/${total}`;
  return new Response(corpo, { status: parcial ? 206 : 200, headers });
};

export const config = { path: "/media/:key", method: ["GET", "HEAD"] };
