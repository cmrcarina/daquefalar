# daquefalar — Plataforma de aprovação

Página onde o cliente vê o feed do mês, abre cada publicação e aprova ou pede alterações.
Tudo vive na Netlify: a página, a base de dados (Netlify Database / Postgres), os ficheiros (Netlify Blobs) e a API (Netlify Functions).

```
public/
  index.html          página do cliente (abre em /e/<link-secreto>)
  painel.html         o teu painel: entregas, estado, comentários e links
  exemplo/            entrega de exemplo (Atelier Lume) para testar
netlify/
  database/migrations/  estrutura da base de dados (aplicada sozinha a cada publicação)
  functions/            a API
  lib/comum.mjs         código partilhado
scripts/daquefalar.mjs   ferramenta para as skills enviarem entregas e lerem respostas
netlify.toml            configuração
```

---

## 1. Pôr no ar (uma vez)

### 1.1 Criar o repositório no GitHub
1. Em github.com, clica em **New repository**.
2. Nome: `daquefalar-aprovacao`. Escolhe **Private**. Não acrescentes README nem .gitignore. Clica em **Create repository**.
3. Na página do repositório vazio, clica em **uploading an existing file**.
4. Arrasta **o conteúdo** da pasta `daquefalar-aprovacao` (não a pasta em si): `public`, `netlify`, `scripts`, `netlify.toml`, `package.json`, `package-lock.json`, `README.md` e `.gitignore`.
   Se o `.gitignore` não aparecer (ficheiros começados por ponto ficam escondidos), não faz mal.
5. Clica em **Commit changes**.

### 1.2 Ligar à Netlify
1. Em app.netlify.com: **Add new project → Import an existing project → GitHub**.
2. Autoriza o acesso e escolhe o repositório `daquefalar-aprovacao`.
3. Deixa as definições como estão (já vêm do `netlify.toml`) e clica em **Deploy**.
4. Durante a publicação, a Netlify cria a base de dados e aplica a estrutura automaticamente.

### 1.3 Criar a chave de administração
A chave protege o painel e a API das skills. Nunca a partilhes com clientes.
1. Na Netlify, abre o projeto: **Project configuration → Environment variables → Add a variable**.
2. Nome: `ADMIN_TOKEN`. Valor: uma frase longa e aleatória (32 caracteres ou mais).
   Podes gerar uma em https://1password.com/password-generator (escolhe 40 caracteres, só letras e números).
3. Guarda a chave num gestor de passwords.
4. Vai a **Deploys → Trigger deploy → Deploy project**, para a chave entrar em vigor.

### 1.4 Testar
1. Abre `https://<o-teu-projeto>.netlify.app/painel` e entra com a chave.
2. Clica em **Criar entrega de exemplo**, depois em **Abrir**: estás a ver o que o cliente vê.
3. Aprova uns posts, pede uma alteração e envia. Volta ao painel e clica em **Atualizar**: vês as respostas e os comentários.

### 1.5 Domínio próprio (quando quiseres)
1. Na Netlify: **Domain management → Add a domain** → `aprovacao.teudominio.pt`.
2. A Netlify indica um registo **CNAME**. Cria-o na Dynadot (**My Domains → DNS Settings**):
   tipo `CNAME`, nome `aprovacao`, valor `<o-teu-projeto>.netlify.app`.
3. Em alguns minutos a uma hora, o endereço fica ativo, com HTTPS automático.
   Os links e as imagens usam endereços relativos, por isso nada se parte quando mudas de domínio.

### Opcional: aviso quando o cliente envia
Cria a variável `NOTIFICAR_URL` com o endereço de um webhook (Make, Zapier, n8n ou Slack).
Quando um cliente envia as respostas, a plataforma faz POST para lá com:
`{ evento, codigo, cliente, mes, data, aprovados, alteracoes, versoes }`.

---

## 2. Criar uma entrega a partir do Google Drive

No painel, em **Nova entrega a partir do Drive**, cola o link do plano do mês e carrega em **Importar**.

O que a plataforma faz:
1. Lê o separador **Perfil** (2.º separador) e o separador **Posts** (1.º separador) do plano.
2. Fica só com os posts em estado **Revisto** ou seguinte. Os que estão em Planeado, Copy feito ou Design feito ficam de fora.
3. Encontra a pasta de cada post dentro da **Pasta do mês (link)**, pelo nome que começa com o ID (ex.: `ATL-2612-03 Peça da semana`). Também aceita o link da pasta na coluna "Pasta no Drive".
4. Usa a subpasta de versão mais alta (`v1`, `v2`…) e os ficheiros por ordem de nome (`01.jpg`, `02.jpg`…). Nos reels, usa `capa.jpg` e o vídeo.
5. Vai buscar a foto de perfil ao link da linha **Foto de perfil (link)** do separador Perfil (ex.: `00 Marca/perfil.jpg`). Para mudar a foto, troca a imagem no Drive, cola o link novo e importa outra vez.
6. Copia as imagens e os vídeos para a plataforma, em partes de 4 MB, e cria ou atualiza a entrega. O link do cliente mantém-se.

Requisitos:
- A pasta `daquefalar` tem de estar partilhada com **Qualquer pessoa com o link (Leitor)**. É provisório: mais tarde passa a acesso privado, através de uma conta de serviço.
- Opcional: a variável `GOOGLE_API_KEY` (uma chave da Google Cloud com a API do Drive ativa) faz a plataforma usar a API oficial para listar as pastas. Usa-a se a importação disser que não consegue ler uma pasta.

## 3. Como funciona uma entrega

- Cada entrega é **um cliente num mês**, identificada por um `codigo` (ex.: `ATL-2612`).
- Ao criar uma entrega, a plataforma gera um **link secreto** (`/e/<token>`). Só quem tem o link vê o conteúdo.
- Enviar outra vez com o **mesmo codigo** atualiza a entrega e **mantém o link**.
  - Os posts com conteúdo diferente (imagens, vídeo, legenda, data, tipo, rótulo) **sobem de versão** sozinhos (v2, v3…) e voltam a ficar "por rever" para o cliente.
  - Os posts iguais mantêm a resposta que o cliente já deu.
  - Usa o campo `alteracoes` do post para explicar ao cliente o que mudou.
- Depois de o cliente **enviar**, as respostas ficam fechadas. Reabrem sozinhas quando chega uma nova versão de algum post, ou à mão, no painel.
- No painel podes **desativar o link** (no fim do mês) ou **gerar um link novo** (se o link foi partilhado por engano).

---

## 4. Para as skills

### Configuração
No ambiente onde a skill corre:
```
DAQUEFALAR_SITE=https://aprovacao.teudominio.pt
DAQUEFALAR_ADMIN_TOKEN=<a chave ADMIN_TOKEN>
```
> Se a skill correr no Claude, o domínio da plataforma tem de estar autorizado nas definições de rede da conta
> (em contas de equipa: Admin settings → Capabilities).

### Formato da pasta de uma entrega
```
entregas/ATL-2612/
  dados.json
  ATL-2612-01-1.jpg  ATL-2612-01-2.jpg  …
  ATL-2612-02.mp4    ATL-2612-02-capa.jpg
```

`dados.json`. Os caminhos de ficheiros são relativos à pasta, e o script envia-os sozinho:
```json
{
  "codigo": "ATL-2612",
  "agencia": "daquefalar",
  "cliente": {
    "nome": "Atelier Lume", "handle": "atelierlume", "avatar": "avatar.jpg",
    "categoria": "Estúdio de cerâmica",
    "bio": "Cerâmica feita à mão em Lisboa\nPeças únicas e workshops",
    "link": "atelierlume.pt",
    "publicacoes": 186, "seguidores": "12,4 mil", "aSeguir": 402
  },
  "mes": "Dezembro 2026",
  "rede": "instagram",
  "prazoAprovacao": "2026-11-28",
  "posts": [
    {
      "id": "ATL-2612-01", "numero": 1, "tipo": "carrossel", "rotulo": "Guia de presentes",
      "dataPublicacao": "2026-12-01",
      "slides": ["ATL-2612-01-1.jpg", "ATL-2612-01-2.jpg"],
      "legenda": "Texto da legenda com #hashtags e @menções",
      "alteracoes": ""
    },
    {
      "id": "ATL-2612-02", "numero": 2, "tipo": "reel", "rotulo": "No torno",
      "dataPublicacao": "2026-12-03",
      "capa": "ATL-2612-02-capa.jpg", "video": "ATL-2612-02.mp4",
      "legenda": "…"
    }
  ],
  "publicados": [ { "capa": "pub-1.jpg", "tipo": "imagem" } ]
}
```
Regras: `tipo` é `carrossel`, `reel` ou `imagem`. As datas são `AAAA-MM-DD`. A capa de um carrossel é o 1.º slide, se não indicares outra. Os vídeos podem ir até 500 MB (são enviados em partes de 4 MB).

### Comandos
```
node scripts/daquefalar.mjs enviar entregas/ATL-2612   # cria/atualiza e devolve { id, link, resumo }
node scripts/daquefalar.mjs listar                     # todas as entregas e o progresso
node scripts/daquefalar.mjs respostas <id>             # posts + respostas + comentários + histórico (JSON)
node scripts/daquefalar.mjs desativar <id>
```

### Resposta de `respostas <id>` (o que a skill de feedback lê)
```json
{
  "codigo": "ATL-2612", "link": "…", "envio": { "data": "…", "aprovados": 8, "alteracoes": 1, "versoes": {…} },
  "posts": [ { "id": "ATL-2612-01", "versao": 1, … } ],
  "respostas": {
    "ATL-2612-01": { "versao": 1, "decisao": "alteracoes",
                     "comentarios": [ { "slide": "Slide 2 de 5", "texto": "Trocar 'fundas' por 'largas'." } ],
                     "data": "…" }
  },
  "historico": [ … ]
}
```
Uma resposta só conta se `respostas[id].versao === posts[i].versao`.

### API (se preferires chamar diretamente)
Todas as chamadas de administração levam o cabeçalho `Authorization: Bearer <ADMIN_TOKEN>`.

| Método | Caminho | O que faz |
|---|---|---|
| GET | `/api/admin/entregas` | lista |
| POST | `/api/admin/entregas` | cria/atualiza (corpo = dados.json com endereços já enviados) |
| GET | `/api/admin/entregas/:id` | detalhe e respostas |
| PATCH | `/api/admin/entregas/:id` | `{"ativo":false}` · `{"novoLink":true}` · `{"reabrir":true}` |
| POST | `/api/admin/media?nome=x.jpg` | envia um ficheiro até 4 MB → `{ url }` |
| POST | `/api/admin/media?nome=x.mp4&tamanho=N` | inicia um envio em partes → `{ key, partes }` |
| PUT | `/api/admin/media/:key/:parte` | envia a parte N (4 MB) |
| POST | `/api/admin/demo` | cria ou repõe a entrega de exemplo |

---

## 5. Segurança e limites
- Os clientes só têm acesso pelo link secreto (32 caracteres aleatórios), e cada link abre só a sua entrega.
- Os clientes só conseguem gravar respostas. Não alteram o conteúdo nem veem outras entregas.
- As imagens e os vídeos são servidos por endereços impossíveis de adivinhar, mas não são privados: quem tiver o endereço de um ficheiro consegue abri-lo.
- A página não aparece nos motores de busca (`noindex`).
- Plano gratuito da Netlify: a base de dados consome créditos quando está ativa. Consulta o consumo em **Usage** no primeiro mês.
