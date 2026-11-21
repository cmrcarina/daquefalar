// Envio de imagens e vídeos (só com a chave de administração)
//   POST /api/admin/media?nome=capa.jpg            corpo = o ficheiro (até 4 MB)  → { url: "/media/..." }
//   POST /api/admin/media?nome=reel.mp4&tamanho=N  sem corpo → inicia envio em partes → { key, partes, parteTamanho, url }
//   PUT  /api/admin/media/:key/:parte              corpo = a parte (4 MB)         → quando chega a última, o ficheiro fica disponível
import { armazem, PARTE, json, erro, isAdmin, semAdmin, tratar } from "../lib/comum.mjs";
import { randomBytes } from "node:crypto";

const TIPOS = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
const MAX = 500 * 1024 * 1024;

function nomeSeguro(nome) {
  const ext = (nome.split(".").pop() || "").toLowerCase();
  if (!TIPOS[ext]) return null;
  const base = nome.slice(0, -(ext.length + 1)).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "ficheiro";
  return { key: `${base}-${randomBytes(5).toString("hex")}.${ext}`, tipo: TIPOS[ext] };
}

export default tratar(async (req, ctx) => {
  if (!isAdmin(req)) return semAdmin();
  const st = armazem();

  if (req.method === "PUT") {
    const { key, parte } = ctx.params;
    const m = await st.get(`m/${key}`, { type: "json" });
    if (!m) return erro("Envio não encontrado.", 404);
    const i = Number(parte);
    if (!Number.isInteger(i) || i < 0 || i >= m.partes) return erro("Número de parte inválido.");
    const buf = await req.arrayBuffer();
    const esperado = i === m.partes - 1 ? m.tamanho - i * PARTE : PARTE;
    if (buf.byteLength !== esperado) return erro(`A parte ${i} devia ter ${esperado} bytes e tem ${buf.byteLength}.`);
    await st.set(`p/${key}/${i}`, buf);
    const recebidas = Array.from(new Set([...(m.recebidas || []), i]));
    const completo = recebidas.length === m.partes;
    await st.set(`m/${key}`, JSON.stringify({ ...m, recebidas, completo }));
    return json({ key, parte: i, completo, url: `/media/${key}` });
  }

  const q = new URL(req.url).searchParams;
  const ns = nomeSeguro(q.get("nome") || "");
  if (!ns) return erro("Indique ?nome= com extensão jpg, png, webp, gif, mp4, mov ou webm.");

  const tamanhoPedido = Number(q.get("tamanho") || 0);
  if (tamanhoPedido) {
    if (tamanhoPedido > MAX) return erro("Ficheiro demasiado grande (máx. 500 MB).", 413);
    const partes = Math.ceil(tamanhoPedido / PARTE);
    await st.set(`m/${ns.key}`, JSON.stringify({ tipo: ns.tipo, tamanho: tamanhoPedido, partes, recebidas: [], completo: false }));
    return json({ key: ns.key, partes, parteTamanho: PARTE, url: `/media/${ns.key}` });
  }

  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return erro("O ficheiro chegou vazio.");
  if (buf.byteLength > PARTE) return erro("Ficheiros acima de 4 MB têm de ser enviados em partes (use ?tamanho=).", 413);
  await st.set(`p/${ns.key}/0`, buf);
  await st.set(`m/${ns.key}`, JSON.stringify({ tipo: ns.tipo, tamanho: buf.byteLength, partes: 1, recebidas: [0], completo: true }));
  return json({ key: ns.key, url: `/media/${ns.key}` });
});

export const config = { path: ["/api/admin/media", "/api/admin/media/:key/:parte"], method: ["POST", "PUT"] };
