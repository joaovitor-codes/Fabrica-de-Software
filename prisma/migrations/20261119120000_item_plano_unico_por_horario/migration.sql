-- Um item por dia e refeição no plano alimentar. A checagem do serviço
-- (findFirst antes do create) deixava pedidos simultâneos gravarem o mesmo
-- horário mais de uma vez; o índice único fecha a corrida no banco.
DROP INDEX "plano_alimentar_itens_plano_alimentar_id_dia_semana_tipo_re_idx";

CREATE UNIQUE INDEX "plano_alimentar_itens_plano_alimentar_id_dia_semana_tipo_re_key" ON "plano_alimentar_itens"("plano_alimentar_id", "dia_semana", "tipo_refeicao");
