-- Conteúdo da versão comprada, gravado na criação da compra. A cópia é
-- montada a partir dele no webhook, e não do estado atual da original.

-- Pendentes antigas não têm o conteúdo guardado: são canceladas e o
-- comprador gera um link novo. Ainda não há compra paga (o webhook nasce
-- junto com esta migration).
UPDATE receita_compras SET status = 'cancelada' WHERE status = 'pendente';

-- O DEFAULT só existe para preencher as linhas que já existem.
ALTER TABLE receita_compras ADD COLUMN conteudo_comprado JSONB NOT NULL DEFAULT '{}';
ALTER TABLE receita_compras ALTER COLUMN conteudo_comprado DROP DEFAULT;
