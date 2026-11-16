# Decisões: módulo anamnese

Consolidado de uma discussão de arquitetura sobre o módulo `anamnese` (perguntas, opções, anamnese e respostas) e sobre `paciente-restricao`. Este arquivo resume o que foi decidido. **Nenhuma mudança de schema foi necessária** — as decisões cabem no modelo já existente em `schema.prisma`. Tudo está implementado (ver "Como ficou").

## Contexto

- `AnamnesePergunta`/`AnamneseOpcao` já são tabelas globais/compartilhadas (não pertencem a um paciente específico) — já funcionam como um banco de perguntas reutilizável, com `categoria`, `ordem` e `ativa` para organizar exibição. Não existe hoje o conceito de múltiplos templates por especialidade; é um único conjunto global de perguntas ativas.
- `Anamnese` é o container por paciente (`pacienteId`, `profissionalId`, `dataPreenchimento`, `observacoesGerais`); `AnamneseResposta` liga `anamneseId` + `perguntaId` (+ opcionalmente `opcaoId`).
- Quando a discussão aconteceu, só existia `AnamneseService.createAnamnese` (parcial, sem validação de papel) e o `AnamneseController` estava vazio.
- `PacienteRestricao` (`src/modules/nutricao/paciente-restricao/`) tinha CRUD completo, mas restrito a `admin`/`profissional`; o service (`verificarProfissional`) já recebe `userId`/`tipoUsuario` e valida que o profissional só mexe em pacientes seus.

## Decisões de arquitetura (papéis e permissões)

- **`AnamnesePergunta` / `AnamneseOpcao` (o "template")**: escrita (`POST`/`PATCH`/`DELETE`) só para `admin`. Leitura (`GET`) livre para qualquer usuário autenticado — o profissional (e futuramente o paciente) precisa ler as perguntas pra montar/preencher o formulário, mesmo sem poder editá-las. Segue o padrão já usado em `ingrediente.controller.ts` (guard só nas rotas de escrita).
- **`Anamnese` / `AnamneseResposta` (o preenchimento)**: só `profissional` cria/preenche. Descartada a ideia de o paciente preencher a anamnese clínica por conta própria — não haveria uso real, e evita ter que tornar `profissionalId` opcional no schema.
- **`PacienteRestricao`**: além do fluxo atual (admin/profissional cadastram restrição de um paciente), o paciente passa a poder cadastrar **suas próprias** restrições alimentares via rota self-service, sem depender do profissional. Sem campo de origem (self-reported vs. confirmado por profissional) por agora — decisão explícita de não adicionar essa distinção nesta rodada.
- **Notificação `anamnese_pendente`** (ver `schema.prisma:1122-1144`): esse tipo de notificação só faz sentido se o paciente for quem preenche a anamnese. Como isso foi descartado, esse código de notificação fica **sem gatilho concreto** por ora — ver "Fora de escopo" abaixo.

## O que fica de fora nesta rodada (feito de propósito)

- Paciente não cria/preenche `Anamnese`/`AnamneseResposta` — só o profissional.
- Sem migration: `profissionalId` continua obrigatório em `Anamnese`.
- Sem campo de origem/confiabilidade em `PacienteRestricao`.
- Sem múltiplos templates de anamnese por especialidade — um único conjunto global de perguntas ativas, filtrado por `ativa: true` e ordenado por `categoria`/`ordem`.
- Sem uso de notificação na anamnese. Hoje existe o `NotificacaoService`, criado depois para o marketplace, mas sem rotas de leitura.

## Como ficou (implementado)

Tudo o que estava nos próximos passos foi implementado. Os contratos completos estão no `documentacao-api.html` (seção "Anamnese").

**Perguntas e opções (o template).** Escrita só `admin`; leitura para qualquer usuário logado.

| Rota | Acesso |
|---|---|
| `POST /api/anamnese/perguntas` | admin |
| `GET /api/anamnese/perguntas/page/:page/limit/:limit` | Login (só as ativas) |
| `GET /api/anamnese/perguntas/:id` | Login |
| `PATCH /api/anamnese/perguntas/:id` | admin |
| `PATCH /api/anamnese/perguntas/:id/ativar` e `/desativar` | admin |
| `DELETE /api/anamnese/perguntas/:id` | admin; falha se já houver opções ou respostas vinculadas (para tirar de uso, desative) |
| `GET /api/anamnese/perguntas/:perguntaId/opcoes` | Login |
| `POST /api/anamnese/perguntas/:perguntaId/opcoes` | admin |
| `PATCH` e `DELETE /api/anamnese/opcoes/:id` | admin |

**Anamnese e respostas (o preenchimento).** Só o `profissional` cria e preenche; o profissional vem do token, nunca do body.

| Rota | Acesso |
|---|---|
| `POST /api/anamnese` | profissional |
| `POST /api/anamnese/:anamneseId/respostas` | profissional dono da anamnese |
| `PATCH` e `DELETE /api/anamnese/respostas/:id` | profissional |
| `GET /api/anamnese/:id` | profissional dono, paciente dono ou admin |
| `GET /api/anamnese/paciente/:pacienteId` | profissional dono, paciente dono ou admin |

A dúvida do antigo item 5 foi resolvida assim: o paciente pode ler a própria anamnese.

**Restrições do próprio paciente.** `GET`, `POST /api/pacientes/me/restricoes` e `PATCH`, `DELETE /api/pacientes/me/restricoes/:restricaoId`, só `paciente`, com o `pacienteId` resolvido pelo token.

**Notificação `anamnese_pendente`.** Continua sem gatilho. O `NotificacaoService` (`src/modules/notificacao/`) já existe, criado para o marketplace, mas não há rota de leitura de notificações nem uso na anamnese.

## Fora de escopo desta frente (sem mudança)

Rotas de leitura de notificações, múltiplos templates de anamnese por especialidade, campo de origem em `PacienteRestricao`, `profissionalId` nullable em `Anamnese`, testes automatizados.
