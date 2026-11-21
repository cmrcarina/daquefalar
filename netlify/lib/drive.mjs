// Leitura do Google Drive e do Google Sheets para criar entregas a partir do plano do mês.
// Funciona com pastas partilhadas por "Qualquer pessoa com o link" (sem chave).
// Opcional: com a variável GOOGLE_API_KEY, usa a API oficial do Drive (mais robusta).
import { env, ErroPedido } from "./comum.mjs";

const UA = { "user-agent": "Mozilla/5.0 (compatible; daquefalar-aprovacao)" };
const EXT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
export const extDe = (nome) => (String(nome).split(".").pop() || "").toLowerCase();
export const mimeDe = (nome) => EXT[extDe(nome)] || "";
const ehImagem = (f) => mimeDe(f.nome).startsWith("image/") || (f.mime || "").startsWith("image/");
const ehVideo = (f) => mimeDe(f.nome).startsWith("video/") || (f.mime || "").startsWith("video/");

/** Extrai o ID de um link do Drive ou do Sheets (ou aceita o ID diretamente). */
export function idDe(s) {
  s = String(s || "").trim();
  const m = s.match(/\/(?:folders|d)\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

const semAcentos = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const decodificar = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");

/** CSV (RFC 4180), com campos entre aspas e quebras de linha. */
export function csv(txt) {
  const linhas = []; let campo = "", linha = [], aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) {
      if (c === '"' && txt[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && txt[i + 1] === "\n") i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const pareceHtml = (r) => (r.headers.get("content-type") || "").includes("text/html");
const SEM_PARTILHA = 'Confirme que a pasta "daquefalar" está partilhada com "Qualquer pessoa com o link" (Leitor).';

async function lerSeparador(planilhaId, gid) {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${planilhaId}/export?format=csv&gid=${gid}`, { headers: UA, redirect: "follow" });
  if (!r.ok || pareceHtml(r)) throw new ErroPedido(`Não consegui ler o plano no Google Sheets. ${SEM_PARTILHA}`, 502);
  return csv(await r.text());
}

/** Lista o conteúdo de uma pasta: [{ id, nome, pasta, mime }]. */
export async function listarPasta(pastaId) {
  const chave = env("GOOGLE_API_KEY");
  if (chave) {
    const q = encodeURIComponent(`'${pastaId}' in parents and trashed=false`);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&key=${chave}`, { headers: UA });
    if (!r.ok) throw new ErroPedido(`Não consegui ler uma pasta do Drive (erro ${r.status}). ${SEM_PARTILHA}`, 502);
    const d = await r.json();
    return (d.files || []).map((f) => ({ id: f.id, nome: f.name, pasta: f.mimeType === "application/vnd.google-apps.folder", mime: f.mimeType }));
  }
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${pastaId}`, { headers: UA, redirect: "follow" });
  if (!r.ok) throw new ErroPedido(`Não consegui ler uma pasta do Drive (erro ${r.status}). ${SEM_PARTILHA}`, 502);
  const html = await r.text();
  const itens = [];
  const partes = html.split(/id="entry-/).slice(1);
  for (const p of partes) {
    const id = (p.match(/^([A-Za-z0-9_-]+)"/) || [])[1];
    const href = (p.match(/href="([^"]+)"/) || [])[1] || "";
    const nome = decodificar(((p.match(/flip-entry-title">([^<]*)</) || [])[1] || "").trim());
    if (id && nome) itens.push({ id, nome, pasta: /\/folders\//.test(href), mime: "" });
  }
  if (!itens.length && /ServiceLogin|accounts\.google\.com/.test(html)) throw new ErroPedido(`A pasta do Drive não está acessível. ${SEM_PARTILHA}`, 502);
  return itens;
}

/** Descarrega um intervalo de bytes de um ficheiro do Drive. */
export async function descarregar(id, ini, fim) {
  const chave = env("GOOGLE_API_KEY");
  const url = chave
    ? `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true&key=${chave}`
    : `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  const r = await fetch(url, { headers: { ...UA, range: `bytes=${ini}-${fim}` }, redirect: "follow" });
  if (!r.ok || pareceHtml(r)) throw new ErroPedido(`Não consegui descarregar um ficheiro do Drive (erro ${r.status}). ${SEM_PARTILHA}`, 502);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (r.status === 206) {
    const total = Number((r.headers.get("content-range") || "").split("/")[1]);
    return { buf, total: total || buf.byteLength, parcial: true };
  }
  return { buf, total: buf.byteLength, parcial: false };
}

const ordenarNomes = (a, b) => a.nome.localeCompare(b.nome, "pt", { numeric: true, sensitivity: "base" });
const ETAPAS_ANTES = ["", "planeado", "copy feito", "design feito"];

function dataISO(v) {
  v = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : v;
}

/**
 * Lê o plano do mês (separadores Posts e Perfil) e as pastas dos posts.
 * Devolve { dados, ficheiros, avisos }: em dados, cada imagem/vídeo aparece como "drive:<id>".
 */
export async function montarPlano(link) {
  const planilhaId = idDe(link);
  if (!planilhaId || !/spreadsheets|^[A-Za-z0-9_-]{20,}$/.test(link)) throw new ErroPedido("Cole o link do plano do mês (Google Sheets).");
  const [linhasPosts, linhasPerfil] = await Promise.all([lerSeparador(planilhaId, 0), lerSeparador(planilhaId, 1)]);

  const perfil = {};
  for (const [campo, valor] of linhasPerfil.slice(1)) if (campo) perfil[semAcentos(campo)] = (valor || "").trim();
  const P = (inicio) => { const k = Object.keys(perfil).find((c) => c.startsWith(inicio)); return k ? perfil[k] : ""; };

  const cab = (linhasPosts[0] || []).map(semAcentos);
  const col = (inicio) => cab.findIndex((c) => c.startsWith(inicio));
  const C = { id: col("id"), n: col("n"), data: col("data"), tipo: col("tipo"), rotulo: col("rotulo"), legenda: col("legenda"), estado: col("estado"), mudou: col("o que mudou"), pasta: col("pasta") };
  if (C.id < 0 || C.tipo < 0 || C.data < 0) throw new ErroPedido("O separador Posts tem de ter as colunas ID, Data de publicação e Tipo (o primeiro separador do plano).");

  const avisos = [];
  const linhas = linhasPosts.slice(1).filter((l) => (l[C.id] || "").trim());
  const prontas = linhas.filter((l) => !ETAPAS_ANTES.includes(semAcentos(C.estado >= 0 ? l[C.estado] : "revisto")));
  const ignorados = linhas.length - prontas.length;
  if (ignorados) avisos.push(`${ignorados} post(s) ainda não revistos ficaram de fora.`);
  if (!prontas.length) throw new ErroPedido("Não há posts prontos no plano (estado Revisto ou seguinte).");

  const pastaMesId = idDe(P("pasta do mes"));
  const subpastasMes = pastaMesId ? (await listarPasta(pastaMesId)).filter((f) => f.pasta) : [];

  const ficheiros = new Map();
  const reg = (f) => { ficheiros.set(f.id, { id: f.id, nome: f.nome }); return `drive:${f.id}`; };

  const posts = (await Promise.all(prontas.map(async (l, i) => {
    const id = l[C.id].trim();
    const tipo = semAcentos(l[C.tipo]);
    let pastaId = C.pasta >= 0 ? idDe(l[C.pasta]) : null;
    if (!pastaId) pastaId = (subpastasMes.find((f) => semAcentos(f.nome).startsWith(semAcentos(id))) || {}).id;
    if (!pastaId) { avisos.push(`${id}: não encontrei a pasta do post (nome a começar por "${id}" na pasta do mês).`); return null; }

    let conteudo = await listarPasta(pastaId);
    let versao = 1;
    const versoes = conteudo.filter((f) => f.pasta && /^v\d+$/i.test(f.nome.trim())).map((f) => ({ ...f, n: Number(f.nome.trim().slice(1)) })).sort((a, b) => b.n - a.n);
    if (versoes.length) { versao = versoes[0].n; conteudo = await listarPasta(versoes[0].id); }
    const fs = conteudo.filter((f) => !f.pasta).sort(ordenarNomes);
    const imgs = fs.filter(ehImagem), vids = fs.filter(ehVideo);

    const base = {
      id, numero: Number(l[C.n]) || i + 1, tipo, rotulo: (l[C.rotulo] || "").trim(), dataPublicacao: dataISO(l[C.data]),
      legenda: l[C.legenda] || "", versao, alteracoes: C.mudou >= 0 ? (l[C.mudou] || "").trim() : "",
    };
    if (tipo === "reel") {
      if (!vids.length) { avisos.push(`${id}: falta o vídeo na pasta v${versao}.`); return null; }
      const capa = imgs.find((f) => /^capa/i.test(f.nome)) || imgs[0];
      if (!capa) { avisos.push(`${id}: falta a capa (capa.jpg) na pasta v${versao}.`); return null; }
      return { ...base, capa: reg(capa), slides: [reg(capa)], video: reg(vids[0]) };
    }
    if (!imgs.length) { avisos.push(`${id}: não há imagens na pasta v${versao}.`); return null; }
    const slides = (tipo === "imagem" ? imgs.slice(0, 1) : imgs).map(reg);
    return { ...base, capa: slides[0], slides, video: "" };
  }))).filter(Boolean);

  if (!posts.length) throw new ErroPedido(["Nenhum post pôde ser importado.", ...avisos].join(" "));

  const dados = {
    codigo: P("codigo"), agencia: "daquefalar",
    cliente: {
      nome: P("cliente"), handle: P("handle").replace(/^@/, ""), categoria: P("categoria"), bio: P("bio"), link: P("link"),
      publicacoes: P("publicacoes"), seguidores: P("seguidores"), aSeguir: P("a seguir"),
    },
    mes: P("mes"), rede: P("rede") || "instagram", prazoAprovacao: dataISO(P("prazo")) || undefined,
    posts,
  };
  if (!dados.codigo) throw new ErroPedido('Falta o "Código da entrega" no separador Perfil.');
  return { dados, ficheiros: [...ficheiros.values()], avisos };
}
