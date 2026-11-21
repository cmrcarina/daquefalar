// Criar entregas a partir do Google Drive (só com a chave de administração)
//   POST /api/admin/drive/plano     { "planilha": "<link do plano do mês>" } → { dados, ficheiros, avisos }
//   POST /api/admin/drive/ficheiro  { "id": "<id no Drive>", "nome": "01.jpg", "parte": 0 } → copia uma parte (4 MB) para a plataforma
// O painel chama "plano", depois "ficheiro" para cada ficheiro (parte a parte) e, no fim, POST /api/admin/entregas.
import { armazem, PARTE, json, erro, lerJson, isAdmin, semAdmin, tratar, ErroPedido } from "../lib/comum.mjs";
import { montarPlano, descarregar, extDe, mimeDe } from "../lib/drive.mjs";
import { createHash } from "node:crypto";

const chaveDe = (id, nome) => `g${createHash("sha1").update(id).digest("hex").slice(0, 24)}.${(extDe(nome) || "bin").replace(/[^a-z0-9]/g, "") || "bin"}`;

async function guardarTudo(st, key, buf, tipo) {
  const partes = Math.max(1, Math.ceil(buf.byteLength / PARTE));
  for (let i = 0; i < partes; i++) await st.set(`p/${key}/${i}`, buf.slice(i * PARTE, (i + 1) * PARTE).buffer);
  await st.set(`m/${key}`, JSON.stringify({ tipo, tamanho: buf.byteLength, partes, recebidas: [...Array(partes).keys()], completo: true, origem: "drive" }));
}

export default tratar(async (req) => {
  if (!isAdmin(req)) return semAdmin();
  const caminho = new URL(req.url).pathname;
  const b = await lerJson(req, 20_000);

  if (caminho.endsWith("/plano")) return json(await montarPlano(b.planilha));

  if (caminho.endsWith("/ficheiro")) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(b.id || "")) return erro("ID de ficheiro inválido.");
    const st = armazem();
    const key = chaveDe(b.id, b.nome || "");
    const url = `/media/${key}`;
    const tipo = mimeDe(b.nome || "") || "application/octet-stream";
    let m = await st.get(`m/${key}`, { type: "json" });
    if (m?.completo) return json({ url, completo: true, jaExistia: true });

    const parte = Number(b.parte) || 0;
    if (parte === 0 || !m) {
      const { buf, total, parcial } = await descarregar(b.id, 0, PARTE - 1);
      if (!parcial || total <= buf.byteLength) {
        if (!parcial && total > 500 * 1024 * 1024) throw new ErroPedido("Ficheiro demasiado grande (máx. 500 MB).", 413);
        await guardarTudo(st, key, buf, tipo);
        return json({ url, completo: true, partes: Math.ceil(total / PARTE) || 1 });
      }
      const partes = Math.ceil(total / PARTE);
      await st.set(`p/${key}/0`, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      await st.set(`m/${key}`, JSON.stringify({ tipo, tamanho: total, partes, recebidas: [0], completo: false, origem: "drive" }));
      return json({ url, completo: false, partes, parte: 0 });
    }

    if (parte < 0 || parte >= m.partes) return erro("Número de parte inválido.");
    const ini = parte * PARTE, fim = Math.min(m.tamanho, ini + PARTE) - 1;
    const { buf } = await descarregar(b.id, ini, fim);
    if (buf.byteLength !== fim - ini + 1) return erro(`A parte ${parte} chegou incompleta. Tente de novo.`, 502);
    await st.set(`p/${key}/${parte}`, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const recebidas = Array.from(new Set([...(m.recebidas || []), parte]));
    const completo = recebidas.length === m.partes;
    await st.set(`m/${key}`, JSON.stringify({ ...m, recebidas, completo }));
    return json({ url, completo, partes: m.partes, parte });
  }
  return erro("Ação desconhecida.", 404);
});

export const config = { path: ["/api/admin/drive/plano", "/api/admin/drive/ficheiro"], method: "POST" };
