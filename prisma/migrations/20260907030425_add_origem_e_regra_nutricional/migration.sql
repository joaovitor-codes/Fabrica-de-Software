-- CreateEnum
CREATE TYPE "origem_vinculo_restricao_enum" AS ENUM ('manual', 'automatico_regra_nutricional', 'automatico_confirmado_curadoria');

-- AlterTable
ALTER TABLE "ingrediente_restricoes" ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "origem" "origem_vinculo_restricao_enum" NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "restricao_regras_nutricionais" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restricao_id" UUID NOT NULL,
    "campo_nutricional" VARCHAR(50) NOT NULL,
    "operador" VARCHAR(2) NOT NULL,
    "valor_limite" DECIMAL(8,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "restricao_regras_nutricionais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restricao_regras_nutricionais_restricao_id_idx" ON "restricao_regras_nutricionais"("restricao_id");

-- AddForeignKey
ALTER TABLE "restricao_regras_nutricionais" ADD CONSTRAINT "restricao_regras_nutricionais_restricao_id_fkey" FOREIGN KEY ("restricao_id") REFERENCES "restricoes_alimentares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
