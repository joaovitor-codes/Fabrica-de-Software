# CI/CD: passo a passo

Guia para configurar integração contínua (CI) e entrega contínua (CD) da Nutrify API com **GitHub Actions**.

- **CI:** a cada Pull Request e push em `desenvolvimento`/`main`, o GitHub instala as dependências, aplica as migrations num Postgres temporário, compila e roda os testes.
- **CD:** depois do merge, a versão aprovada é publicada automaticamente no servidor.

---

## Parte 1: CI

### Passo 1: arquivo do workflow

O workflow fica em [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Ele faz:

| Etapa | Comando | Por quê |
|---|---|---|
| Postgres de teste | serviço `postgres:15-alpine` | banco vazio onde as migrations são aplicadas (os testes atuais usam um Prisma falso e não acessam o banco) |
| Instalar | `npm ci` | instala exatamente o que está no `package-lock.json` |
| Prisma Client | `npx prisma generate` | gera os tipos usados pelo código |
| Migrations | `npx prisma migrate deploy` | cria as tabelas no banco de teste; também valida que as migrations do PR aplicam sem erro |
| Build | `npm run build` | garante que o TypeScript compila |
| Testes | `npm test` | roda os `*.spec.ts` de `src/` |
| Lint | `npx eslint "{src,test}/**/*.ts"` | roda **sem** `--fix` (o script `npm run lint` altera arquivos, o que não faz sentido na CI) |

As variáveis do CI (`DATABASE_URL`, `JWT_SECRET`) são valores fictícios, só para o banco temporário. **Nenhum segredo real vai no arquivo.**

### Passo 2: subir o workflow

```bash
git add .github/workflows/ci.yml docs/ci-cd.md
git commit -m "ci: pipeline de build e testes"
git push -u origin docs/ci-cd
```

Abra o PR para `desenvolvimento`. A aba **Checks** do PR já mostra o job `CI / build-and-test` rodando.

### Passo 3: proteger a branch `desenvolvimento`

No GitHub: **Settings → Branches → Add branch ruleset** (ou *Add rule*):

1. Branch alvo: `desenvolvimento` (repita depois para `main`, se usarem).
2. Marque **Require a pull request before merging** e, se quiserem, 1 aprovação.
3. Marque **Require status checks to pass** e adicione `build-and-test`.
4. Marque **Block force pushes**.

A partir daqui, PR com build ou teste quebrado não pode ser mergeado.

> O check só aparece na lista depois que o workflow rodou pelo menos uma vez.

### Passo 4: zerar o lint (dívida técnica)

Hoje o ESLint acusa ~3.900 erros e o Prettier ~80 arquivos fora do padrão. Por isso o passo de lint está com `continue-on-error: true`: ele mostra os erros, mas não bloqueia o PR.

Para resolver:

1. Num PR separado, rode `npm run format` e `npm run lint` (a maioria dos erros é corrigida pelo `--fix`).
2. Corrija à mão o que sobrar.
3. Remova o `continue-on-error: true` do `ci.yml`. Pronto, lint passa a bloquear.

Faça isso num PR só de formatação, avisando o time antes: ele mexe em quase todos os arquivos e gera conflito com branches abertas.

### Passo 5 (opcional): incluir o teste e2e

`test/app.e2e-spec.ts` sobe o `AppModule` inteiro, que exige Redis e variáveis SMTP. Para rodá-lo na CI:

1. Adicione um serviço `redis:7-alpine` no job (porta 6379).
2. Adicione em `env`: `REDIS_URL`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` com valores fictícios.
3. Adicione o passo `npm run test:e2e`.

---

## Parte 2: CD

O CD depende de **onde a API vai rodar**, e isso ainda precisa ser decidido pelo time. O fluxo é o mesmo em qualquer opção:

```
merge em main ──► CI passa ──► build ──► prisma migrate deploy (banco de produção) ──► publica a nova versão
```

### Passo 6: escolher a hospedagem

| Opção | Como funciona o deploy | Banco/Redis | Bom para |
|---|---|---|---|
| **Render** ou **Railway** | conecta o repositório; cada push em `main` faz deploy sozinho | Postgres e Redis gerenciados na mesma plataforma | projeto acadêmico, menos configuração |
| **VPS** (DigitalOcean, Oracle Free Tier, máquina da faculdade) | GitHub Actions entra via SSH, faz `git pull`, build e reinicia (Docker Compose ou PM2) | roda no próprio servidor via `docker-compose.yml` | controle total, mais trabalho de manutenção |
| **Imagem Docker** (GHCR) + qualquer host de containers | Actions gera a imagem e publica no GitHub Container Registry; o host puxa a imagem | depende do host | quando quiserem portabilidade |

Recomendação para o momento do projeto: **Render ou Railway**. O deploy vira configuração no painel e o GitHub Actions fica só com o CI.

### Passo 7: configurar os segredos

Todo valor sensível fica fora do código:

- **Render/Railway:** cadastre as variáveis do `.env.example` no painel do serviço (`DATABASE_URL`, `JWT_SECRET`, `SMTP_*`, `OPENAI_API_KEY`, `REDIS_URL`, `NODE_ENV=production`).
- **VPS via Actions:** em **Settings → Secrets and variables → Actions**, crie `SSH_HOST`, `SSH_USER`, `SSH_KEY`. As variáveis da aplicação ficam num `.env` no próprio servidor.

Gere um `JWT_SECRET` novo para produção (`openssl rand -base64 48`). Nunca reaproveite o de desenvolvimento.

### Passo 8: comandos de build e start

Em qualquer hospedagem:

- **Build:** `npm ci && npx prisma generate && npm run build`
- **Antes de iniciar (pre-deploy):** `npx prisma migrate deploy`
- **Start:** `npm run start:prod`

No Render/Railway, cada um desses vai no campo correspondente do painel. Ative o deploy só quando os checks passarem (Render: *Auto-Deploy → After CI checks pass*; Railway: *Wait for CI*).

### Passo 9: workflow de deploy (só se for VPS)

Crie `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd ~/Fabrica-de-Software
            git pull origin main
            npm ci
            npx prisma generate
            npx prisma migrate deploy
            npm run build
            pm2 reload nutrify-api || pm2 start dist/main.js --name nutrify-api
```

O deploy só roda se o CI de `main` passar. O `environment: production` permite exigir aprovação manual em **Settings → Environments → production → Required reviewers**.

### Passo 10: validar

1. Faça um merge pequeno em `main`.
2. Acompanhe na aba **Actions** (ou no painel do Render/Railway).
3. Acesse a URL de produção e o Swagger para confirmar que a nova versão subiu.
4. Adicione o badge no README:

```markdown
![CI](https://github.com/joaovitor-codes/Fabrica-de-Software/actions/workflows/ci.yml/badge.svg)
```

---

## Checklist

- [ ] `ci.yml` mergeado em `desenvolvimento`
- [ ] Branch protection exigindo `build-and-test`
- [ ] PR de formatação/lint e remoção do `continue-on-error`
- [ ] Hospedagem escolhida
- [ ] Segredos de produção cadastrados (fora do repositório)
- [ ] Deploy automático após CI verde em `main`
- [ ] Badge no README
