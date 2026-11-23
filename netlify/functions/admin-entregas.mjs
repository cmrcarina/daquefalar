// Gestão das entregas (só com a chave de administração)
//   GET   /api/admin/entregas           lista com o estado de cada entrega
//   POST  /api/admin/entregas           cria ou atualiza uma entrega (mesmo "codigo" = mesmo link)
//   GET   /api/admin/entregas/:id       detalhe: posts, respostas, histórico e link
//   PATCH /api/admin/entregas/:id       { "ativo": false } desativa o link · { "novoLink": true } gera um link novo
//                                       { "sincronizar": true } volta a escrever as respostas no plano do mês
import { sincronizarRespostas, marcarEnviados } from "../lib/sincronizar.mjs";
import { db, entregaPorId, montarEntrega, gravarEntrega, novoToken, linkDe, json, erro, lerJson, isAdmin, semAdmin, tratar } from "../lib/comum.mjs";

export default tratar(async (req, ctx) => {
  if (!isAdmin(req)) return semAdmin();
  const s = db().sql;
  const id = ctx.params.id;

  if (!id && req.method === "GET") {
    const rows = await s`
      SELECT e.id, e.codigo, e.token, e.cliente->>'nome' AS cliente, e.cliente->>'handle' AS handle, e.mes,
             to_char(e.prazo,'YYYY-MM-DD') AS prazo, e.ativo, e.exemplo, e.envio, e.atualizado_em,
             (SELECT count(*)::int FROM posts p WHERE p.entrega_id = e.id) AS posts,
             (SELECT count(*)::int FROM respostas r JOIN posts p ON p.entrega_id = r.entrega_id AND p.id = r.post_id AND p.versao = r.versao
                WHERE r.entrega_id = e.id AND r.decisao = 'aprovado') AS aprovados,
             (SELECT count(*)::int FROM respostas r JOIN posts p ON p.entrega_id = r.entrega_id AND p.id = r.post_id AND p.versao = r.versao
                WHERE r.entrega_id = e.id AND r.decisao = 'alteracoes') AS alteracoes
      FROM entregas e ORDER BY e.atualizado_em DESC LIMIT 200`;
    return json({ entregas: rows.map(({ token, ...r }) => ({ ...r, link: linkDe(req, token) })) });
  }

  if (!id && req.method === "POST") {
    const r = await gravarEntrega(await lerJson(req, 2_000_000));
    const plano = await marcarEnviados(r.id, r.planilha, r.alterados);
    return json({ ...r, link: linkDe(req, r.token), plano }, 201);
  }

  const e = await entregaPorId(id);
  if (!e) return erro("Entrega não encontrada.", 404);

  if (req.method === "PATCH") {
    const b = await lerJson(req, 10_000);
    if (typeof b.ativo === "boolean") await s`UPDATE entregas SET ativo = ${b.ativo}, atualizado_em = now() WHERE id = ${e.id}`;
    if (b.novoLink === true) await s`UPDATE entregas SET token = ${novoToken()}, atualizado_em = now() WHERE id = ${e.id}`;
    if (b.reabrir === true) await s`UPDATE entregas SET envio = NULL, atualizado_em = now() WHERE id = ${e.id}`;
    if (b.sincronizar === true) await sincronizarRespostas(await entregaPorId(e.id));
  }
  const atual = await entregaPorId(e.id);
  const historico = await s`SELECT post_id AS "postId", versao, decisao, comentarios, data FROM respostas_historico
                            WHERE entrega_id = ${e.id} ORDER BY data DESC LIMIT 500`;
  return json({ id: atual.id, codigo: atual.codigo, ativo: atual.ativo, link: linkDe(req, atual.token),
    planilha: !!atual.planilha, sincronizacao: atual.sincronizacao, ...(await montarEntrega(atual)), historico });
});

export const config = { path: ["/api/admin/entregas", "/api/admin/entregas/:id"], method: ["GET", "POST", "PATCH"] };
