// Liga as respostas da plataforma ao plano do mês no Google Sheets.
// Nunca deixa falhar o pedido do cliente: os erros ficam registados em entregas.sincronizacao.
import { db, postsDe, respostasDe } from "./comum.mjs";
import { sheetsAtivo, escreverRespostas, marcarEstado, ESTADOS } from "./sheets.mjs";

async function registar(entregaId, estado) {
  await db().sql`UPDATE entregas SET sincronizacao = ${JSON.stringify({ data: new Date().toISOString(), ...estado })}::jsonb WHERE id = ${entregaId}`;
}

/** Escreve no plano o Estado e os comentários de cada post respondido. */
export async function sincronizarRespostas(e) {
  if (!e.planilha) return { ok: false, mensagem: "Esta entrega não foi importada de um plano do Google Sheets." };
  if (!sheetsAtivo()) return { ok: false, mensagem: "Falta configurar GOOGLE_SERVICE_ACCOUNT na Netlify." };
  const anterior = e.sincronizacao || {};
  const envioData = e.envio?.data || null;
  // O histórico (separador Respostas) só se acrescenta uma vez por envio do cliente.
  const acrescentarHistorico = !!envioData && anterior.historicoDe !== envioData;
  try {
    const [posts, respostas] = await Promise.all([postsDe(e.id), respostasDe(e.id)]);
    const r = await escreverRespostas(e.planilha, e.codigo, posts, respostas, { acrescentarHistorico });
    const estado = {
      ok: true,
      mensagem: `${r.posts} post(s) atualizados no plano${r.linhasHistorico ? `, ${r.linhasHistorico} linha(s) no separador Respostas` : ""}.` +
        (r.semLinha.length ? ` Sem linha no plano: ${r.semLinha.join(", ")}.` : ""),
      historicoDe: acrescentarHistorico ? envioData : anterior.historicoDe || null,
    };
    await registar(e.id, estado);
    return estado;
  } catch (err) {
    const estado = { ok: false, mensagem: err.message || "Erro ao escrever no plano.", historicoDe: anterior.historicoDe || null };
    console.error("Sincronização com o plano falhou:", err);
    await registar(e.id, estado).catch(() => {});
    return estado;
  }
}

/** Depois de importar: os posts novos ou com nova versão passam a "Enviado ao cliente" no plano. */
export async function marcarEnviados(entregaId, planilha, ids) {
  if (!planilha || !ids.length || !sheetsAtivo()) return null;
  try {
    const r = await marcarEstado(planilha, ids, ESTADOS.enviado);
    return { ok: true, mensagem: `${r.escritos} post(s) passaram a "${ESTADOS.enviado}" no plano.` };
  } catch (err) {
    console.error("Não foi possível marcar os posts como enviados:", err);
    const estado = { ok: false, mensagem: err.message || "Erro ao escrever no plano." };
    await registar(entregaId, estado).catch(() => {});
    return estado;
  }
}
