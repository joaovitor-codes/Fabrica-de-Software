# Nutrify API

Backend do **Nutrify**, uma plataforma que conecta nutricionistas e pacientes. Pelo Nutrify, o profissional monta planos alimentares, registra a anamnese e acompanha a evolução do paciente. O paciente segue o plano, marca as refeições feitas e registra sintomas. A base de ingredientes vem da **TACO** (Tabela Brasileira de Composição de Alimentos) e cruza os dados com as restrições alimentares de cada paciente.

> Projeto desenvolvido na **Fábrica de Software**.

---

## Sumário

- [Nutrify API](#nutrify-api)
  - [Sumário](#sumário)
  - [Visão geral](#visão-geral)
  - [Funcionalidades](#funcionalidades)
  - [Stack](#stack)
  - [Como rodar localmente](#como-rodar-localmente)
  - [Variáveis de ambiente](#variáveis-de-ambiente)
  - [Scripts úteis](#scripts-úteis)
  - [Perfis de acesso](#perfis-de-acesso)
  - [Fluxo de trabalho do time](#fluxo-de-trabalho-do-time)
  - [Documentação complementar](#documentação-complementar)

---

## Visão geral

| | |
|---|---|
| **Problema** | O acompanhamento nutricional se espalha entre papel, planilhas e mensagens. Por isso fica difícil acompanhar se o paciente está seguindo o plano e garantir que as receitas respeitam suas restrições (alergias, intolerâncias, doenças crônicas). |
| **Solução** | Uma API única para cadastro de profissionais e pacientes, anamnese, planos alimentares, receitas com ingredientes da TACO, cruzamento automático com restrições alimentares e diário de sintomas. |
| **Público** | Nutricionistas (e clínicas), pacientes e administradores da plataforma. |
| **Status** | 🚧 Em desenvolvimento: MVP do backend. |

## Funcionalidades

**Já implementadas**

- **Autenticação e contas**: cadastro, login com JWT e refresh token, verificação de e-mail, recuperação de senha e bloqueio após várias tentativas de login com falha.
- **Usuários, profissionais, pacientes e clínicas**, com telefones e endereços.
- **Anamnese**: banco de perguntas e opções gerenciado pelo admin. O profissional preenche a anamnese do paciente e consulta o histórico.
- **Ingredientes (TACO)**: base nutricional importada da TACO, 4ª edição (NEPA/UNICAMP, 2011), com unidades de medida.
- **Restrições alimentares**: vínculo entre ingrediente e restrição (feito por curadoria manual ou por regra nutricional, como sódio para hipertensão) e restrições do paciente.
- **Ingredientes substitutos**: sugestões de substituição para ingredientes restritos, com apoio de IA.
- **Receitas**: cadastro de receitas com ingredientes, imagem e vídeo, favoritos e feedback.
- **Receitas seguras**: o paciente com restrição não vê receita que fere uma restrição estrita (alergia ou gravidade grave); nas flexíveis, a receita vem com o aviso `restricoesVioladas`.
- **Adaptação de receitas**: a IA propõe a versão adaptada para uma restrição; o catálogo troca a receita insegura pela adaptada, e o profissional pode montar uma adaptação para o próprio paciente.
- **Curadoria**: receitas e adaptações novas passam pela aprovação de um profissional aprovado, que ganha pontos por isso.
- **Plano alimentar**: plano do paciente, checklist de refeições e comentários por refeição.
- **Diário de sintomas**: registros do paciente com tags de sintomas.
- **Marketplace**: venda de receitas pelo Mercado Pago (Checkout Pro com split, webhook e cópia para o comprador) e vitrine de produtos com moderação. Faltam o acesso do comprador à cópia, as listagens de compradas e de vendas e o reembolso.


## Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript (Node.js) |
| Framework | NestJS 11 |
| Banco de dados | PostgreSQL 15 + Prisma ORM 6 |
| Cache / rate limit | Redis 7 (`@nestjs/cache-manager`, `@nestjs/throttler`) |
| Autenticação | JWT (`@nestjs/jwt`) + cookies |
| Validação | `class-validator` / `class-transformer`, Joi para o `.env` |
| E-mail | Nodemailer + templates Handlebars |
| IA | OpenAI SDK (classificação de ingredientes, substitutos, adaptação de receitas) |
| Documentação da API | Swagger (`@nestjs/swagger`) |
| Pagamentos | Mercado Pago (OAuth do vendedor, Checkout Pro, webhook) |
| Jobs | `@nestjs/schedule` (renovação de token e vencimento de compra) |
| Testes | Jest + Supertest |
| Infra local | Docker Compose |

## Como rodar localmente

**Pré-requisitos:** Node.js 20+, npm e Docker.

```bash
# 1. Clonar e instalar dependências
git clone https://github.com/joaovitor-codes/Fabrica-de-Software.git
cd Fabrica-de-Software
npm install

# 2. Criar o .env a partir do exemplo (depois ajuste os valores, veja a seção abaixo)
cp .env.example .env

# 3. Subir PostgreSQL (porta 5454) e Redis (porta 6379)
docker compose up -d

# 4. Criar as tabelas e aplicar as migrations
npx prisma migrate reset

# 5. Dados de referência: ingredientes da TACO, regras nutricionais e curadoria de alérgenos
#    (pode rodar de novo a qualquer momento; nada é duplicado)
npm run db:preparar

# 6. Rodar a API em modo desenvolvimento
npm run start:dev
```

Com a API no ar:

- **API:** `http://localhost:3000`
- **Swagger (documentação interativa):** `http://localhost:3000/api/docs`

> ⚠️ `npx prisma migrate reset` **apaga todos os dados** do banco local. Para aplicar só as migrations novas, use `npx prisma migrate deploy`.

## Variáveis de ambiente

O `.env` é validado na inicialização (`src/common/config/env.validation.ts`). Se faltar uma variável obrigatória, a API não sobe.

| Variável | Obrigatória | Descrição |
|---|:---:|---|
| `DATABASE_URL` | ✅ | Conexão com o PostgreSQL. Com o `docker-compose.yml` padrão: `postgresql://admin:adminpassword@localhost:5454/nutrify_db?schema=public` |
| `JWT_SECRET` | ✅ | Segredo do JWT, com **no mínimo 32 caracteres**. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | ✅ | Envio de e-mails (verificação de conta, recuperação de senha). |
| `OPENAI_API_KEY` | | Chave da OpenAI (adaptação de receitas, substitutos e conferência do modo de preparo). Sem ela a API sobe, mas essas rotas respondem `503`. |
| `OPENAI_MODEL` | | Modelo da OpenAI. Padrão: `gpt-5.6-luna`. |
| `REDIS_URL` | | Padrão: `redis://localhost:6379`. |
| `PORT` | | Padrão: `3000`. |
| `SMTP_PORT` / `SMTP_SECURE` | | Padrão: `587` / `false`. |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | | Padrão: `1h` / `7d`. |
| `LOGIN_MAX_FAILED_ATTEMPTS` / `LOGIN_LOCKOUT_MINUTES` | | Padrão: `5` tentativas / `15` min de bloqueio. |
| `EMAIL_VERIFICATION_*` | | Validade do código e limite de reenvios. |
| `SITE_URL` | | Domínio usado nos links dos e-mails. |
| `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI` | | Aplicação do Mercado Pago e callback do OAuth. Sem elas, as rotas do Mercado Pago respondem `503`. |
| `MP_WEBHOOK_SECRET` | | Confere a assinatura do webhook do Mercado Pago. |
| `RECEBEDOR_TOKEN_KEY` | | Chave (mín. 32 caracteres) que cifra os tokens dos vendedores. |
| `API_URL_PUBLICA` | | Domínio HTTPS público da API, base do `notification_url`. |
| `FRONT_URL` | | Endereço do front, para onde o comprador volta depois de pagar. |
| `MARKETPLACE_TAXA_PERCENTUAL` / `MARKETPLACE_PRECO_MINIMO` | | Padrão: `15` % / `10` reais (valores provisórios). |
| `MARKETPLACE_REEMBOLSO_DIAS` / `MARKETPLACE_TERMOS_VERSAO` | | Padrão: `7` dias / `1.0`. |

> O `DATABASE_URL` do `.env.example` é só um modelo. Ajuste usuário, senha e nome do banco para os mesmos valores do `docker-compose.yml`.

## Scripts úteis

| Comando | O que faz |
|---|---|
| `npm run start:dev` | Sobe a API com hot reload. |
| `npm run build` / `npm run start:prod` | Gera o build em `dist/` e roda em modo produção. |
| `npm run db:preparar` | Grava os dados de referência: TACO, regras nutricionais e curadoria de alérgenos. |
| `npm run lint` | Roda o ESLint (com correção automática). |
| `npm run format` | Formata o código com Prettier. |
| `npm test` | Testes unitários e de integração (`*.spec.ts`). |
| `npm run test:e2e` | Testes end-to-end (precisam de PostgreSQL e Redis no ar). |
| `npm run test:cov` | Relatório de cobertura. |
| `npx prisma studio` | Interface visual para navegar no banco. |
| `npx prisma migrate dev --name <nome>` | Cria uma migration nova depois de alterar o `schema.prisma`. |


## Perfis de acesso

O controle é feito com `AuthGuard` (usuário autenticado) e `RolesGuard` + `@Roles(...)` (perfil).

| Perfil | Pode fazer |
|---|---|
| `admin` | Gerencia os catálogos globais (perguntas da anamnese, restrições, regras, unidades, categorias de produto), aprova profissionais e modera a vitrine. |
| `profissional` | Gerencia os próprios pacientes (anamnese, plano alimentar, restrições), faz a curadoria de receitas e ingredientes e adapta receitas para os pacientes dele. Não vende receita nem anuncia produto. |
| `paciente` | Consulta o próprio plano, marca o checklist, comenta refeições, registra sintomas e cadastra as próprias restrições. Pode vender receitas e anunciar produtos. |
| `comum` | Usuário sem vínculo clínico: navega, publica e vende receitas e anuncia produtos. Quem pede cadastro de profissional continua `comum` até o admin aprovar. |

## Fluxo de trabalho do time

- **Branch principal:** `desenvolvimento`. Toda mudança entra por Pull Request.
- **Nome das branches:** `feat/<descricao>` para funcionalidades, `fix/<descricao>` para correções e `docs/<descricao>` para documentação.
- **Commits:** no padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/), por exemplo `feat: diário de sintomas` ou `fix: fluxo de ingrediente substituto`.
- **Antes de abrir o PR:** rode `npm run lint` e `npm test`. Se alterou o `schema.prisma`, inclua a migration no PR.
- **Nunca** faça commit do `.env` nem da pasta `uploads/`.

## Documentação complementar

- [`documentacao-api.html`](documentacao-api.html): guia e referência de todas as rotas (a fonte mais atual).
- [`regra_negocio.md`](regra_negocio.md): decisões sobre ingredientes, restrições, importação da TACO e limiares nutricionais.
- [`regra_negocio_anamnese.md`](regra_negocio_anamnese.md): decisões sobre anamnese, permissões e restrições do paciente.
- [`regra_negocio_receitas_seguras.md`](regra_negocio_receitas_seguras.md): filtro de receitas seguras, curadoria de alérgenos e adaptação por IA.
- [`decisoes_marketplace.md`](decisoes_marketplace.md) e [`plano-implementacao-marketplace.md`](plano-implementacao-marketplace.md): regras e andamento do marketplace.
- [`ci-cd.md`](ci-cd.md): pipeline de CI e opções de deploy.
