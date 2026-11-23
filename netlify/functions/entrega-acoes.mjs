// POST /api/entrega/:token/resposta | aprovar-todos | enviar — o cliente responde
import { sincronizarRespostas } from "../lib/sincronizar.mjs";
import { db, entregaPorToken, montarEntrega, postsDe, respostasDe, bloqueada, json, erro, lerJson, tratar, env, ErroPedido } from "../lib/comum.mjs";

async function gravar(entregaId, post, decisao, comentarios) {
  const s = db().sql, c = JSON.stringify(comentarios);
  await s`INSERT INTO respostas (entrega_id, post_id, versao, decisao, comentarios, data)
          VALUES (${entregaId}, ${post.id}, ${post.versao}, ${decisao}, ${c}::jsonb, now())
          ON CONFLICT (entrega_id, post_id) DO UPDATE
          SET versao = EXCLUDED.versao, decisao = EXCLUDED.decisao, comentarios = EXCLUDED.comentarios, data = now()`;
  await s`INSERT INTO respostas_historico (entrega_id, post_id, versao, decisao, comentarios)
          VALUES (${entregaId}, ${post.id}, ${post.versao}, ${decisao}, ${c}::jsonb)`;
}

function limparComentarios(lista) {
  if (!Array.isArray(lista)) return [];
  if (lista.length > 30) throw new ErroPedido("Demasiados comentários num só post.");
  return lista
    .map((c) => ({ slide: String(c?.slide ?? "").slice(0, 40), texto: String(c?.texto ?? "").trim().slice(0, 2000) }))
    .filter((c) => c.texto);
}

async function avisarAgencia(e, envio) {
  const url = env("NOTIFICAR_URL"); // opcional: webhook (Make, Zapier, Slack, n8n…)
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evento: "respostas_enviadas", codigo: e.codigo, cliente: e.cliente?.nome, mes: e.mes, ...envio }),
      signal: AbortSignal.timeout(4000),
    });
  } catch (err) { console.warn("Aviso à agência falhou:", err?.message); }
}

export default tratar(async (req, ctx) => {
  const e = await entregaPorToken(ctx.params.token);
  if (!e) return erro("Este link não é válido ou já foi desativado.", 404);
  const posts = await postsDe(e.id);
  if (bloqueada(posts, e.envio)) return erro("As respostas deste mês já foram enviadas.", 409);
  const acao = ctx.params.acao;

  if (acao === "resposta") {
    const b = await lerJson(req, 100_000);
    const post = posts.find((p) => p.id === b.postId);
    if (!post) return erro("Publicação não encontrada.", 404);
    if (!["aprovado", "alteracoes"].includes(b.decisao)) return erro("Decisão inválida.");
    const comentarios = b.decisao === "alteracoes" ? limparComentarios(b.comentarios) : [];
    if (b.decisao === "alteracoes" && !comentarios.length) return erro("Escreva pelo menos um comentário com a alteração pretendida.");
    await gravar(e.id, post, b.decisao, comentarios);
  } else if (acao === "aprovar-todos") {
    const resp = await respostasDe(e.id);
    for (const p of posts) if (!resp[p.id] || resp[p.id].versao !== p.versao) await gravar(e.id, p, "aprovado", []);
  } else if (acao === "enviar") {
    const resp = await respostasDe(e.id);
    const falta = posts.filter((p) => !resp[p.id] || resp[p.id].versao !== p.versao);
    if (falta.length) return erro(`Ainda falta responder a ${falta.length} publicação(ões).`, 409);
    const versoes = Object.fromEntries(posts.map((p) => [p.id, p.versao]));
    const aprovados = posts.filter((p) => resp[p.id].decisao === "aprovado").length;
    const envio = { data: new Date().toISOString(), aprovados, alteracoes: posts.length - aprovados, versoes };
    await db().sql`UPDATE entregas SET envio = ${JSON.stringify(envio)}::jsonb, atualizado_em = now() WHERE id = ${e.id}`;
    e.envio = envio;
    await sincronizarRespostas(e); // escreve Estado e comentários no plano do mês (não falha o envio)
    await avisarAgencia(e, envio);
  } else {
    return erro("Ação desconhecida.", 404);
  }
  return json(await montarEntrega({ ...e, envio: e.envio }));
});

export const config = { path: "/api/entrega/:token/:acao", method: "POST" };
