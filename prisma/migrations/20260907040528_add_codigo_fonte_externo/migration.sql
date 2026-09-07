/*
  Warnings:

  - A unique constraint covering the columns `[codigo_fonte_externo]` on the table `ingredientes` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ingredientes" ADD COLUMN     "codigo_fonte_externo" VARCHAR(50);

-- CreateIndex
CREATE UNIQUE INDEX "ingredientes_codigo_fonte_externo_key" ON "ingredientes"("codigo_fonte_externo");
