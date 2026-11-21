#!/usr/bin/env node
// Ferramenta de linha de comandos da plataforma de aprovação — usada pelas skills (Node 18 ou superior).
//
// Configuração (variáveis de ambiente):
//   DAQUEFALAR_SITE          endereço da plataforma, ex.: https://daquefalar-aprovacao.netlify.app
//   DAQUEFALAR_ADMIN_TOKEN   a mesma chave definida em ADMIN_TOKEN na Netlify
//
// Comandos:
//   node scripts/daquefalar.mjs enviar <pasta>      envia <pasta>/dados.json e os ficheiros locais que ele refere; mostra o link
//   node scripts/daquefalar.mjs listar              lista as entregas e o estado de cada uma
//   node scripts/daquefalar.mjs respostas <id>      devolve em JSON os posts, as respostas e os comentários de uma entrega
//   node scripts/daquefalar.mjs desativar <id>      desativa o link de uma entrega
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";

const SITE = (process.env.DAQUEFALAR_SITE || "").replace(/\/+$/, "");
const CHAVE = process.env.DAQUEFALAR_ADMIN_TOKEN || "";
const PARTE = 4 * 1024 * 1024;

function sair(msg) { console.error("Erro: " + msg); process.exit(1); }
if (!SITE || !CHAVE) sair("defina DAQUEFALAR_SITE e DAQUEFALAR_ADMIN_TOKEN.");

async function api(path, opt = {}) {
  const r = await fetch(SITE + path, { ...opt, headers: { authorization: `Bearer ${CHAVE}`, ...(opt.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || `HTTP ${r.status} em ${path}`);
  return d;
}

const cache = new Map();
async function subir(caminho) {
  if (cache.has(caminho)) return cache.get(caminho);
  const buf = await readFile(caminho);
  const nome = encodeURIComponent(basename(caminho));
  let url;
  if (buf.byteLength <= PARTE) {
    ({ url } = await api(`/api/admin/media?nome=${nome}`, { method: "POST", body: buf }));
  } else {
    const ini = await api(`/api/admin/media?nome=${nome}&tamanho=${buf.byteLength}`, { method: "POST" });
    for (let i = 0; i < ini.partes; i++) {
      await api(`/api/admin/media/${ini.key}/${i}`, { method: "PUT", body: buf.subarray(i * PARTE, (i + 1) * PARTE) });
      process.stderr.write(`  ${basename(caminho)}: parte ${i + 1}/${ini.partes}\n`);
    }
    url = ini.url;
  }
  cache.set(caminho, url);
  process.stderr.write(`  ✓ ${basename(caminho)}\n`);
  return url;
}

// Endereços http(s) ou começados por "/" ficam como estão; o resto é um ficheiro local relativo à pasta.
async function resolver(v, pasta) {
  if (!v || /^https?:\/\//.test(v) || v.startsWith("/")) return v || "";
  const caminho = resolve(pasta, v);
  try { await stat(caminho); } catch { sair(`ficheiro não encontrado: ${caminho}`); }
  return subir(caminho);
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "enviar") {
    if (!arg) sair("indique a pasta, ex.: enviar entregas/ATL-2612");
    const ficheiro = arg.endsWith(".json") ? resolve(arg) : join(resolve(arg), "dados.json");
    const pasta = dirname(ficheiro);
    const dados = JSON.parse(await readFile(ficheiro, "utf8"));
    console.error(`A enviar ficheiros de ${pasta}…`);
    if (dados.cliente?.avatar) dados.cliente.avatar = await resolver(dados.cliente.avatar, pasta);
    for (const p of dados.posts || []) {
      p.slides = await Promise.all((p.slides || []).map((s) => resolver(s, pasta)));
      p.capa = await resolver(p.capa, pasta);
      p.video = await resolver(p.video, pasta);
    }
    for (const p of dados.publicados || []) p.capa = await resolver(p.capa, pasta);
    const r = await api("/api/admin/entregas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(dados) });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === "listar") {
    console.log(JSON.stringify(await api("/api/admin/entregas"), null, 2));
  } else if (cmd === "respostas") {
    if (!arg) sair("indique o id da entrega (veja com: listar)");
    console.log(JSON.stringify(await api(`/api/admin/entregas/${arg}`), null, 2));
  } else if (cmd === "desativar") {
    if (!arg) sair("indique o id da entrega");
    await api(`/api/admin/entregas/${arg}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ativo: false }) });
    console.log("Link desativado.");
  } else {
    console.log("Comandos: enviar <pasta> · listar · respostas <id> · desativar <id>");
  }
} catch (e) { sair(e.message); }
