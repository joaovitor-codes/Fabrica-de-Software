# Decisões: módulo anamnese

Consolidado de uma discussão de arquitetura sobre o módulo `anamnese` (perguntas, opções, anamnese e respostas) e sobre `paciente-restricao`. Este arquivo resume o que foi decidido e o que falta implementar. **Nenhuma mudança de schema é necessária** — as decisões abaixo cabem no modelo já existente em `schema.prisma`.

## Contexto

- `AnamnesePergunta`/`AnamneseOpcao` já são tabelas globais/compartilhadas (não pertencem a um paciente específico) — já funcionam como um banco de perguntas reutilizável, com `categoria`, `ordem` e `ativa` para organizar exibição. Não existe hoje o conceito de múltiplos templates por especialidade; é um único conjunto global de perguntas ativas.
- `Anamnese` é o container por paciente (`pacienteId`, `profissionalId`, `dataPreenchimento`, `observacoesGerais`); `AnamneseResposta` liga `anamneseId` + `perguntaId` (+ opcionalmente `opcaoId`).
- Hoje só existe `AnamneseService.createAnamnese` (parcial, sem validação de papel) e `AnamneseController` está vazio. `AnamneseModule` já está registrado em `app.module.ts`.
- `PacienteRestricao` (`src/paciente-restricao/`) já tem CRUD completo, mas restrito a `admin`/`profissional`; o service (`verificarProfissional`) já recebe `userId`/`tipoUsuario` e valida que o profissional só mexe em pacientes seus.

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
- Sem módulo de `Notificacao` (envio/leitura) implementado — o schema já existe, mas não há service/controller ainda; não faz parte desta frente.

## Próximos passos (implementação)

1. **DTOs de anamnese** (`src/anamnese/dtos/anamnese.ts`) — hoje só têm `@ApiProperty`, sem decorators de validação de `class-validator`. Adicionar `@IsUUID()`, `@IsString()`, `@IsNotEmpty()` etc. Em `createAnamneseRespostaDto`, `respostaTexto`/`respostaNumero`/`opcaoId` devem ficar `@IsOptional()` — são mutuamente exclusivos dependendo do `tipoResposta` da pergunta, e isso **não é validado no banco** (não há `CHECK` de exclusive-arc em `anamnese_respostas`, diferente de `notificacoes`). Essa validação de "qual campo é obrigatório para qual `tipoResposta`" precisa ficar na service.

2. **Service + controller de `AnamnesePergunta`** (CRUD, pode ficar dentro do módulo `anamnese` ou em `anamnese-pergunta` separado, seguindo o padrão de módulos existente):
   - `POST /api/anamnese/perguntas` — `@Roles(admin)`
   - `PATCH /api/anamnese/perguntas/:id` — `@Roles(admin)`
   - `DELETE /api/anamnese/perguntas/:id` — `@Roles(admin)`. Atenção: a FK `anamnese_opcoes_pergunta_id_fkey` e `anamnese_respostas_pergunta_id_fkey` são `ON DELETE RESTRICT` — apagar uma pergunta já respondida vai falhar no banco. Na prática, "remover" uma pergunta em uso deve ser um `PATCH` setando `ativa: false`, não um `DELETE` físico. Vale decidir se o endpoint de `DELETE` só é permitido quando não há respostas vinculadas (ou nem expor `DELETE`, só `ativa`).
   - `GET /api/anamnese/perguntas` — sem `@Roles`, só `AuthGuard`. Lista perguntas (por padrão só `ativa: true`), ordenadas por `categoria`/`ordem`.
   - `GET /api/anamnese/perguntas/:id` — idem.

3. **Service + controller de `AnamneseOpcao`**, aninhado em pergunta, mesmas regras de papel:
   - `POST /api/anamnese/perguntas/:perguntaId/opcoes` — `@Roles(admin)`
   - `PATCH /api/anamnese/opcoes/:id` — `@Roles(admin)`
   - `DELETE /api/anamnese/opcoes/:id` — `@Roles(admin)` (mesma ressalva de `RESTRICT` por `anamnese_respostas_opcao_id_fkey`, embora esse aqui seja `ON DELETE SET NULL`, então apagar é seguro, mas invalida respostas antigas — considerar também)
   - `GET /api/anamnese/perguntas/:perguntaId/opcoes` — sem `@Roles`.

4. **`AnamneseService.createAnamnese`** — ajustar:
   - Controller com `@Roles(profissional)`.
   - Não confiar em `profissionaId` do body: resolver o profissional a partir de `request.user.sub` (via `ProfissionalService.findByUsuarioId`, que já existe), igual ao espírito de `verificarProfissional` em `paciente-restricao.service.ts`. Isso evita um profissional criar uma anamnese em nome de outro.
   - Validar que `pacienteId` existe antes de criar.

5. **Service + controller de `AnamneseResposta`**:
   - `POST /api/anamnese/:anamneseId/respostas` — `@Roles(profissional)`, validando que a `Anamnese` pertence ao profissional autenticado (mesmo padrão de dono usado em `paciente-restricao.service.ts`).
   - Validar a exclusividade de campo por `tipoResposta` da pergunta (ver item 1).
   - `GET /api/anamnese/:anamneseId` — retorna anamnese + respostas. Ainda em aberto: o paciente pode ler a própria anamnese (histórico), ou só o profissional dono? Não foi decidido na conversa — precisa de uma resposta antes de implementar essa rota.

6. **`AnamneseController`** (`src/anamnese/anamnese.controller.ts`, hoje vazio) — registrar todas as rotas acima, com `@UseGuards(AuthGuard, RolesGuard)` no nível do controller, igual ao padrão de `pacientes.controller.ts`/`usuario.controller.ts`.

7. **`PacienteRestricaoController`/`Service`** — adicionar rota self-service, espelhando o padrão `me/*` de `usuario.controller.ts`:
   - `POST /api/pacientes/me/restricoes` — `@Roles(paciente)`, resolve `pacienteId` via `PacientesService.getPacienteByUserId(request.user.sub)` (nunca aceitar `pacienteId` do body/paciente autenticado), e reaproveita a lógica de `vincularRestricaoAoPaciente` pulando a checagem `verificarProfissional` (o paciente sempre pode mexer no que é seu).
   - Opcional, mesmo padrão: `GET /api/pacientes/me/restricoes` e `DELETE /api/pacientes/me/restricoes/:restricaoId`.

8. **Notificação `anamnese_pendente`** — decidir explicitamente: remove esse código do catálogo de `tipos_notificacao` (já que não há mais gatilho de paciente preenchendo) ou mantém para um uso futuro diferente (ex.: avisar o paciente que o profissional criou uma anamnese nova, sem que ele precise preenchê-la)? Não implementar módulo de `Notificacao` nesta frente independente da resposta.

## Fora de escopo desta frente (sem mudança)

Módulo de `Notificacao` (service/controller), múltiplos templates de anamnese por especialidade, campo de origem em `PacienteRestricao`, `profissionalId` nullable em `Anamnese`, testes automatizados.
