# Nutrify API

Backend do sistema Nutrify, construído com NestJS, Prisma e PostgreSQL (Docker).

## 🚀 Como rodar o projeto localmente

**1. Clone o repositório e instale as dependências**
\`\`\`bash
npm install
\`\`\`

**2. Configure as Variáveis de Ambiente**
Crie um arquivo \`.env\` na raiz do projeto copiando o conteúdo do exemplo:
\`\`\`bash
cp .env.example .env
\`\`\`

**3. Suba o Banco de Dados (Docker)**
Certifique-se de ter o Docker instalado e rodando na sua máquina.
\`\`\`bash
docker compose up -d
\`\`\`
*(Isso vai subir os containers PostgreSQL na porta 5454 e Redis na porta 6379).* 

**4. Sincronize o Banco de Dados (Prisma)**
Este comando cria as tabelas e injeta as regras de segurança nativas (Triggers/Constraints).
\`\`\`bash
npx prisma migrate reset
\`\`\`

**5. Rode a API**
\`\`\`bash
npm run start:dev
\`\`\`

A documentação interativa (Swagger) estará disponível em: \`http://localhost:3000/api/docs\`