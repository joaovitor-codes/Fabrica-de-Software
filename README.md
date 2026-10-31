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
  - [Integração com o Mercado Pago](#integração-com-o-mercado-pago)
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
- **Conexão do vendedor com o Mercado Pago** (marketplace): o vendedor autoriza a plataforma pelo OAuth do Mercado Pago; os tokens ficam cifrados no banco e são renovados automaticamente por um job diário. Base para a venda de receitas com split de pagamento.


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
| Pagamentos | Mercado Pago (OAuth e Split de Pagamentos 1:1, Checkout Pro) |
| Tarefas agendadas | `@nestjs/schedule` (renovação dos tokens do Mercado Pago) |
| Documentação da API | Swagger (`@nestjs/swagger`) |
| Testes | Jest + Supertest |
| Infra local | Docker Compose |

## Como rodar localmente

**Pré-requisitos:** Node.js 22 (versão em `.nvmrc`; com nvm, rode `nvm use`), npm e Docker.

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
| `MP_CLIENT_ID`, `MP_CLIENT_SECRET` | | Credenciais da aplicação no Mercado Pago, usadas no OAuth do vendedor. Sem elas, as rotas de `/api/recebedor` respondem `503`. |
| `MP_REDIRECT_URI` | | Destino do OAuth: `https://<seu-endereço>/api/recebedor/callback`. Tem que ser **idêntica** à URL de redirecionamento cadastrada no painel do Mercado Pago e usar HTTPS. |
| `RECEBEDOR_TOKEN_KEY` | | Chave (mínimo 32 caracteres) que cifra os tokens dos vendedores no banco. Não troque com contas já conectadas: os tokens gravados deixam de abrir. |
| `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY` | | Credenciais da conta da plataforma (Checkout Pro). |
| `MP_WEBHOOK_SECRET` | | Assinatura das notificações do Mercado Pago (webhook da compra). |
| `MARKETPLACE_*` | | Comissão da plataforma, preço mínimo, prazo de reembolso e versão dos termos do marketplace. |

> O `DATABASE_URL` do `.env.example` é só um modelo. Ajuste usuário, senha e nome do banco para os mesmos valores do `docker-compose.yml`.

## Integração com o Mercado Pago

O marketplace usa o **Split de Pagamentos 1:1** do Mercado Pago: cada vendedor conecta a própria conta pelo OAuth, e a cobrança da receita é feita com o token dele, com a comissão da plataforma em `marketplace_fee`. As decisões estão em [`docs/decisoes_marketplace.md`](docs/decisoes_marketplace.md).

**Implementado:** a conexão do vendedor (`src/modules/marketplace/recebedor`) e o cliente do Mercado Pago (`src/modules/marketplace/mercado-pago`), que cria a preferência do Checkout Pro e consulta pagamentos. A compra e o webhook ainda não existem.

| Rota | Acesso | O que faz |
|---|---|---|
| `GET /api/recebedor/conectar` | Login | Devolve a `url` de autorização do Mercado Pago |
| `GET /api/recebedor/callback` | Público | Destino do redirecionamento; troca o código pelos tokens e cria ou reativa a `ContaRecebedor` |
| `GET /api/recebedor/me` | Login | Situação da conexão (nunca devolve tokens) |
| `DELETE /api/recebedor` | Login | Desconecta e apaga os tokens |

- O `state` do OAuth é aleatório, fica 10 minutos no Redis e só pode ser usado uma vez.
- Os tokens são cifrados com AES-256-GCM (`RECEBEDOR_TOKEN_KEY`) e nunca saem em resposta nem em log.
- O token vale 180 dias. Um job diário (3h) renova as contas que vencem em até 30 dias; se a renovação falhar, a conta fica `desconectado` e o vendedor precisa conectar de novo.

### Ambiente de teste

O Mercado Pago não deixa uma conta de teste autorizar uma aplicação de conta real. Por isso, nos testes, **todas as contas são de teste**:

| Conta de teste | Papel |
|---|---|
| **Integrador** | Representa o Nutrify. É a dona da aplicação de teste cujas credenciais vão no `.env`. |
| **Vendedor** | Conecta a conta no Nutrify pelo OAuth. |
| **Comprador** | Paga as receitas, com saldo ou com os cartões de teste. |

1. Na sua conta real, em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app) → **Contas de teste**, crie um Integrador, um Vendedor e um Comprador. Usuário, senha e código de verificação de cada um ficam nessa tela.
2. Numa aba anônima, entre no mesmo painel com o **Integrador** e crie uma aplicação (Checkout Pro, API de Preferences).
3. Em **Credenciais de produção** dessa aplicação, ative as credenciais e copie `Client ID`, `Client Secret`, `Access Token` e `Public Key` para o `.env`. Como a conta é de teste, elas não movimentam dinheiro real.

### Túnel HTTPS para o OAuth

O Mercado Pago só redireciona para endereços HTTPS, então o `localhost` precisa de um túnel. Com o [ngrok](https://ngrok.com) (conta grátis com um domínio fixo). O domínio grátis termina em `.ngrok-free.dev` nas contas novas e em `.ngrok-free.app` nas antigas: use o que aparece no painel do ngrok.

```bash
# uma vez: liga o ngrok à sua conta (authtoken no painel do ngrok)
ngrok config add-authtoken <seu-authtoken>

# sempre que precisar de acesso externo (OAuth ou webhook), com a API rodando
ngrok http --url=<seu-dominio>.ngrok-free.dev 3000
```

Depois, uma única vez:

- no `.env`, com o mesmo domínio (reinicie a API):
  - `MP_REDIRECT_URI=https://<seu-dominio>.ngrok-free.dev/api/recebedor/callback`
  - `API_URL_PUBLICA=https://<seu-dominio>.ngrok-free.dev` (só o domínio, sem barra nem caminho; a API não sobe com outro formato)
- no painel, logado como Integrador: **Configurações da aplicação → URLs de redirecionamento** com a mesma URL do `MP_REDIRECT_URI`.

### Testar a conexão do vendedor

1. Abra o Swagger pelo túnel (`https://<seu-dominio>.ngrok-free.dev/api/docs`) e faça login em `POST /auth/signin`.
2. Chame `GET /api/recebedor/conectar` e copie a `url` (vale 10 minutos).
3. Abra a `url` numa **aba anônima**, entre com o **Vendedor de teste** e autorize. No plano grátis do ngrok aparece antes uma página de aviso: clique em **Visit Site**.
4. A resposta deve ser `{ "conectado": true, "contaMercadoPagoId": "..." }`, e `GET /api/recebedor/me` passa a mostrar `status: "ativo"`.

**Erros comuns**

| Sintoma | Causa |
|---|---|
| "Desculpe, não foi possível conectar o aplicativo à sua conta" | URL de redirecionamento do painel diferente do `MP_REDIRECT_URI`, ou aplicação de conta real autorizada por conta de teste. |
| `400` "Link de conexão inválido ou expirado" | O link passou de 10 minutos ou já foi usado. Gere outro em `/conectar`. |
| `409` | Essa conta do Mercado Pago já está conectada a outro usuário do Nutrify. |
| `503` | `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI` ou `RECEBEDOR_TOKEN_KEY` faltando no `.env`. |

### Testar um pagamento no sandbox

Com um vendedor conectado, `scripts/sandbox-mercado-pago.ts` chama o cliente do Mercado Pago direto, sem a API rodando nem o túnel ligado. Precisa do banco, de `RECEBEDOR_TOKEN_KEY`, `API_URL_PUBLICA` e `FRONT_URL` no `.env`. Nenhum modo imprime tokens.

```bash
npx ts-node scripts/sandbox-mercado-pago.ts                                   # vendedores conectados (user_id)
npx ts-node scripts/sandbox-mercado-pago.ts preferencia <user_id> 100         # cria a preferência e imprime o link
npx ts-node scripts/sandbox-mercado-pago.ts pagamento <user_id> <payment_id>  # consulta um pagamento
npx ts-node scripts/sandbox-mercado-pago.ts recentes <user_id>                # últimos pagamentos, com o motivo da recusa
```

1. Abra o link numa aba anônima nova e entre com o **Comprador de teste** (não com o vendedor nem com o Integrador).
2. Pague com saldo (adicione saldo ao comprador, não ao vendedor) ou com um cartão de teste com titular `APRO` e CPF `12345678909`.
3. Sem front, o `FRONT_URL` pode ser `https://example.com`: o comprador volta para uma página inexistente, mas o `payment_id` fica na barra de endereço.
4. No pagamento aprovado, `fee_details` mostra a `application_fee` (a comissão da plataforma) e a `mercadopago_fee`, as duas pagas pelo vendedor.

**Erros comuns**

| Sintoma | Causa |
|---|---|
| Checkout mostra "Não foi possível processar seu pagamento" e nada aparece em `recentes` | O `notification_url` da preferência é inválido: confira `API_URL_PUBLICA`. O Mercado Pago cria a preferência mesmo assim e só recusa no pagamento. Outra causa possível é o comprador logado ser o próprio vendedor ou o Integrador. |
| Aparece em `recentes` com `rejected` | O `status_detail` diz o motivo (saldo insuficiente, titular do cartão diferente de `APRO`, etc.). |
| `404` em `pagamento` | ID errado (atenção a pontuação copiada junto). |

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
    marketplace/      termos, categoria, produto, recebedor (conexão com o Mercado Pago)
    notificacao/
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
- [`docs/decisoes_marketplace.md`](docs/decisoes_marketplace.md) e [`docs/plano-implementacao-marketplace.md`](docs/plano-implementacao-marketplace.md): decisões e plano do marketplace (venda de receitas e vitrine).
