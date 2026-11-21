// Funções partilhadas por todas as funções da API.
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";

export const env = (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k];

let _db;
export const db = () => (_db ??= getDatabase());

/* Armazém de ficheiros (imagens e vídeos). Em testes locais usa memória. */
const memoria = new Map();
export function armazem() {
  if (env("DAQUEFALAR_TESTE_MEMORIA")) {
    return {
      async set(k, v) { memoria.set(k, v); },
      async get(k, o = {}) {
        if (!memoria.has(k)) return null;
        const v = memoria.get(k);
        return o.type === "json" ? JSON.parse(v) : v;
      },
    };
  }
  return getStore({ name: "media", consistency: "strong" });
}

export const PARTE = 4 * 1024 * 1024; // 4 MB por parte (limite das funções: 6 MB)

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
export const erro = (mensagem, status = 400) => json({ erro: mensagem }, status);

export const novoToken = () => randomBytes(24).toString("base64url");
export const tokenValido = (t) => typeof t === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(t);

export function isAdmin(req) {
  const esperado = env("ADMIN_TOKEN");
  if (!esperado || esperado.length < 16) return false;
  const recebido = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}
export const semAdmin = () =>
  erro(env("ADMIN_TOKEN") ? "Chave de administração inválida." : "Falta configurar ADMIN_TOKEN na Netlify.", 401);

export async function lerJson(req, max = 1_000_000) {
  const txt = await req.text();
  if (txt.length > max) throw new ErroPedido("Pedido demasiado grande.", 413);
  try { return JSON.parse(txt || "{}"); } catch { throw new ErroPedido("JSON inválido."); }
}
export class ErroPedido extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
export const tratar = (fn) => async (req, ctx) => {
  try { return await fn(req, ctx); }
  catch (e) {
    if (e instanceof ErroPedido) return erro(e.message, e.status);
    console.error(e);
    return erro("Erro inesperado no servidor.", 500);
  }
};

/* ---------- Ler e montar uma entrega ---------- */
const COLS_ENTREGA = `id, codigo, token, agencia, cliente, mes, rede, to_char(prazo,'YYYY-MM-DD') AS prazo,
  publicados, exemplo, ativo, envio, criado_em, atualizado_em`;

export async function entregaPorToken(token) {
  if (!tokenValido(token)) return null;
  const s = db().sql;
  const [e] = await s`SELECT ${s.raw(COLS_ENTREGA)} FROM entregas WHERE token = ${token} AND ativo`;
  return e || null;
}
export async function entregaPorId(id) {
  const s = db().sql;
  const [e] = await s`SELECT ${s.raw(COLS_ENTREGA)} FROM entregas WHERE id = ${Number(id) || 0}`;
  return e || null;
}

export async function postsDe(entregaId) {
  return db().sql`SELECT id, numero, tipo, rotulo, to_char(data_publicacao,'YYYY-MM-DD') AS "dataPublicacao",
      versao, alteracoes, capa, slides, video, legenda
    FROM posts WHERE entrega_id = ${entregaId} ORDER BY data_publicacao, numero`;
}
export async function respostasDe(entregaId) {
  const rows = await db().sql`SELECT post_id, versao, decisao, comentarios, data FROM respostas WHERE entrega_id = ${entregaId}`;
  const m = {};
  for (const r of rows)
    m[r.post_id] = { postId: r.post_id, versao: r.versao, decisao: r.decisao, comentarios: r.comentarios, data: new Date(r.data).toISOString() };
  return m;
}

/** As respostas ficam fechadas quando o envio cobre a versão atual de todos os posts. */
export const bloqueada = (posts, envio) =>
  !!(envio && envio.versoes && posts.length && posts.every((p) => envio.versoes[p.id] === p.versao));

export async function montarEntrega(e) {
  const [posts, respostas] = await Promise.all([postsDe(e.id), respostasDe(e.id)]);
  return {
    agencia: e.agencia, cliente: e.cliente, mes: e.mes, rede: e.rede, prazoAprovacao: e.prazo,
    exemplo: e.exemplo, publicados: e.publicados, posts, respostas, envio: e.envio,
    fechada: bloqueada(posts, e.envio),
  };
}

/* ---------- Criar ou atualizar uma entrega (usado pelas skills e pela demo) ---------- */
const txt = (v, max = 500) => (v == null ? "" : String(v)).slice(0, max);
const dataISO = (v, campo) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) throw new ErroPedido(`${campo} tem de estar no formato AAAA-MM-DD.`);
  return v;
};
const url = (v) => {
  const s = txt(v, 1000);
  if (s && !/^(https:\/\/|\/)/.test(s)) throw new ErroPedido(`Endereço de ficheiro inválido: ${s.slice(0, 80)}`);
  return s;
};

export function normalizar(d) {
  if (!d || typeof d !== "object") throw new ErroPedido("Dados em falta.");
  const codigo = txt(d.codigo, 60);
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(codigo)) throw new ErroPedido("codigo é obrigatório (ex.: ATL-2612), só letras, números, - _ .");
  const c = d.cliente || {};
  if (!c.nome || !c.handle) throw new ErroPedido("cliente.nome e cliente.handle são obrigatórios.");
  const cliente = {
    nome: txt(c.nome, 120), handle: txt(c.handle, 60).replace(/^@/, ""), avatar: url(c.avatar),
    categoria: txt(c.categoria, 80), bio: txt(c.bio, 300), link: txt(c.link, 200),
    publicacoes: c.publicacoes ?? "", seguidores: c.seguidores ?? "", aSeguir: c.aSeguir ?? "",
  };
  if (!Array.isArray(d.posts) || !d.posts.length) throw new ErroPedido("A entrega precisa de pelo menos um post.");
  if (d.posts.length > 60) throw new ErroPedido("Máximo de 60 posts por entrega.");
  const ids = new Set();
  const posts = d.posts.map((p, i) => {
    const id = txt(p.id, 60);
    if (!/^[A-Za-z0-9._-]{2,60}$/.test(id)) throw new ErroPedido(`Post ${i + 1}: id inválido.`);
    if (ids.has(id)) throw new ErroPedido(`ID repetido: ${id}`);
    ids.add(id);
    if (!["carrossel", "reel", "imagem"].includes(p.tipo)) throw new ErroPedido(`${id}: tipo tem de ser carrossel, reel ou imagem.`);
    const slides = (Array.isArray(p.slides) ? p.slides : []).slice(0, 20).map(url);
    const capa = url(p.capa) || slides[0] || "";
    if (!capa) throw new ErroPedido(`${id}: falta a capa.`);
    if (p.tipo === "reel" && !p.video) throw new ErroPedido(`${id}: o reel precisa de video.`);
    return {
      id, numero: Number(p.numero) || i + 1, tipo: p.tipo, rotulo: txt(p.rotulo, 60),
      dataPublicacao: dataISO(p.dataPublicacao, `${id}: dataPublicacao`),
      versao: p.versao ? Math.max(1, Number(p.versao) | 0) : null, alteracoes: txt(p.alteracoes, 600),
      capa, slides: slides.length ? slides : [capa], video: url(p.video), legenda: txt(p.legenda, 2200),
    };
  });
  return {
    codigo, agencia: txt(d.agencia || "daquefalar", 80), cliente, mes: txt(d.mes, 40) || "—",
    rede: txt(d.rede || "instagram", 30), prazo: d.prazoAprovacao ? dataISO(d.prazoAprovacao, "prazoAprovacao") : null,
    exemplo: !!d.exemplo,
    publicados: (Array.isArray(d.publicados) ? d.publicados : []).slice(0, 12).map((p) => ({ capa: url(p.capa), tipo: txt(p.tipo, 20) || "imagem" })),
    posts,
  };
}

const CAMPOS = ["tipo", "rotulo", "dataPublicacao", "capa", "video", "legenda"];
const mudou = (a, b) => CAMPOS.some((k) => a[k] !== b[k]) || JSON.stringify(a.slides) !== JSON.stringify(b.slides);

/** Cria a entrega (ou atualiza a que tem o mesmo código, mantendo o link). Sobe a versão dos posts alterados. */
export async function gravarEntrega(dados) {
  const d = normalizar(dados);
  const client = await db().pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [atual] } = await client.query("SELECT id, token FROM entregas WHERE codigo = $1 FOR UPDATE", [d.codigo]);
    let id, token;
    const vals = [d.agencia, JSON.stringify(d.cliente), d.mes, d.rede, d.prazo, JSON.stringify(d.publicados), d.exemplo];
    if (atual) {
      ({ id, token } = atual);
      await client.query(
        `UPDATE entregas SET agencia=$1, cliente=$2::jsonb, mes=$3, rede=$4, prazo=$5, publicados=$6::jsonb, exemplo=$7,
           ativo=true, atualizado_em=now() WHERE id=$8`, [...vals, id]);
    } else {
      token = novoToken();
      const r = await client.query(
        `INSERT INTO entregas (agencia, cliente, mes, rede, prazo, publicados, exemplo, codigo, token)
         VALUES ($1,$2::jsonb,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING id`,
        [...vals, d.codigo, token]);
      id = r.rows[0].id;
    }
    const { rows: antigos } = await client.query(
      `SELECT id, tipo, rotulo, to_char(data_publicacao,'YYYY-MM-DD') AS "dataPublicacao", versao, capa, slides, video, legenda
       FROM posts WHERE entrega_id=$1`, [id]);
    const porId = Object.fromEntries(antigos.map((p) => [p.id, p]));
    const resumo = { novos: 0, novasVersoes: 0, iguais: 0, removidos: 0 };
    for (const p of d.posts) {
      const a = porId[p.id];
      // Versão: a indicada, mas nunca abaixo da atual; se o conteúdo mudou, sobe automaticamente.
      const versao = !a ? p.versao || 1 : Math.max(p.versao || 0, mudou(a, p) ? a.versao + 1 : a.versao);
      if (!a) resumo.novos++; else if (versao !== a.versao) resumo.novasVersoes++; else resumo.iguais++;
      await client.query(
        `INSERT INTO posts (entrega_id, id, numero, tipo, rotulo, data_publicacao, versao, alteracoes, capa, slides, video, legenda)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
         ON CONFLICT (entrega_id, id) DO UPDATE SET numero=EXCLUDED.numero, tipo=EXCLUDED.tipo, rotulo=EXCLUDED.rotulo,
           data_publicacao=EXCLUDED.data_publicacao, versao=EXCLUDED.versao, alteracoes=EXCLUDED.alteracoes, capa=EXCLUDED.capa,
           slides=EXCLUDED.slides, video=EXCLUDED.video, legenda=EXCLUDED.legenda`,
        [id, p.id, p.numero, p.tipo, p.rotulo, p.dataPublicacao, versao, p.alteracoes, p.capa, JSON.stringify(p.slides), p.video, p.legenda]);
    }
    const manter = d.posts.map((p) => p.id);
    const rem = await client.query("DELETE FROM posts WHERE entrega_id=$1 AND NOT (id = ANY($2::text[]))", [id, manter]);
    resumo.removidos = rem.rowCount;
    await client.query("DELETE FROM respostas WHERE entrega_id=$1 AND NOT (post_id = ANY($2::text[]))", [id, manter]);
    await client.query("COMMIT");
    return { id, codigo: d.codigo, token, resumo };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.code === "23505") throw new ErroPedido("Conflito ao gravar: tente novamente.", 409);
    throw e;
  } finally {
    client.release();
  }
}

export const linkDe = (req, token) => new URL(`/e/${token}`, req.url).toString();
