# Nutrify API

Backend do **Nutrify**, uma plataforma que conecta nutricionistas e pacientes: planos alimentares, anamnese, receitas com base na TACO, restrições alimentares e diário de sintomas.

Construído com **NestJS**, **Prisma**, **PostgreSQL** e **Redis**.

📄 **Documentação completa:** [`docs/documentacao-inicial.md`](./docs/documentacao-inicial.md)

## Como rodar localmente

```bash
npm install
cp .env.example .env       # ajuste os valores (veja a documentação)
docker compose up -d       # PostgreSQL (5454) + Redis (6379)
npx prisma migrate reset   # cria as tabelas (apaga os dados locais)
npm run start:dev
```

Swagger: `http://localhost:3000/api/docs`
