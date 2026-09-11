-- CreateTable
CREATE TABLE "ingrediente_substitutos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ingrediente_origem_id" UUID NOT NULL,
    "restricao_id" UUID NOT NULL,
    "ingrediente_destino_id" UUID NOT NULL,
    "calorias_kcal" DECIMAL(8,2),
    "proteinas_g" DECIMAL(8,2),
    "carboidratos_g" DECIMAL(8,2),
    "gorduras_g" DECIMAL(8,2),
    "fibras_g" DECIMAL(8,2),
    "sodio_mg" DECIMAL(8,2),
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingrediente_substitutos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingrediente_substitutos_ingrediente_origem_id_restricao_id_idx" ON "ingrediente_substitutos"("ingrediente_origem_id", "restricao_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingrediente_substitutos_ingrediente_origem_id_restricao_id__key" ON "ingrediente_substitutos"("ingrediente_origem_id", "restricao_id", "ingrediente_destino_id");

-- AddForeignKey
ALTER TABLE "ingrediente_substitutos" ADD CONSTRAINT "ingrediente_substitutos_restricao_id_fkey" FOREIGN KEY ("restricao_id") REFERENCES "restricoes_alimentares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingrediente_substitutos" ADD CONSTRAINT "ingrediente_substitutos_ingrediente_origem_id_fkey" FOREIGN KEY ("ingrediente_origem_id") REFERENCES "ingredientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingrediente_substitutos" ADD CONSTRAINT "ingrediente_substitutos_ingrediente_destino_id_fkey" FOREIGN KEY ("ingrediente_destino_id") REFERENCES "ingredientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
