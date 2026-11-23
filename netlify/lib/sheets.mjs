// Escrita no plano do mês (Google Sheets) com uma conta de serviço Google.
// Configuração: variável GOOGLE_SERVICE_ACCOUNT com o JSON da chave da conta de serviço,
// e o plano partilhado com o email dessa conta (Editor).
// Sem a variável, nada é escrito e a plataforma funciona como antes.
import { createSign } from "node:crypto";
import { env } from "./comum.mjs";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const ESCOPO = "https://www.googleapis.com/auth/spreadsheets";
const SEPARADOR_RESPOSTAS = "Respostas";
const CAB_RESPOSTAS = ["Data", "Entrega", "ID", "Versão", "Decisão", "Slide", "Comentário"];
export const ESTADOS = { aprovado: "Aprovado", alteracoes: "Alterações", enviado: "Enviado ao cliente" };

const b64url = (v) => Buffer.from(v).toString("base64url");
const semAcentos = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** A conta de serviço está configurada? */
export function sheetsAtivo() {
  return !!credenciais();
}

function credenciais() {
  const bruto = env("GOOGLE_SERVICE_ACCOUNT");
  if (!bruto) return null;
  try {
    const c = JSON.parse(bruto);
    if (!c.client_email || !c.private_key) return null;
    return { email: c.client_email, chave: c.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

let _token = { valor: "", expira: 0 };
async function token() {
  if (_token.valor && Date.now() < _token.expira - 60_000) return _token.valor;
  const c = credenciais();
  if (!c) throw new Error("Falta configurar GOOGLE_SERVICE_ACCOUNT na Netlify.");
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = b64url(JSON.stringify({ iss: c.email, scope: ESCOPO, aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600 }));
  const assinatura = createSign("RSA-SHA256").update(`${cab}.${corpo}`).sign(c.chave).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${cab}.${corpo}.${assinatura}` }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`A Google recusou a conta de serviço (${d.error || r.status}).`);
  _token = { valor: d.access_token, expira: Date.now() + (d.expires_in || 3600) * 1000 };
  return _token.valor;
}

async function pedir(caminho, opcoes = {}) {
  const r = await fetch(`${API}/${caminho}`, {
    ...opcoes,
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json", ...(opcoes.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d.error?.message || `erro ${r.status}`;
    if (r.status === 403 || r.status === 404)
      throw new Error(`Sem acesso ao plano (${msg}). Partilhe o Google Sheet com ${credenciais()?.email} como Editor.`);
    throw new Error(`Google Sheets: ${msg}`);
  }
  return d;
}

const letra = (i) => { let s = ""; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const ref = (titulo, intervalo) => `'${titulo.replace(/'/g, "''")}'!${intervalo}`;

/** Lê o separador Posts (o 1.º separador): título, cabeçalho e a linha de cada ID. */
async function lerPosts(planilhaId) {
  const meta = await pedir(`${planilhaId}?fields=sheets.properties(sheetId,title,index)`);
  const folhas = (meta.sheets || []).map((s) => s.properties);
  const posts = folhas.find((f) => f.index === 0) || folhas[0];
  if (!posts) throw new Error("O plano não tem separadores.");
  const v = await pedir(`${planilhaId}/values/${encodeURIComponent(ref(posts.title, "A1:ZZ"))}?majorDimension=ROWS`);
  const linhas = v.values || [];
  const cab = (linhas[0] || []).map(semAcentos);
  const col = (inicio) => cab.findIndex((c) => c.startsWith(inicio));
  const linhaDe = {};
  const cId = col("id");
  linhas.slice(1).forEach((l, i) => { const id = (l[cId] || "").trim(); if (id) linhaDe[id] = i + 2; });
  return { folhas, titulo: posts.title, cab, col, linhaDe };
}

/** Garante a coluna "Comentários do cliente" no separador Posts e devolve o índice. */
async function colunaComentarios(planilhaId, p) {
  let c = p.col("comentarios do cliente");
  if (c >= 0) return c;
  c = p.cab.length;
  await pedir(`${planilhaId}/values/${encodeURIComponent(ref(p.titulo, `${letra(c)}1`))}?valueInputOption=RAW`, {
    method: "PUT", body: JSON.stringify({ values: [["Comentários do cliente"]] }),
  });
  return c;
}

/** Garante o separador "Respostas" (histórico) e devolve o título. */
async function separadorRespostas(planilhaId, folhas) {
  if (folhas.some((f) => f.title === SEPARADOR_RESPOSTAS)) return SEPARADOR_RESPOSTAS;
  await pedir(`${planilhaId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SEPARADOR_RESPOSTAS } } }] }) });
  await pedir(`${planilhaId}/values/${encodeURIComponent(ref(SEPARADOR_RESPOSTAS, "A1"))}?valueInputOption=RAW`, {
    method: "PUT", body: JSON.stringify({ values: [CAB_RESPOSTAS] }),
  });
  return SEPARADOR_RESPOSTAS;
}

// Data e hora de Lisboa, ex.: 2026-11-22 20:32
const dataCurta = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("sv-SE", { timeZone: "Europe/Lisbon" }).slice(0, 16); };

/** Texto da coluna "Comentários do cliente" para uma resposta. */
export function textoComentarios(r) {
  if (!r || r.decisao !== "alteracoes" || !r.comentarios?.length) return "";
  return [`v${r.versao} · ${dataCurta(r.data)}`, ...r.comentarios.map((c) => `${c.slide ? c.slide + ": " : ""}${c.texto}`)].join("\n");
}

/** Muda o Estado dos posts indicados (ex.: "Enviado ao cliente" depois de importar). */
export async function marcarEstado(planilhaId, ids, estado) {
  if (!ids.length) return { escritos: 0 };
  const p = await lerPosts(planilhaId);
  const cEstado = p.col("estado");
  if (cEstado < 0) throw new Error('O separador Posts não tem a coluna "Estado".');
  const data = ids.filter((id) => p.linhaDe[id]).map((id) => ({ range: ref(p.titulo, `${letra(cEstado)}${p.linhaDe[id]}`), values: [[estado]] }));
  if (data.length) await pedir(`${planilhaId}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
  return { escritos: data.length };
}

/**
 * Escreve as respostas do cliente no plano:
 * - Estado de cada post: "Aprovado" ou "Alterações";
 * - coluna "Comentários do cliente": os comentários da versão atual (vazia se aprovado);
 * - separador "Respostas": uma linha por comentário (histórico), só se acrescentarHistorico.
 */
export async function escreverRespostas(planilhaId, codigo, posts, respostas, { acrescentarHistorico = true } = {}) {
  const p = await lerPosts(planilhaId);
  const cEstado = p.col("estado");
  if (cEstado < 0) throw new Error('O separador Posts não tem a coluna "Estado".');
  const cCom = await colunaComentarios(planilhaId, p);

  const data = [], historico = [], semLinha = [];
  for (const post of posts) {
    const r = respostas[post.id];
    if (!r || r.versao !== post.versao) continue;
    const linha = p.linhaDe[post.id];
    if (!linha) { semLinha.push(post.id); continue; }
    data.push({ range: ref(p.titulo, `${letra(cEstado)}${linha}`), values: [[ESTADOS[r.decisao]]] });
    data.push({ range: ref(p.titulo, `${letra(cCom)}${linha}`), values: [[textoComentarios(r)]] });
    const base = [dataCurta(r.data), codigo, post.id, r.versao, ESTADOS[r.decisao]];
    if (r.decisao === "alteracoes" && r.comentarios?.length) r.comentarios.forEach((c) => historico.push([...base, c.slide || "", c.texto]));
    else historico.push([...base, "", ""]);
  }
  if (data.length) await pedir(`${planilhaId}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
  if (acrescentarHistorico && historico.length) {
    const t = await separadorRespostas(planilhaId, p.folhas);
    await pedir(`${planilhaId}/values/${encodeURIComponent(ref(t, "A1"))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST", body: JSON.stringify({ values: historico }),
    });
  }
  return { posts: data.length / 2, linhasHistorico: acrescentarHistorico ? historico.length : 0, semLinha };
}
