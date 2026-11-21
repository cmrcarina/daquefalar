// GET /api/entrega/:token — o cliente abre o link e recebe o conteúdo do mês
import { entregaPorToken, montarEntrega, json, erro, tratar } from "../lib/comum.mjs";

export default tratar(async (req, ctx) => {
  const e = await entregaPorToken(ctx.params.token);
  if (!e) return erro("Este link não é válido ou já foi desativado.", 404);
  return json(await montarEntrega(e));
});

export const config = { path: "/api/entrega/:token", method: "GET" };
