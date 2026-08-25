-- CreateEnum
CREATE TYPE "tipo_usuario_enum" AS ENUM ('profissional', 'paciente', 'comum', 'admin');

-- CreateEnum
CREATE TYPE "status_aprovacao_enum" AS ENUM ('pendente', 'aprovado', 'rejeitado');

-- CreateEnum
CREATE TYPE "tipo_restricao_enum" AS ENUM ('alergia', 'intolerancia', 'doenca_cronica', 'preferencia');

-- CreateEnum
CREATE TYPE "gravidade_enum" AS ENUM ('leve', 'moderada', 'grave');

-- CreateEnum
CREATE TYPE "nivel_dificuldade_enum" AS ENUM ('facil', 'medio', 'dificil');

-- CreateEnum
CREATE TYPE "status_receita_enum" AS ENUM ('pendente', 'aprovada', 'rejeitada');

-- CreateEnum
CREATE TYPE "tipo_transacao_pontos_enum" AS ENUM ('ganho_aprovacao', 'resgate_desconto', 'ajuste_manual');

-- CreateEnum
CREATE TYPE "periodicidade_enum" AS ENUM ('mensal', 'anual');

-- CreateEnum
CREATE TYPE "status_assinatura_enum" AS ENUM ('trial', 'ativa', 'cancelada', 'expirada');

-- CreateEnum
CREATE TYPE "status_pagamento_enum" AS ENUM ('pendente', 'pago', 'falhou', 'reembolsado');

-- CreateEnum
CREATE TYPE "dia_semana_enum" AS ENUM ('segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo');

-- CreateEnum
CREATE TYPE "tipo_refeicao_enum" AS ENUM ('cafe_da_manha', 'lanche_manha', 'almoco', 'lanche_tarde', 'jantar', 'ceia');

-- CreateEnum
CREATE TYPE "tipo_resposta_enum" AS ENUM ('texto', 'numero', 'escolha_unica', 'escolha_multipla', 'booleano');

-- CreateEnum
CREATE TYPE "porte_clinica_enum" AS ENUM ('pequeno', 'medio', 'grande');

-- CreateEnum
CREATE TYPE "status_indicacao_enum" AS ENUM ('pendente', 'convertida', 'expirada');

-- CreateEnum
CREATE TYPE "tipo_midia_enum" AS ENUM ('capa', 'passo_a_passo', 'video');

-- CreateEnum
CREATE TYPE "tipo_consentimento_enum" AS ENUM ('termos_uso', 'dados_saude', 'marketing');

-- CreateEnum
CREATE TYPE "acao_log_enum" AS ENUM ('visualizacao', 'edicao', 'exportacao');

-- CreateEnum
CREATE TYPE "tipo_contato_enum" AS ENUM ('celular', 'fixo', 'whatsapp');

-- CreateTable
CREATE TABLE "contas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "email_verificado" BOOLEAN NOT NULL DEFAULT false,
    "email_verificado_em" TIMESTAMPTZ(6),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "tipo_usuario" "tipo_usuario_enum" NOT NULL,
    "data_nascimento" DATE,
    "foto_perfil_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telefones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ddi" VARCHAR(5),
    "numero" VARCHAR(20) NOT NULL,
    "tipo" "tipo_contato_enum" NOT NULL DEFAULT 'celular',
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "usuario_id" UUID,
    "clinica_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telefones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enderecos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cep" VARCHAR(9),
    "logradouro" VARCHAR(255),
    "numero" VARCHAR(20),
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100),
    "cidade" VARCHAR(100),
    "estado" VARCHAR(2),
    "pais" VARCHAR(100) NOT NULL DEFAULT 'Brasil',
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "usuario_id" UUID,
    "clinica_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enderecos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" VARCHAR(255) NOT NULL,
    "cnpj" VARCHAR(20),
    "porte" "porte_clinica_enum" NOT NULL DEFAULT 'pequeno',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profissionais" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "clinica_id" UUID,
    "registro_profissional" VARCHAR(50) NOT NULL,
    "especialidade" VARCHAR(255),
    "bio" TEXT,
    "pontos_incentivo" INTEGER NOT NULL DEFAULT 0,
    "status_aprovacao" "status_aprovacao_enum" NOT NULL DEFAULT 'pendente',
    "aprovado_por" UUID,
    "aprovado_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profissionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "profissional_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dados_socioeconomicos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "renda_familiar_mensal" DECIMAL(10,2),
    "num_integrantes_familia" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dados_socioeconomicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_verificacao_email" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "usado_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_verificacao_email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_reset_senha" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "usado_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_reset_senha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "user_agent" VARCHAR(500),
    "ip_address" VARCHAR(45),
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "revogado_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tentativas_login" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID,
    "email_tentado" VARCHAR(255) NOT NULL,
    "sucesso" BOOLEAN NOT NULL,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_login_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restricoes_alimentares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" VARCHAR(255) NOT NULL,
    "tipo" "tipo_restricao_enum" NOT NULL,
    "descricao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restricoes_alimentares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paciente_restricoes" (
    "paciente_id" UUID NOT NULL,
    "restricao_id" UUID NOT NULL,
    "gravidade" "gravidade_enum" NOT NULL DEFAULT 'moderada',
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paciente_restricoes_pkey" PRIMARY KEY ("paciente_id","restricao_id")
);

-- CreateTable
CREATE TABLE "ingredientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" VARCHAR(255) NOT NULL,
    "fonte_dados" VARCHAR(100),
    "calorias_kcal" DECIMAL(8,2),
    "proteinas_g" DECIMAL(8,2),
    "carboidratos_g" DECIMAL(8,2),
    "gorduras_g" DECIMAL(8,2),
    "fibras_g" DECIMAL(8,2),
    "sodio_mg" DECIMAL(8,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingrediente_restricoes" (
    "ingrediente_id" UUID NOT NULL,
    "restricao_id" UUID NOT NULL,

    CONSTRAINT "ingrediente_restricoes_pkey" PRIMARY KEY ("ingrediente_id","restricao_id")
);

-- CreateTable
CREATE TABLE "unidades_medida" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" VARCHAR(20) NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unidades_medida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_notificacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" VARCHAR(50) NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tipos_notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receitas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" VARCHAR(255) NOT NULL,
    "descricao" TEXT,
    "modo_preparo" TEXT,
    "tempo_preparo_min" INTEGER,
    "porcoes" INTEGER,
    "nivel_dificuldade" "nivel_dificuldade_enum" NOT NULL DEFAULT 'medio',
    "aviso_contaminacao_cruzada" BOOLEAN NOT NULL DEFAULT false,
    "criado_por" UUID NOT NULL,
    "status" "status_receita_enum" NOT NULL DEFAULT 'pendente',
    "profissional_aprovador_id" UUID,
    "data_aprovacao" TIMESTAMPTZ(6),
    "versao_atual" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "receitas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receita_versoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receita_id" UUID NOT NULL,
    "versao" INTEGER NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "descricao" TEXT,
    "modo_preparo" TEXT,
    "alterado_por" UUID NOT NULL,
    "motivo_alteracao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receita_versoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receita_midias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receita_id" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "tipo" "tipo_midia_enum" NOT NULL DEFAULT 'capa',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receita_midias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receita_ingredientes" (
    "receita_id" UUID NOT NULL,
    "ingrediente_id" UUID NOT NULL,
    "quantidade" DECIMAL(8,2) NOT NULL,
    "unidade_medida_id" UUID NOT NULL,

    CONSTRAINT "receita_ingredientes_pkey" PRIMARY KEY ("receita_id","ingrediente_id")
);

-- CreateTable
CREATE TABLE "pontos_transacoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profissional_id" UUID NOT NULL,
    "receita_id" UUID,
    "pontos" INTEGER NOT NULL,
    "tipo" "tipo_transacao_pontos_enum" NOT NULL,
    "descricao" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pontos_transacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favoritos" (
    "usuario_id" UUID NOT NULL,
    "receita_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favoritos_pkey" PRIMARY KEY ("usuario_id","receita_id")
);

-- CreateTable
CREATE TABLE "planos_alimentares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "data_inicio" DATE NOT NULL,
    "data_fim" DATE,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "planos_alimentares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plano_alimentar_itens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plano_alimentar_id" UUID NOT NULL,
    "receita_id" UUID NOT NULL,
    "dia_semana" "dia_semana_enum" NOT NULL,
    "tipo_refeicao" "tipo_refeicao_enum" NOT NULL,
    "horario_sugerido" TIME(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plano_alimentar_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_refeicoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plano_alimentar_item_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "data_referencia" DATE NOT NULL,
    "concluido" BOOLEAN NOT NULL DEFAULT false,
    "concluido_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_refeicoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comentarios_refeicao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plano_alimentar_item_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "comentario" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comentarios_refeicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags_sintomas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" VARCHAR(255) NOT NULL,

    CONSTRAINT "tags_sintomas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diario_sintomas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "checklist_refeicao_id" UUID,
    "data_registro" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacao" TEXT,

    CONSTRAINT "diario_sintomas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diario_sintomas_tags" (
    "diario_sintomas_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "diario_sintomas_tags_pkey" PRIMARY KEY ("diario_sintomas_id","tag_id")
);

-- CreateTable
CREATE TABLE "anamnese_perguntas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "texto" VARCHAR(500) NOT NULL,
    "tipo_resposta" "tipo_resposta_enum" NOT NULL,
    "categoria" VARCHAR(100),
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "anamnese_perguntas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anamnese_opcoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pergunta_id" UUID NOT NULL,
    "texto_opcao" VARCHAR(255) NOT NULL,

    CONSTRAINT "anamnese_opcoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anamneses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "data_preenchimento" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacoes_gerais" TEXT,

    CONSTRAINT "anamneses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anamnese_respostas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "anamnese_id" UUID NOT NULL,
    "pergunta_id" UUID NOT NULL,
    "resposta_texto" TEXT,
    "resposta_numero" DECIMAL(10,2),
    "opcao_id" UUID,

    CONSTRAINT "anamnese_respostas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" VARCHAR(255) NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL,
    "periodicidade" "periodicidade_enum" NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "planos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assinaturas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profissional_id" UUID NOT NULL,
    "plano_id" UUID NOT NULL,
    "data_inicio" DATE NOT NULL,
    "data_fim" DATE,
    "status" "status_assinatura_enum" NOT NULL DEFAULT 'trial',
    "desconto_aplicado" DECIMAL(5,2) DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assinaturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assinatura_id" UUID NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "status_pagamento" "status_pagamento_enum" NOT NULL DEFAULT 'pendente',
    "metodo_pagamento" VARCHAR(100),
    "data_pagamento" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicacoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_indicador_id" UUID NOT NULL,
    "usuario_indicado_id" UUID,
    "status" "status_indicacao_enum" NOT NULL DEFAULT 'pendente',
    "recompensa_aplicada" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anunciantes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome_marca" VARCHAR(255) NOT NULL,
    "contato" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anunciantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanhas_publicitarias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "anunciante_id" UUID NOT NULL,
    "restricao_alvo_id" UUID,
    "titulo" VARCHAR(255) NOT NULL,
    "data_inicio" DATE NOT NULL,
    "data_fim" DATE,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "campanhas_publicitarias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "tipo_notificacao_id" UUID NOT NULL,
    "receita_id" UUID,
    "assinatura_id" UUID,
    "plano_alimentar_item_id" UUID,
    "indicacao_id" UUID,
    "anamnese_id" UUID,
    "titulo" VARCHAR(255) NOT NULL,
    "mensagem" TEXT,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "lida_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimentos_lgpd" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "tipo_consentimento" "tipo_consentimento_enum" NOT NULL,
    "aceito" BOOLEAN NOT NULL,
    "versao_documento" VARCHAR(50) NOT NULL,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consentimentos_lgpd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_acessos_dados_sensiveis" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_acessante_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "tipo_dado_acessado" VARCHAR(100) NOT NULL,
    "acao" "acao_log_enum" NOT NULL,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_acessos_dados_sensiveis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contas_email_key" ON "contas"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_conta_id_key" ON "usuarios"("conta_id");

-- CreateIndex
CREATE INDEX "usuarios_tipo_usuario_idx" ON "usuarios"("tipo_usuario");

-- CreateIndex
CREATE INDEX "telefones_usuario_id_idx" ON "telefones"("usuario_id");

-- CreateIndex
CREATE INDEX "telefones_clinica_id_idx" ON "telefones"("clinica_id");

-- CreateIndex
CREATE INDEX "enderecos_usuario_id_idx" ON "enderecos"("usuario_id");

-- CreateIndex
CREATE INDEX "enderecos_clinica_id_idx" ON "enderecos"("clinica_id");

-- CreateIndex
CREATE INDEX "enderecos_cep_idx" ON "enderecos"("cep");

-- CreateIndex
CREATE UNIQUE INDEX "clinicas_cnpj_key" ON "clinicas"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "profissionais_usuario_id_key" ON "profissionais"("usuario_id");

-- CreateIndex
CREATE INDEX "profissionais_clinica_id_idx" ON "profissionais"("clinica_id");

-- CreateIndex
CREATE INDEX "profissionais_status_aprovacao_idx" ON "profissionais"("status_aprovacao");

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_usuario_id_key" ON "pacientes"("usuario_id");

-- CreateIndex
CREATE INDEX "pacientes_profissional_id_idx" ON "pacientes"("profissional_id");

-- CreateIndex
CREATE UNIQUE INDEX "dados_socioeconomicos_paciente_id_key" ON "dados_socioeconomicos"("paciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_verificacao_email_token_key" ON "tokens_verificacao_email"("token");

-- CreateIndex
CREATE INDEX "tokens_verificacao_email_conta_id_idx" ON "tokens_verificacao_email"("conta_id");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_reset_senha_token_key" ON "tokens_reset_senha"("token");

-- CreateIndex
CREATE INDEX "tokens_reset_senha_conta_id_idx" ON "tokens_reset_senha"("conta_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_refresh_token_hash_key" ON "sessoes"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessoes_conta_id_idx" ON "sessoes"("conta_id");

-- CreateIndex
CREATE INDEX "tentativas_login_email_tentado_created_at_idx" ON "tentativas_login"("email_tentado", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "restricoes_alimentares_nome_key" ON "restricoes_alimentares"("nome");

-- CreateIndex
CREATE INDEX "ingredientes_nome_idx" ON "ingredientes"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_medida_codigo_key" ON "unidades_medida"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_notificacao_codigo_key" ON "tipos_notificacao"("codigo");

-- CreateIndex
CREATE INDEX "receitas_status_idx" ON "receitas"("status");

-- CreateIndex
CREATE INDEX "receitas_criado_por_idx" ON "receitas"("criado_por");

-- CreateIndex
CREATE INDEX "receita_versoes_receita_id_idx" ON "receita_versoes"("receita_id");

-- CreateIndex
CREATE UNIQUE INDEX "receita_versoes_receita_id_versao_key" ON "receita_versoes"("receita_id", "versao");

-- CreateIndex
CREATE INDEX "receita_midias_receita_id_idx" ON "receita_midias"("receita_id");

-- CreateIndex
CREATE INDEX "pontos_transacoes_profissional_id_idx" ON "pontos_transacoes"("profissional_id");

-- CreateIndex
CREATE INDEX "planos_alimentares_paciente_id_idx" ON "planos_alimentares"("paciente_id");

-- CreateIndex
CREATE INDEX "plano_alimentar_itens_plano_alimentar_id_dia_semana_tipo_re_idx" ON "plano_alimentar_itens"("plano_alimentar_id", "dia_semana", "tipo_refeicao");

-- CreateIndex
CREATE INDEX "checklist_refeicoes_paciente_id_idx" ON "checklist_refeicoes"("paciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_refeicoes_plano_alimentar_item_id_data_referencia_key" ON "checklist_refeicoes"("plano_alimentar_item_id", "data_referencia");

-- CreateIndex
CREATE INDEX "comentarios_refeicao_plano_alimentar_item_id_idx" ON "comentarios_refeicao"("plano_alimentar_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_sintomas_nome_key" ON "tags_sintomas"("nome");

-- CreateIndex
CREATE INDEX "diario_sintomas_paciente_id_idx" ON "diario_sintomas"("paciente_id");

-- CreateIndex
CREATE INDEX "anamneses_paciente_id_idx" ON "anamneses"("paciente_id");

-- CreateIndex
CREATE INDEX "anamnese_respostas_anamnese_id_idx" ON "anamnese_respostas"("anamnese_id");

-- CreateIndex
CREATE INDEX "assinaturas_profissional_id_idx" ON "assinaturas"("profissional_id");

-- CreateIndex
CREATE INDEX "assinaturas_status_idx" ON "assinaturas"("status");

-- CreateIndex
CREATE INDEX "pagamentos_assinatura_id_idx" ON "pagamentos"("assinatura_id");

-- CreateIndex
CREATE INDEX "indicacoes_usuario_indicador_id_idx" ON "indicacoes"("usuario_indicador_id");

-- CreateIndex
CREATE INDEX "campanhas_publicitarias_anunciante_id_idx" ON "campanhas_publicitarias"("anunciante_id");

-- CreateIndex
CREATE INDEX "notificacoes_usuario_id_lida_idx" ON "notificacoes"("usuario_id", "lida");

-- CreateIndex
CREATE INDEX "consentimentos_lgpd_usuario_id_tipo_consentimento_idx" ON "consentimentos_lgpd"("usuario_id", "tipo_consentimento");

-- CreateIndex
CREATE INDEX "log_acessos_dados_sensiveis_paciente_id_idx" ON "log_acessos_dados_sensiveis"("paciente_id");

-- CreateIndex
CREATE INDEX "log_acessos_dados_sensiveis_usuario_acessante_id_idx" ON "log_acessos_dados_sensiveis"("usuario_acessante_id");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telefones" ADD CONSTRAINT "telefones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telefones" ADD CONSTRAINT "telefones_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enderecos" ADD CONSTRAINT "enderecos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enderecos" ADD CONSTRAINT "enderecos_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissionais" ADD CONSTRAINT "profissionais_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissionais" ADD CONSTRAINT "profissionais_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissionais" ADD CONSTRAINT "profissionais_aprovado_por_fkey" FOREIGN KEY ("aprovado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dados_socioeconomicos" ADD CONSTRAINT "dados_socioeconomicos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_verificacao_email" ADD CONSTRAINT "tokens_verificacao_email_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_reset_senha" ADD CONSTRAINT "tokens_reset_senha_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tentativas_login" ADD CONSTRAINT "tentativas_login_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente_restricoes" ADD CONSTRAINT "paciente_restricoes_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente_restricoes" ADD CONSTRAINT "paciente_restricoes_restricao_id_fkey" FOREIGN KEY ("restricao_id") REFERENCES "restricoes_alimentares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingrediente_restricoes" ADD CONSTRAINT "ingrediente_restricoes_ingrediente_id_fkey" FOREIGN KEY ("ingrediente_id") REFERENCES "ingredientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingrediente_restricoes" ADD CONSTRAINT "ingrediente_restricoes_restricao_id_fkey" FOREIGN KEY ("restricao_id") REFERENCES "restricoes_alimentares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receitas" ADD CONSTRAINT "receitas_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receitas" ADD CONSTRAINT "receitas_profissional_aprovador_id_fkey" FOREIGN KEY ("profissional_aprovador_id") REFERENCES "profissionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_versoes" ADD CONSTRAINT "receita_versoes_receita_id_fkey" FOREIGN KEY ("receita_id") REFERENCES "receitas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_versoes" ADD CONSTRAINT "receita_versoes_alterado_por_fkey" FOREIGN KEY ("alterado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_midias" ADD CONSTRAINT "receita_midias_receita_id_fkey" FOREIGN KEY ("receita_id") REFERENCES "receitas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_ingredientes" ADD CONSTRAINT "receita_ingredientes_receita_id_fkey" FOREIGN KEY ("receita_id") REFERENCES "receitas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_ingredientes" ADD CONSTRAINT "receita_ingredientes_ingrediente_id_fkey" FOREIGN KEY ("ingrediente_id") REFERENCES "ingredientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_ingredientes" ADD CONSTRAINT "receita_ingredientes_unidade_medida_id_fkey" FOREIGN KEY ("unidade_medida_id") REFERENCES "unidades_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pontos_transacoes" ADD CONSTRAINT "pontos_transacoes_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pontos_transacoes" ADD CONSTRAINT "pontos_transacoes_receita_id_fkey" FOREIGN KEY ("receita_id") REFERENCES "receitas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favoritos" ADD CONSTRAINT "favoritos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favoritos" ADD CONSTRAINT "favoritos_receita_id_fkey" FOREIGN KEY ("receita_id") REFERENCES "receitas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planos_alimentares" ADD CONSTRAINT "planos_alimentares_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planos_alimentares" ADD CONSTRAINT "planos_alimentares_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_alimentar_itens" ADD CONSTRAINT "plano_alimentar_itens_plano_alimentar_id_fkey" FOREIGN KEY ("plano_alimentar_id") REFERENCES "planos_alimentares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_alimentar_itens" ADD CONSTRAINT "plano_alimentar_itens_receita_id_fkey" FOREIGN KEY ("receita_id") REFERENCES "receitas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_refeicoes" ADD CONSTRAINT "checklist_refeicoes_plano_alimentar_item_id_fkey" FOREIGN KEY ("plano_alimentar_item_id") REFERENCES "plano_alimentar_itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_refeicoes" ADD CONSTRAINT "checklist_refeicoes_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios_refeicao" ADD CONSTRAINT "comentarios_refeicao_plano_alimentar_item_id_fkey" FOREIGN KEY ("plano_alimentar_item_id") REFERENCES "plano_alimentar_itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios_refeicao" ADD CONSTRAINT "comentarios_refeicao_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diario_sintomas" ADD CONSTRAINT "diario_sintomas_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diario_sintomas" ADD CONSTRAINT "diario_sintomas_checklist_refeicao_id_fkey" FOREIGN KEY ("checklist_refeicao_id") REFERENCES "checklist_refeicoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diario_sintomas_tags" ADD CONSTRAINT "diario_sintomas_tags_diario_sintomas_id_fkey" FOREIGN KEY ("diario_sintomas_id") REFERENCES "diario_sintomas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diario_sintomas_tags" ADD CONSTRAINT "diario_sintomas_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags_sintomas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnese_opcoes" ADD CONSTRAINT "anamnese_opcoes_pergunta_id_fkey" FOREIGN KEY ("pergunta_id") REFERENCES "anamnese_perguntas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnese_respostas" ADD CONSTRAINT "anamnese_respostas_anamnese_id_fkey" FOREIGN KEY ("anamnese_id") REFERENCES "anamneses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnese_respostas" ADD CONSTRAINT "anamnese_respostas_pergunta_id_fkey" FOREIGN KEY ("pergunta_id") REFERENCES "anamnese_perguntas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnese_respostas" ADD CONSTRAINT "anamnese_respostas_opcao_id_fkey" FOREIGN KEY ("opcao_id") REFERENCES "anamnese_opcoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "planos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_assinatura_id_fkey" FOREIGN KEY ("assinatura_id") REFERENCES "assinaturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicacoes" ADD CONSTRAINT "indicacoes_usuario_indicador_id_fkey" FOREIGN KEY ("usuario_indicador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicacoes" ADD CONSTRAINT "indicacoes_usuario_indicado_id_fkey" FOREIGN KEY ("usuario_indicado_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanhas_publicitarias" ADD CONSTRAINT "campanhas_publicitarias_anunciante_id_fkey" FOREIGN KEY ("anunciante_id") REFERENCES "anunciantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanhas_publicitarias" ADD CONSTRAINT "campanhas_publicitarias_restricao_alvo_id_fkey" FOREIGN KEY ("restricao_alvo_id") REFERENCES "restricoes_alimentares"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_tipo_notificacao_id_fkey" FOREIGN KEY ("tipo_notificacao_id") REFERENCES "tipos_notificacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_receita_id_fkey" FOREIGN KEY ("receita_id") REFERENCES "receitas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_assinatura_id_fkey" FOREIGN KEY ("assinatura_id") REFERENCES "assinaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_plano_alimentar_item_id_fkey" FOREIGN KEY ("plano_alimentar_item_id") REFERENCES "plano_alimentar_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_indicacao_id_fkey" FOREIGN KEY ("indicacao_id") REFERENCES "indicacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_anamnese_id_fkey" FOREIGN KEY ("anamnese_id") REFERENCES "anamneses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimentos_lgpd" ADD CONSTRAINT "consentimentos_lgpd_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_acessos_dados_sensiveis" ADD CONSTRAINT "log_acessos_dados_sensiveis_usuario_acessante_id_fkey" FOREIGN KEY ("usuario_acessante_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_acessos_dados_sensiveis" ADD CONSTRAINT "log_acessos_dados_sensiveis_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- REGRAS DE INTEGRIDADE EM NÍVEL DE BANCO
-- (não expressáveis em schema.prisma — mantidas manualmente)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Consistência polimórfica: profissionais.usuario_id só pode
--    apontar para um usuário cujo tipo_usuario seja 'profissional'.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_tipo_profissional()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM usuarios
        WHERE id = NEW.usuario_id AND tipo_usuario = 'profissional'
    ) THEN
        RAISE EXCEPTION 'Violacao de integridade: o usuario precisa ser do tipo profissional.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valida_profissional
BEFORE INSERT OR UPDATE OF usuario_id ON profissionais
FOR EACH ROW EXECUTE FUNCTION check_tipo_profissional();

-- ---------------------------------------------------------------------
-- 2) Mesmo padrão para pacientes.usuario_id -> tipo_usuario 'paciente'.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_tipo_paciente()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM usuarios
        WHERE id = NEW.usuario_id AND tipo_usuario = 'paciente'
    ) THEN
        RAISE EXCEPTION 'Violacao de integridade: o usuario precisa ser do tipo paciente.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valida_paciente
BEFORE INSERT OR UPDATE OF usuario_id ON pacientes
FOR EACH ROW EXECUTE FUNCTION check_tipo_paciente();

-- ---------------------------------------------------------------------
-- 3) Exclusive Arc em notificacoes: exatamente uma das 5 colunas de
--    origem deve estar preenchida por registro.
-- ---------------------------------------------------------------------

ALTER TABLE notificacoes
ADD CONSTRAINT chk_notificacao_exclusive_arc
CHECK (
    num_nonnulls(
        receita_id,
        assinatura_id,
        plano_alimentar_item_id,
        indicacao_id,
        anamnese_id
    ) = 1
);

-- ---------------------------------------------------------------------
-- 4) Mesmo padrão em telefones e enderecos: exatamente um dono
--    (usuario_id OU clinica_id) preenchido por registro.
-- ---------------------------------------------------------------------

ALTER TABLE telefones
ADD CONSTRAINT chk_telefone_dono
CHECK (num_nonnulls(usuario_id, clinica_id) = 1);

ALTER TABLE enderecos
ADD CONSTRAINT chk_endereco_dono
CHECK (num_nonnulls(usuario_id, clinica_id) = 1);