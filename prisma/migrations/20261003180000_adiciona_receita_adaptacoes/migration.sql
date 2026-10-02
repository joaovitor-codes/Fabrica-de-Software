-- CreateTable
CREATE TABLE "receita_adaptacoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receita_origem_id" UUID NOT NULL,
    "versao_origem" INTEGER NOT NULL,
    "receita_adaptada_id" UUID NOT NULL,
    "restricao_id" UUID NOT NULL,
    "resumo_ia" TEXT,
    "trocas" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receita_adaptacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receita_adaptacoes_receita_adaptada_id_key" ON "receita_adaptacoes"("receita_adaptada_id");

-- CreateIndex
CREATE UNIQUE INDEX "receita_adaptacoes_receita_origem_id_restricao_id_key" ON "receita_adaptacoes"("receita_origem_id", "restricao_id");

-- AddForeignKey
ALTER TABLE "receita_adaptacoes" ADD CONSTRAINT "receita_adaptacoes_receita_origem_id_fkey" FOREIGN KEY ("receita_origem_id") REFERENCES "receitas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_adaptacoes" ADD CONSTRAINT "receita_adaptacoes_receita_adaptada_id_fkey" FOREIGN KEY ("receita_adaptada_id") REFERENCES "receitas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_adaptacoes" ADD CONSTRAINT "receita_adaptacoes_restricao_id_fkey" FOREIGN KEY ("restricao_id") REFERENCES "restricoes_alimentares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

