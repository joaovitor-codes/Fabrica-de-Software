-- Intolerância à lactose foi cadastrada como doenca_cronica em alguns bancos.
-- Só corrige o registro com esse nome (com ou sem acento) e esse tipo errado.
UPDATE "restricoes_alimentares"
SET "tipo" = 'intolerancia'
WHERE "tipo" = 'doenca_cronica'
  AND "nome" ILIKE 'intoler_ncia _ lactose';
