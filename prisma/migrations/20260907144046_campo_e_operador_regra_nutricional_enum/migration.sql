/*
  Warnings:

  - Changed the type of `campo_nutricional` on the `restricao_regras_nutricionais` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `operador` on the `restricao_regras_nutricionais` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "campo_nutricional_regra_enum" AS ENUM ('calorias_kcal', 'proteinas_g', 'carboidratos_g', 'gorduras_g', 'fibras_g', 'sodio_mg');

-- CreateEnum
CREATE TYPE "operador_regra_nutricional_enum" AS ENUM ('maior_que', 'maior_igual', 'menor_que', 'menor_igual');

-- AlterTable
ALTER TABLE "restricao_regras_nutricionais" DROP COLUMN "campo_nutricional",
ADD COLUMN     "campo_nutricional" "campo_nutricional_regra_enum" NOT NULL,
DROP COLUMN "operador",
ADD COLUMN     "operador" "operador_regra_nutricional_enum" NOT NULL;
