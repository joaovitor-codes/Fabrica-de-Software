# Decisões: receitas seguras por restrição

Plano para que o usuário só veja receitas que pode comer. Para cada restrição dele, aparece a receita original (se já for segura) ou a versão adaptada. Este arquivo resume o que foi decidido e divide a implementação em fases. Nada daqui está no `schema.prisma` ainda.

## Contexto

A ideia da plataforma é ser 100% adaptada: o usuário com restrição nunca deveria ver uma receita que não pode comer.

Estado atual do código que afeta este plano:

- **Não existe selo de "segura para X".** A única informação é `GET /receitas/:id/alertas` (`findAlerts`), que lista as restrições disparadas pelos ingredientes, e o booleano genérico `avisoContaminacaoCruzada`.
- **Visibilidade** (`filtroVisibilidade` em `receita.service.ts`): visitante vê só as aprovadas; usuário logado vê as aprovadas e as próprias; admin e profissional veem todas. Usam o filtro `findAll`, `findOne`, `findByName` e tudo que passa por `garantirVisivel` (`ingredientes`, `alertas`). **Não usam**: `findSuggestions`, `findValidated` e `findFavorites`. As rotas de `sugestoes` e `validadas` nem recebem o usuário (estão sem `OptionalAuthGuard`).
- **Edição** (`update`): editar uma receita aprovada a devolve para `pendente` e cria uma `ReceitaVersao`. Os ingredientes **não** são editáveis hoje: o `UpdateReceitaDto` tem o campo `ingredientes`, mas o `update` o ignora.
- **Aprovação** (`aprovarReceita`): exige profissional com `statusAprovacao = aprovado`, proíbe aprovar a própria receita e dá pontos (`ganho_aprovacao`).
- **Exclusão** (`remove`): soft delete se a receita está em algum plano; caso contrário, apaga de vez, com as tabelas filhas.
- **Restrições do paciente**: `PacienteRestricao` só tem rotas para admin e profissional. A rota em que o próprio paciente cadastra as restrições (`/pacientes/me/restricoes`) foi decidida em `regra_negocio_anamnese.md`, mas **não foi implementada**. Usuários do tipo `comum` não têm `Paciente` e, portanto, não têm restrições.
- **Ingredientes**: `POST /api/ingrediente` exige só login. Qualquer usuário pode criar um ingrediente, e ele nasce sem nenhum vínculo de restrição.
- **IA**: `IaService.encontrarSubstituto` é usada só por `IngredienteSubstitutoService.gerarSubstituto` (admin e profissional). Ela **cria ingredientes novos** a partir do texto livre da IA (`fonteDados = 'ia_estimativa_nao_verificada'`) e os liga em `IngredienteSubstituto`. Esses ingredientes também nascem sem vínculo de restrição.
- **Curadoria por palavra-chave**: descrita em `regra_negocio.md`, mas **não existe**. O `scripts/import-taco.ts` só importa os dados nutricionais.

## Conceitos

A segurança é sempre do **par receita + restrição**, não da receita inteira. Um bolo adaptado para lactose pode ser nativamente seguro para ovo.

- **Nativa**: nenhum ingrediente da receita tem vínculo com a restrição em `IngredienteRestricao`.
- **Adaptada**: receita derivada de outra, com ingredientes substituídos para atender uma restrição.
- **Verificada / não verificada**: só se aplica à adaptada. Diz se um profissional revisou a adaptação.

### Nativa é calculada, não gravada

A segurança nativa sai direto da query, por exemplo:

```ts
ingredientes: {
  none: { ingrediente: { restricoes: { some: { restricaoId: { in: ids } } } } },
}
```

Motivo: se ela fosse gravada numa tabela, ficaria desatualizada sempre que a receita mudasse ou a curadoria criasse ou removesse um vínculo em `IngredienteRestricao`. Calculando na hora, isso nunca acontece.

A mesma checagem vale para a receita adaptada: ela só é segura se também passar no teste "nenhum ingrediente vinculado".

### Ingrediente "sem vínculo" não é o mesmo que "seguro"

Um ingrediente sem vínculo pode ser seguro de fato ou simplesmente nunca ter sido revisado. Isso acontece com todo ingrediente criado por usuário via `POST /api/ingrediente` e com todo substituto criado pela IA. Se a regra fosse só "sem vínculo = seguro", bastaria um usuário cadastrar "queijo minas" como ingrediente novo para a receita passar como segura para lactose.

Por isso, `Ingrediente` ganha um marcador de curadoria:

```prisma
model Ingrediente {
  // ...
  restricoesRevisadasEm DateTime? @map("restricoes_revisadas_em") @db.Timestamptz(6)
}
```

- Fica `null` ao criar o ingrediente, por qualquer caminho.
- É preenchido quando um curador (admin ou profissional) revisa as restrições do ingrediente, seja pelo script da Fase 0, seja por um endpoint novo `PATCH /api/ingrediente/:id/restricoes/revisado`.
- Para restrição **estrita**, a receita só é segura se for nativa **e** se todos os ingredientes tiverem `restricoesRevisadasEm` preenchido.
- Para restrição **flexível**, um ingrediente não revisado não esconde a receita, mas aparece no alerta como "não revisado".

## Regra de exibição

Uma restrição do usuário é **estrita** quando `RestricaoAlimentar.tipo = alergia` ou `PacienteRestricao.gravidade = grave`. As demais são **flexíveis**.

| Situação da receita | Restrição estrita | Restrição flexível |
| --- | --- | --- |
| Nativa segura, tudo revisado | mostra | mostra |
| Nativa segura, com ingrediente não revisado | esconde | mostra, com aviso |
| Tem adaptada verificada | mostra a adaptada no lugar | mostra a adaptada no lugar |
| Tem só adaptada não verificada | esconde | mostra a adaptada, com aviso |
| Não tem adaptação | esconde | mostra a original, com o botão "adaptar" |

Visitante, usuário sem `Paciente` ou paciente sem `PacienteRestricao` continuam vendo tudo como hoje. Admin e profissional também, porque precisam enxergar o catálogo inteiro para curadoria.

## Onde a IA entra

Princípio: **a IA sugere, a regra determinística decide**. Nenhuma resposta da IA marca algo como seguro sozinha. Toda saída dela passa pela checagem "nenhum ingrediente vinculado" ou por revisão humana antes de ter efeito.

| Onde | O que a IA faz | Quem decide |
| --- | --- | --- |
| Fase 0: curadoria | Classifica os ingredientes da TACO por alérgeno | Curador, revisando os candidatos |
| Fase 1: criação e edição de receita | Aponta ingredientes citados no `modoPreparo` que faltam na lista | Autor corrige; profissional vê o aviso na aprovação |
| Fase 2: adaptação | Escolhe substitutos, ajusta quantidades e reescreve o modo de preparo | Checagem determinística; profissional, na verificação |
| Fase 2: verificação | Resume para o profissional o que mudou e os pontos de atenção | Profissional |

Onde a IA **não** entra: no filtro de exibição (Fases 1 e 3). Ele roda em toda listagem, precisa ser rápido e previsível e não pode depender de uma chamada externa.

**Dados enviados à IA**: só dados de receita e ingrediente, mais o nome da restrição. Nunca dados do paciente (nome, id, gravidade, histórico). Restrição alimentar ligada a uma pessoa é dado de saúde e, portanto, sensível pela LGPD.

**Chave**: continua em `OPENAI_API_KEY` no `.env`. Se o provedor mudar, só o `IaService` precisa ser alterado. Os métodos novos ficam no `IaService`, reaproveitando o `perguntarJson`.

## Fase 0: curadoria dos alérgenos principais

Pré-requisito para a Fase 1. Sem isso, quase nenhum ingrediente está revisado e o filtro estrito esconderia praticamente todas as receitas.

1. Migration com `Ingrediente.restricoesRevisadasEm`.
2. Garantir que existam em `RestricaoAlimentar` os alérgenos principais: leite, ovo, amendoim, castanhas, trigo/glúten, soja, peixe e frutos do mar. Os nomes seguem a lista de alergênicos da RDC nº 26/2015 da ANVISA.
3. Novo script `scripts/curadoria-alergenos.ts` (fora da API, no mesmo estilo do `import-taco.ts`) que gera os candidatos combinando duas fontes:
   - matching por palavra-chave, com o dicionário como config estática dentro do script, como decidido em `regra_negocio.md`;
   - classificação por IA, em lotes de ingredientes, que pega os casos que a palavra-chave perde. Exemplos: "pão francês" contém trigo, "chocolate ao leite" contém leite, "maionese" contém ovo. A IA também diz quando **não tem certeza**.
4. O script exporta os candidatos para CSV, marcando a fonte (palavra-chave, IA ou as duas) e a incerteza. Candidatos em que as duas fontes concordam são revisados primeiro; os casos de incerteza, com mais cuidado. A revisão continua fora do banco.
5. Um segundo modo do script lê o CSV revisado, insere os vínculos em `IngredienteRestricao` (`origem = automatico_confirmado_curadoria`) e preenche `restricoesRevisadasEm` de todo ingrediente que passou pela revisão, com ou sem vínculo.
6. Endpoint `PATCH /api/ingrediente/:id/restricoes/revisado` (admin e profissional) para revisar ingredientes criados depois, inclusive os gerados pela IA.

Vale como regra: a IA só gera candidato e nunca grava vínculo direto. Para alergia, um falso negativo (alérgeno não vinculado) é o erro grave. Por isso, na dúvida, o candidato entra na lista para revisão.

## Fase 1: filtro padrão por restrições (só nativas)

Entrega: o paciente com restrições deixa de ver receitas que as violam. Ainda não existe adaptação. Por isso, nesta fase, toda receita insegura fica escondida para restrição estrita e é mostrada com alerta para restrição flexível.

**Dependência**: hoje só o profissional cadastra as restrições do paciente. Implementar junto a rota self-service `POST/GET/DELETE /api/pacientes/me/restricoes`, já decidida no item 7 de `regra_negocio_anamnese.md`. Sem ela, só o paciente que tem profissional vinculado é filtrado.

1. **Carregar as restrições do usuário.** Um helper busca o `Paciente` pelo `usuario.id` e suas `PacienteRestricao` com a `RestricaoAlimentar`, e as separa em estritas e flexíveis. Só roda para `tipoUsuario = paciente`.
2. **Plugar no `filtroVisibilidade`.** Hoje ele é síncrono e devolve um `where`. Ele passa a ser `async`, ou recebe as restrições já carregadas, e soma ao `where` atual a cláusula `none` com os ids estritos, além da exigência de ingredientes revisados. Os usos atuais (`findAll`, `findOne`, `findByName`, `garantirVisivel`) passam a respeitar o filtro automaticamente.
3. **Endpoints que hoje ficam de fora:**
   - `sugestoes` e `validadas`: adicionar `OptionalAuthGuard` na rota e passar o usuário para o service, que passa a usar o filtro.
   - `favoritos`: não filtra, porque sumir com um favorito sem explicar confunde. Cada receita ganha o campo `restricoesVioladas`.
4. **Restrição flexível** → não filtra. A resposta das listagens ganha `restricoesVioladas` (ids, nomes e ingredientes não revisados) para o front exibir o alerta. Reaproveitar a lógica de agrupamento do `findAlerts`, extraída para um helper.
5. **Parâmetro opcional `?seguraPara=<restricaoId>`** em `all` e `nome`, para qualquer usuário, inclusive visitante, filtrar explicitamente.
6. **Link direto para receita escondida** (`GET :id`): hoje o `findOne` devolve `404` quando a receita não passa no filtro. Para o caso de restrição, devolver `403` com o motivo ("contém: amendoim"). Na Fase 3, isso vira redirecionamento para a adaptada.
7. **Cache**: o `findAll` só é cacheado para visitante (`receitas:all`), então o filtro por usuário não quebra o cache. Isso precisa continuar assim. `sugestoes` e `validadas` não usam cache.
8. **Ingredientes ocultos no modo de preparo.** O filtro só enxerga a lista de ingredientes. Se o `modoPreparo` diz "finalize com queijo ralado" e queijo não está na lista, a receita passa como segura para lactose. No `create` e no `update`, a IA compara o texto com a lista e devolve os ingredientes citados que faltam:
   - novo campo `Receita.ingredientesNaoListados String[]`, gravado junto com a receita;
   - o autor recebe o aviso na resposta para corrigir;
   - o aviso aparece para o profissional em `findPendentes` e na aprovação. A receita ainda pode ser aprovada, mas o profissional decide sabendo do aviso;
   - para restrição estrita, receita com `ingredientesNaoListados` não vazio é tratada como não revisada;
   - se a IA falhar, a receita é salva normalmente, com o campo vazio e um log de erro. A checagem ajuda, mas não bloqueia.
9. **Plano alimentar**: ao adicionar ou trocar a receita de um item (`plano-alimentar.service.ts`, nos dois pontos que hoje só checam se a receita existe), bloquear a receita que viola uma restrição estrita do paciente do plano.
10. **Testes**: seguir o padrão do `receita-visibilidade.integration.spec.ts`. Casos: paciente com alergia não vê a receita com o alérgeno nem a que tem ingrediente não revisado; paciente com intolerância vê, com `restricoesVioladas`; visitante, `comum` e profissional veem tudo; `sugestoes` e `validadas` respeitam o filtro. A IA é mockada com `jest.spyOn` no `IaService`.

## Fase 2: adaptação por IA

Entrega: o usuário pede a versão adaptada de uma receita para uma restrição e recebe na hora.

### Modelagem

A receita adaptada é uma `Receita` comum, com ingredientes próprios. Por isso continua funcionando com alertas, favoritos e plano alimentar sem nenhum código especial.

**A verificação reaproveita o fluxo de aprovação que já existe**: adaptada `pendente` = não verificada, adaptada `aprovada` = verificada. Assim, a fila (`findPendentes`), as regras de quem pode aprovar e os pontos do profissional continuam valendo sem duplicar nada. A tabela nova só guarda a ligação:

```prisma
model ReceitaAdaptacao {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  receitaOrigemId   String   @map("receita_origem_id") @db.Uuid
  versaoOrigem      Int      @map("versao_origem")
  receitaAdaptadaId String   @unique @map("receita_adaptada_id") @db.Uuid
  restricaoId       String   @map("restricao_id") @db.Uuid
  resumoIa          String?  @map("resumo_ia") @db.Text
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@unique([receitaOrigemId, restricaoId])
  @@map("receita_adaptacoes")
}
```

- `@@unique([receitaOrigemId, restricaoId])` garante só uma adaptação por par, que é o que permite reaproveitá-la.
- `versaoOrigem` guarda a `versaoAtual` da original no momento da adaptação. Se a original for editada depois, a adaptação fica desatualizada e é gerada de novo no próximo pedido, substituindo a antiga.

### Mudanças no código existente

- **`filtroVisibilidade`**: hoje uma receita `pendente` só é vista pelo autor. Abrir uma exceção: adaptada `pendente` também é vista por quem tem a restrição dela como **flexível**.
- **`findPendentes`**: incluir a `ReceitaAdaptacao` e o `resumoIa`, para o profissional saber que é uma adaptação e ver a original ao lado.
- **`remove`**: hoje apaga a receita e as tabelas filhas. Passa a apagar também as `ReceitaAdaptacao` em que ela é origem ou adaptada. Se a original for apagada, as adaptadas continuam como receitas independentes.
- **`ReceitaModule`**: importar o `IaModule`.

### Fluxo `POST /receitas/:id/adaptar { restricaoId }`

Exige login. Qualquer tipo de usuário pode pedir.

1. Se já existir uma `ReceitaAdaptacao` para o par, com `versaoOrigem` igual à versão atual, devolve a existente, sem chamar a IA.
2. Se a receita já for nativa segura para a restrição, devolve a própria receita.
3. Para cada ingrediente vinculado à restrição, procura um substituto primeiro em `IngredienteSubstituto`, preferindo destinos com `restricoesRevisadasEm`. Só recorre à IA se não encontrar. **A IA escolhe dentro da base de `Ingrediente`**: o prompt recebe uma lista de candidatos da base que não têm vínculo com a restrição. Uma resposta fora da lista é descartada. Esse fluxo **não** usa o `gerarSubstituto`, porque ele cria ingredientes novos a partir de texto livre.
4. A IA ajusta as quantidades quando a troca não for 1:1 (ex: farinha de trigo por farinha de arroz), reescreve o `modoPreparo` e gera o `resumoIa` para a verificação. O texto reescrito também passa pela checagem de ingredientes ocultos da Fase 1.
5. **Checagem determinística**: a receita adaptada passa pelo mesmo teste "nenhum ingrediente vinculado". Se falhar, nada é gravado e a resposta é um erro.
6. Grava a `Receita` adaptada (`status = pendente`, `criadoPor` = quem pediu, mesmo `avisoContaminacaoCruzada` da original) e a `ReceitaAdaptacao`, numa transação.
7. Se a restrição for estrita para quem pediu, responde que a adaptação foi criada, mas só fica disponível depois da verificação.

### Aprendizado

Quando uma adaptação é aprovada, os substitutos que a IA escolheu viram linhas em `IngredienteSubstituto`. Na próxima adaptação com o mesmo ingrediente e a mesma restrição, o substituto curado é usado e a IA nem é chamada para essa troca. Isso entra no `aprovarReceita`, só quando a receita tem `ReceitaAdaptacao`.

## Fase 3: substituição da original pela adaptada

Entrega: nas listagens, o usuário vê diretamente a versão que pode comer.

1. Depois do filtro da Fase 1, para cada receita insegura, buscar `ReceitaAdaptacao` pelos pares (receita, restrição violada) e trocar a original pela adaptada, conforme a tabela da regra de exibição.
2. Fazer essa busca em lote: uma query para todas as receitas da listagem, não uma por receita.
3. A adaptada também precisa passar no filtro para as **outras** restrições do usuário. Se não passar, aplica a regra de "não tem adaptação".
4. `GET :id` de uma receita escondida redireciona para a adaptada, quando houver.
5. Na resposta, a adaptada carrega `receitaOrigemId`, `restricaoAdaptada` e `verificada`, para o front mostrar o aviso certo.

## Decisões em aberto

- **Usuário com várias restrições** (ex: lactose + glúten). A adaptação é por uma restrição. Se a adaptação para lactose ainda contém glúten, ela é descartada para esse usuário (passo 3 da Fase 3). A alternativa é adaptar para o conjunto de restrições de uma vez, mas isso reduz muito o reaproveitamento. Começar por restrição única e medir.
- **Edição de ingredientes.** Hoje o `update` ignora `ingredientes`. Quando isso for implementado, a regra de voltar para `pendente` ao editar uma receita aprovada já cobre as adaptadas.
- **Usuário `comum` com restrição.** Hoje só `Paciente` tem restrições. Se o `comum` também precisar do filtro, as restrições teriam que ser ligadas ao `Usuario`, não ao `Paciente`. Fica para depois.
- **Custo da IA.** Gerar adaptações em segundo plano, logo que uma receita é aprovada, para as restrições mais comuns. Isso deixa a experiência instantânea também na primeira vez. Decidir depois de medir o uso da Fase 2.
