/*
  Warnings:

  - A unique constraint covering the columns `[gateway_cobranca_id]` on the table `pagamentos` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "status_compra_receita_enum" AS ENUM ('pendente', 'paga', 'cancelada', 'reembolso_em_analise', 'reembolsada');

-- CreateEnum
CREATE TYPE "status_recebedor_enum" AS ENUM ('ativo', 'desconectado');

-- CreateEnum
CREATE TYPE "status_produto_enum" AS ENUM ('ativo', 'pausado', 'vendido', 'removido');

-- CreateEnum
CREATE TYPE "status_denuncia_enum" AS ENUM ('aberta', 'procedente', 'improcedente');

-- AlterEnum
ALTER TYPE "tipo_consentimento_enum" ADD VALUE 'termos_marketplace';

-- DropForeignKey
ALTER TABLE "pagamentos" DROP CONSTRAINT "pagamentos_assinatura_id_fkey";

-- AlterTable
ALTER TABLE "notificacoes" ADD COLUMN     "produto_id" UUID;

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "gateway_cobranca_id" VARCHAR(255),
ADD COLUMN     "receita_compra_id" UUID,
ALTER COLUMN "assinatura_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "categorias_produto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" VARCHAR(50) NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_recebedor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "gateway" VARCHAR(50) NOT NULL DEFAULT 'mercado_pago',
    "gateway_recebedor_id" VARCHAR(255) NOT NULL,
    "access_token_cifrado" TEXT NOT NULL,
    "refresh_token_cifrado" TEXT NOT NULL,
    "token_expira_em" TIMESTAMPTZ(6) NOT NULL,
    "status" "status_recebedor_enum" NOT NULL DEFAULT 'ativo',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contas_recebedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receita_ofertas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receita_id" UUID NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "receita_ofertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receita_oferta_publico_alvo" (
    "oferta_id" UUID NOT NULL,
    "restricao_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receita_oferta_publico_alvo_pkey" PRIMARY KEY ("oferta_id","restricao_id")
);

-- CreateTable
CREATE TABLE "receita_compras" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "oferta_id" UUID NOT NULL,
    "comprador_id" UUID NOT NULL,
    "preco_pago" DECIMAL(10,2) NOT NULL,
    "taxa_plataforma" DECIMAL(10,2) NOT NULL,
    "versao_comprada" INTEGER NOT NULL,
    "status" "status_compra_receita_enum" NOT NULL DEFAULT 'pendente',
    "gateway_preferencia_id" VARCHAR(255),
    "checkout_url" VARCHAR(500),
    "receita_copia_id" UUID,
    "paga_em" TIMESTAMPTZ(6),
    "primeiro_acesso_em" TIMESTAMPTZ(6),
    "reembolso_solicitado_em" TIMESTAMPTZ(6),
    "reembolso_motivo" TEXT,
    "reembolso_resolvido_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "receita_compras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendedor_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "descricao" TEXT,
    "preco" DECIMAL(10,2),
    "cidade" VARCHAR(100),
    "estado" VARCHAR(2),
    "telefone_contato_id" UUID,
    "status" "status_produto_enum" NOT NULL DEFAULT 'ativo',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto_midias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "produto_id" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produto_midias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto_publico_alvo" (
    "produto_id" UUID NOT NULL,
    "restricao_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produto_publico_alvo_pkey" PRIMARY KEY ("produto_id","restricao_id")
);

-- CreateTable
CREATE TABLE "produto_denuncias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "produto_id" UUID NOT NULL,
    "denunciante_id" UUID NOT NULL,
    "motivo" TEXT NOT NULL,
    "status" "status_denuncia_enum" NOT NULL DEFAULT 'aberta',
    "resolvido_por" UUID,
    "resolvido_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produto_denuncias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_produto_codigo_key" ON "categorias_produto"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "contas_recebedor_usuario_id_key" ON "contas_recebedor"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "contas_recebedor_gateway_gateway_recebedor_id_key" ON "contas_recebedor"("gateway", "gateway_recebedor_id");

-- CreateIndex
CREATE UNIQUE INDEX "receita_ofertas_receita_id_key" ON "receita_ofertas"("receita_id");

-- CreateIndex
CREATE INDEX "receita_ofertas_ativa_idx" ON "receita_ofertas"("ativa");

-- CreateIndex
CREATE INDEX "receita_oferta_publico_alvo_restricao_id_idx" ON "receita_oferta_publico_alvo"("restricao_id");

-- CreateIndex
CREATE UNIQUE INDEX "receita_compras_gateway_preferencia_id_key" ON "receita_compras"("gateway_preferencia_id");

-- CreateIndex
CREATE UNIQUE INDEX "receita_compras_receita_copia_id_key" ON "receita_compras"("receita_copia_id");

-- CreateIndex
CREATE INDEX "receita_compras_comprador_id_status_idx" ON "receita_compras"("comprador_id", "status");

-- CreateIndex
CREATE INDEX "receita_compras_oferta_id_idx" ON "receita_compras"("oferta_id");

-- CreateIndex
CREATE INDEX "produtos_status_categoria_id_idx" ON "produtos"("status", "categoria_id");

-- CreateIndex
CREATE INDEX "produtos_estado_cidade_idx" ON "produtos"("estado", "cidade");

-- CreateIndex
CREATE INDEX "produtos_vendedor_id_idx" ON "produtos"("vendedor_id");

-- CreateIndex
CREATE INDEX "produto_midias_produto_id_idx" ON "produto_midias"("produto_id");

-- CreateIndex
CREATE INDEX "produto_publico_alvo_restricao_id_idx" ON "produto_publico_alvo"("restricao_id");

-- CreateIndex
CREATE INDEX "produto_denuncias_status_idx" ON "produto_denuncias"("status");

-- CreateIndex
CREATE UNIQUE INDEX "produto_denuncias_produto_id_denunciante_id_key" ON "produto_denuncias"("produto_id", "denunciante_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_gateway_cobranca_id_key" ON "pagamentos"("gateway_cobranca_id");

-- CreateIndex
CREATE INDEX "pagamentos_receita_compra_id_idx" ON "pagamentos"("receita_compra_id");

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_assinatura_id_fkey" FOREIGN KEY ("assinatura_id") REFERENCES "assinaturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_receita_compra_id_fkey" FOREIGN KEY ("receita_compra_id") REFERENCES "receita_compras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_recebedor" ADD CONSTRAINT "contas_recebedor_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_ofertas" ADD CONSTRAINT "receita_ofertas_receita_id_fkey" FOREIGN KEY ("receita_id") REFERENCES "receitas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_oferta_publico_alvo" ADD CONSTRAINT "receita_oferta_publico_alvo_oferta_id_fkey" FOREIGN KEY ("oferta_id") REFERENCES "receita_ofertas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_oferta_publico_alvo" ADD CONSTRAINT "receita_oferta_publico_alvo_restricao_id_fkey" FOREIGN KEY ("restricao_id") REFERENCES "restricoes_alimentares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_compras" ADD CONSTRAINT "receita_compras_oferta_id_fkey" FOREIGN KEY ("oferta_id") REFERENCES "receita_ofertas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_compras" ADD CONSTRAINT "receita_compras_comprador_id_fkey" FOREIGN KEY ("comprador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_compras" ADD CONSTRAINT "receita_compras_receita_copia_id_fkey" FOREIGN KEY ("receita_copia_id") REFERENCES "receitas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_telefone_contato_id_fkey" FOREIGN KEY ("telefone_contato_id") REFERENCES "telefones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_midias" ADD CONSTRAINT "produto_midias_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_publico_alvo" ADD CONSTRAINT "produto_publico_alvo_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_publico_alvo" ADD CONSTRAINT "produto_publico_alvo_restricao_id_fkey" FOREIGN KEY ("restricao_id") REFERENCES "restricoes_alimentares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_denuncias" ADD CONSTRAINT "produto_denuncias_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_denuncias" ADD CONSTRAINT "produto_denuncias_denunciante_id_fkey" FOREIGN KEY ("denunciante_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_denuncias" ADD CONSTRAINT "produto_denuncias_resolvido_por_fkey" FOREIGN KEY ("resolvido_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
