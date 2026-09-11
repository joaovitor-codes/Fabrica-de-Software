/*
  Warnings:

  - You are about to drop the column `calorias_kcal` on the `ingrediente_substitutos` table. All the data in the column will be lost.
  - You are about to drop the column `carboidratos_g` on the `ingrediente_substitutos` table. All the data in the column will be lost.
  - You are about to drop the column `fibras_g` on the `ingrediente_substitutos` table. All the data in the column will be lost.
  - You are about to drop the column `gorduras_g` on the `ingrediente_substitutos` table. All the data in the column will be lost.
  - You are about to drop the column `proteinas_g` on the `ingrediente_substitutos` table. All the data in the column will be lost.
  - You are about to drop the column `sodio_mg` on the `ingrediente_substitutos` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ingrediente_substitutos" DROP COLUMN "calorias_kcal",
DROP COLUMN "carboidratos_g",
DROP COLUMN "fibras_g",
DROP COLUMN "gorduras_g",
DROP COLUMN "proteinas_g",
DROP COLUMN "sodio_mg";
