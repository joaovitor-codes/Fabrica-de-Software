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
  - [Estrutura do projeto](#estrutura-do-projeto)
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
- **Receitas**: cadastro com ingredientes, imagem e vídeo; curadoria por profissional (edição de receita aprovada volta para `pendente`); favoritos; alertas de restrição alimentar por receita. Visitante vê só receitas aprovadas.
- **Pontos de incentivo**: o profissional ganha pontos ao aprovar/rejeitar receitas; saldo, histórico e ajuste manual pelo admin.
- **Plano alimentar**: criação, consulta e edição do plano e dos itens, checklist de refeições e comentários por refeição.
- **Diário de sintomas**: registros do paciente com tags de sintomas.


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
| IA | OpenAI SDK (sugestão de substitutos) |
| Documentação da API | Swagger (`@nestjs/swagger`) |
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

# 5. Popular o banco com os dados de referência (ingredientes, regras, curadoria)
npm run db:preparar

# 6. Rodar a API em modo desenvolvimento
npm run start:dev
```

Com a API no ar:

- **API:** `http://localhost:3000`
- **Swagger (documentação interativa):** `http://localhost:3000/api/docs`

> ⚠️ `npx prisma migrate reset` **apaga todos os dados** do banco local. Para aplicar só as migrations novas, use `npx prisma migrate dev`.

### O que o `npm run db:preparar` faz

Deixa todo banco montado a partir do repositório no mesmo estado. Pode rodar de novo a qualquer momento: nada é duplicado.

| Passo | Script | O que grava |
| --- | --- | --- |
| 1 | `scripts/import-taco.ts` | Os ~597 ingredientes da TACO (atualiza os que já existem) |
| 2 | `scripts/regras-nutricionais.ts` | As doenças crônicas com regra de nutriente (hoje, hipertensão: sódio > 600 mg/100 g) e os vínculos que a regra gera. Lista em `src/modules/nutricao/restricao-alimentar/regras-padrao.ts` |
| 3 | `scripts/curadoria-alergenos.ts aplicar` | Os alérgenos revisados de `scripts/curadoria-alergenos-revisado.csv`. Se o arquivo ainda não existe, o passo é pulado |

A ordem importa: o import grava os ingredientes sem passar pelas regras, então as regras rodam depois e reavaliam tudo. Detalhes em `regra_negocio_receitas_seguras.md`.

## Variáveis de ambiente

O `.env` é validado na inicialização (`src/common/config/env.validation.ts`). Se faltar uma variável obrigatória, a API não sobe.

| Variável | Obrigatória | Descrição |
|---|:---:|---|
| `DATABASE_URL` | ✅ | Conexão com o PostgreSQL. Com o `docker-compose.yml` padrão: `postgresql://admin:adminpassword@localhost:5454/nutrify_db?schema=public` |
| `JWT_SECRET` | ✅ | Segredo do JWT, com **no mínimo 32 caracteres**. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | ✅ | Envio de e-mails (verificação de conta, recuperação de senha). |
| `OPENAI_API_KEY` | ✅ | Chave da OpenAI, usada na sugestão de substitutos. |
| `REDIS_URL` | | Padrão: `redis://localhost:6379`. |
| `PORT` | | Padrão: `3000`. |
| `SMTP_PORT` / `SMTP_SECURE` | | Padrão: `587` / `false`. |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | | Padrão: `1h` / `7d`. |
| `LOGIN_MAX_FAILED_ATTEMPTS` / `LOGIN_LOCKOUT_MINUTES` | | Padrão: `5` tentativas / `15` min de bloqueio. |
| `EMAIL_VERIFICATION_*` | | Validade do código e limite de reenvios. |
| `SITE_URL` | | Domínio usado nos links dos e-mails. |

> O `DATABASE_URL` do `.env.example` é só um modelo. Ajuste usuário, senha e nome do banco para os mesmos valores do `docker-compose.yml`.

## Estrutura do projeto

```
src/
  auth/        autenticação, guards (AuthGuard, OptionalAuthGuard, RolesGuard) e tipos
  common/      infraestrutura: prisma, cache, throttler, multer, mailer, config
  modules/
    identidade/       usuario, pacientes, profissional, clinicas, endereco, telefone
    nutricao/         ingrediente, unidade-medida, restricao-alimentar,
                      ingrediente-restricao, paciente-restricao
    receitas/         receita, pontos-transacao
    acompanhamento/   plano-alimentar, anamnese, diario-de-sintomas, tag-sintomas
    ia/
  app.module.ts
  main.ts
```

Convenções:
- DTOs ficam em `dtos/` dentro do módulo, sem sufixo `.dto` (ex.: `dtos/receita.ts`, `dtos/update-receita.ts`).
- Imports relativos (sem alias).
- Para gerar um módulo novo no lugar certo, passe o caminho ao CLI, **criando o module primeiro**:
  ```bash
  npx nest g module     modules/<dominio>/<nome>
  npx nest g controller modules/<dominio>/<nome> --no-spec
  npx nest g service    modules/<dominio>/<nome> --no-spec
  ```
  Evite `nest g resource`: ele cria `dto/`, `entities/` e sufixo `.dto`, fora do padrão.

## Scripts úteis

| Comando | O que faz |
|---|---|
| `npm run start:dev` | Sobe a API com hot reload. |
| `npm run build` / `npm run start:prod` | Gera o build em `dist/` e roda em modo produção. |
| `npm run lint` | Roda o ESLint (com correção automática). |
| `npm run format` | Formata o código com Prettier. |
| `npm test` | Testes unitários e de integração (`*.spec.ts`). |
| `npm run test:e2e` | Testes end-to-end. |
| `npm run test:cov` | Relatório de cobertura. |
| `npx prisma studio` | Interface visual para navegar no banco. |
| `npx prisma migrate dev --name <nome>` | Cria uma migration nova depois de alterar o `schema.prisma`. |


## Perfis de acesso

O controle é feito com `AuthGuard` (usuário autenticado), `RolesGuard` + `@Roles(...)` (perfil) e `OptionalAuthGuard` (rotas públicas cujo conteúdo muda para quem está logado, como as de receita). Nos controllers, tipe o request como `RequestAutenticado` (ou `RequestOpcional`) e marque as rotas protegidas com `@ApiBearerAuth()` para o Swagger enviar o token. Regras de dono (ex.: só o autor ou o admin editam uma receita) ficam no service.

| Perfil | Pode fazer |
|---|---|
| `admin` | Gerencia os catálogos globais: perguntas da anamnese, restrições, ingredientes etc. |
| `profissional` | Gerencia os próprios pacientes: anamnese, plano alimentar, restrições. |
| `paciente` | Consulta o próprio plano, marca o checklist, comenta refeições, registra sintomas e cadastra as próprias restrições. |
| `comum` | Usuário sem vínculo de profissional nem de paciente. |

## Fluxo de trabalho do time

- **Branch principal:** `desenvolvimento`. Toda mudança entra por Pull Request.
- **Nome das branches:** `feat/<descricao>` para funcionalidades, `fix/<descricao>` para correções e `docs/<descricao>` para documentação.
- **Commits:** no padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/), por exemplo `feat: diário de sintomas` ou `fix: fluxo de ingrediente substituto`.
- **Antes de abrir o PR:** rode `npm run lint` e `npm test`. O CI (build, testes e lint) **bloqueia o PR** se qualquer um falhar. Se alterou o `schema.prisma`, inclua a migration no PR.
- **Testes:** módulo novo já nasce com testes (veja os `*.integration.spec.ts` existentes como modelo: fake do Prisma em memória e `AuthGuard` substituído por headers).
- **Nunca** faça commit do `.env` nem da pasta `uploads/`.

## Documentação complementar

- [`regra_negocio.md`](regra_negocio.md): decisões sobre ingredientes, restrições, importação da TACO e limiares nutricionais.
- [`regra_negocio_anamnese.md`](regra_negocio_anamnese.md): decisões sobre anamnese, permissões e restrições do paciente.
- [`docs/ci-cd.md`](docs/ci-cd.md): pipeline de CI, proteção de branch e deploy.
