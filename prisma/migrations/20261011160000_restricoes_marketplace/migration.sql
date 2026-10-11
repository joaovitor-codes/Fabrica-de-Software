-- SQL raw da v5 que o Prisma não expressa (ver cabeçalho do schema.prisma).

-- ---------------------------------------------------------------------
-- 1) Exclusive Arc em pagamentos: um pagamento é de uma assinatura ou
--    de uma compra de receita, nunca dos dois.
-- ---------------------------------------------------------------------

ALTER TABLE pagamentos
ADD CONSTRAINT chk_pagamento_exclusive_arc
CHECK (num_nonnulls(assinatura_id, receita_compra_id) = 1);

-- ---------------------------------------------------------------------
-- 2) No máximo uma compra "viva" por comprador e oferta. Compras
--    canceladas ou reembolsadas ficam como histórico e não impedem
--    uma nova tentativa.
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX uq_receita_compra_viva
ON receita_compras (oferta_id, comprador_id)
WHERE status IN ('pendente', 'paga', 'reembolso_em_analise');

-- ---------------------------------------------------------------------
-- 3) Exclusive Arc em notificacoes: o arco passa a ter 6 colunas
--    (entra produto_id).
-- ---------------------------------------------------------------------

ALTER TABLE notificacoes DROP CONSTRAINT chk_notificacao_exclusive_arc;

ALTER TABLE notificacoes
ADD CONSTRAINT chk_notificacao_exclusive_arc
CHECK (
    num_nonnulls(
        receita_id,
        assinatura_id,
        plano_alimentar_item_id,
        indicacao_id,
        anamnese_id,
        produto_id
    ) = 1
);
