-- AlterTable
ALTER TABLE "receitas" ADD COLUMN     "ingredientes_nao_listados" TEXT[] DEFAULT ARRAY[]::TEXT[];
