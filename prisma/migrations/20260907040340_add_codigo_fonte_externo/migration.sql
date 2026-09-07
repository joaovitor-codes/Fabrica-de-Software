/*
  Warnings:

  - You are about to drop the column `codigo_fonte_externo` on the `ingredientes` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "ingredientes_codigo_fonte_externo_key";

-- AlterTable
ALTER TABLE "ingredientes" DROP COLUMN "codigo_fonte_externo";
