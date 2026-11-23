-- Ligação ao plano do mês (Google Sheets) e estado da escrita das respostas no plano
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS planilha TEXT;          -- ID do Google Sheet de onde a entrega foi importada
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS sincronizacao JSONB;    -- { data, ok, mensagem, historicoDe }
