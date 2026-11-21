// POST /api/admin/demo — cria (ou repõe) a entrega de exemplo com os ficheiros em /exemplo
import { db, gravarEntrega, linkDe, json, erro, isAdmin, semAdmin, tratar } from "../lib/comum.mjs";

export default tratar(async (req) => {
  if (!isAdmin(req)) return semAdmin();
  const r = await fetch(new URL("/exemplo/dados.json", req.url));
  if (!r.ok) return erro("Não encontrei /exemplo/dados.json.", 500);
  const dados = await r.json();
  const g = await gravarEntrega(dados);
  // Repor: apagar respostas e envio para poder testar do zero
  await db().sql`DELETE FROM respostas WHERE entrega_id = ${g.id}`;
  await db().sql`UPDATE entregas SET envio = NULL WHERE id = ${g.id}`;
  return json({ ...g, link: linkDe(req, g.token) }, 201);
});

export const config = { path: "/api/admin/demo", method: "POST" };
