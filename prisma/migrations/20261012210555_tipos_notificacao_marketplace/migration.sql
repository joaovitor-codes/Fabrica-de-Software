-- Tipos de notificação do marketplace. Entram por migration (e não por seed)
-- porque o NotificacaoService busca o tipo pelo código: sem a linha, a
-- notificação falha.
INSERT INTO tipos_notificacao (codigo, nome, descricao) VALUES
  ('receita_vendida',     'Receita vendida',     'Uma receita sua foi comprada'),
  ('compra_liberada',     'Compra liberada',     'O pagamento foi aprovado e a receita está disponível'),
  ('reembolso_resolvido', 'Reembolso resolvido', 'Seu pedido de reembolso foi analisado'),
  ('produto_removido',    'Produto removido',    'Um produto seu foi removido pela moderação')
ON CONFLICT (codigo) DO NOTHING;
