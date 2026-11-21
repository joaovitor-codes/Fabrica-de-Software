-- Avisos da aprovação profissional (D4/D5): o que o usuário tinha à venda
-- sai do ar, uma notificação por item. Entram por migration pelo mesmo motivo
-- de tipos_notificacao_marketplace: sem a linha, a notificação falha.
INSERT INTO tipos_notificacao (codigo, nome, descricao) VALUES
  ('receita_venda_pausada', 'Venda de receita pausada', 'A oferta de uma receita sua foi pausada porque seu cadastro profissional foi aprovado'),
  ('produto_pausado',       'Produto pausado',          'Um produto seu foi pausado porque seu cadastro profissional foi aprovado')
ON CONFLICT (codigo) DO NOTHING;
