-- AlterTable
ALTER TABLE "receita_adaptacoes" ADD COLUMN     "paciente_id" UUID,
ALTER COLUMN "restricao_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "receita_adaptacoes_paciente_id_idx" ON "receita_adaptacoes"("paciente_id");

-- AddForeignKey
ALTER TABLE "receita_adaptacoes" ADD CONSTRAINT "receita_adaptacoes_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

