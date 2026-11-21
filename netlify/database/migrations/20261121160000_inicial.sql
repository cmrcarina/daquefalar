-- Estrutura inicial da plataforma de aprovação

CREATE TABLE entregas (
  id            SERIAL PRIMARY KEY,
  codigo        TEXT NOT NULL UNIQUE,          -- ex.: ATL-2612 (cliente + mês)
  token         TEXT NOT NULL UNIQUE,          -- link secreto: /e/<token>
  agencia       TEXT NOT NULL DEFAULT 'daquefalar',
  cliente       JSONB NOT NULL,                -- nome, handle, bio, link, números…
  mes           TEXT NOT NULL,                 -- ex.: Dezembro 2026
  rede          TEXT NOT NULL DEFAULT 'instagram',
  prazo         DATE,
  publicados    JSONB NOT NULL DEFAULT '[]',   -- últimos posts já no perfil
  exemplo       BOOLEAN NOT NULL DEFAULT false,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  envio         JSONB,                         -- preenchido quando o cliente envia
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE posts (
  entrega_id      INTEGER NOT NULL REFERENCES entregas(id) ON DELETE CASCADE,
  id              TEXT NOT NULL,               -- ID único do post, ex.: ATL-2612-03
  numero          INTEGER NOT NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('carrossel', 'reel', 'imagem')),
  rotulo          TEXT NOT NULL DEFAULT '',
  data_publicacao DATE NOT NULL,
  versao          INTEGER NOT NULL DEFAULT 1,
  alteracoes      TEXT NOT NULL DEFAULT '',
  capa            TEXT NOT NULL DEFAULT '',
  slides          JSONB NOT NULL DEFAULT '[]',
  video           TEXT NOT NULL DEFAULT '',
  legenda         TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (entrega_id, id)
);

-- Decisão atual do cliente para cada post
CREATE TABLE respostas (
  entrega_id  INTEGER NOT NULL REFERENCES entregas(id) ON DELETE CASCADE,
  post_id     TEXT NOT NULL,
  versao      INTEGER NOT NULL,
  decisao     TEXT NOT NULL CHECK (decisao IN ('aprovado', 'alteracoes')),
  comentarios JSONB NOT NULL DEFAULT '[]',
  data        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entrega_id, post_id)
);

-- Histórico de todas as decisões (nada se perde)
CREATE TABLE respostas_historico (
  id          SERIAL PRIMARY KEY,
  entrega_id  INTEGER NOT NULL REFERENCES entregas(id) ON DELETE CASCADE,
  post_id     TEXT NOT NULL,
  versao      INTEGER NOT NULL,
  decisao     TEXT NOT NULL,
  comentarios JSONB NOT NULL DEFAULT '[]',
  data        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX respostas_historico_entrega ON respostas_historico (entrega_id, data);
