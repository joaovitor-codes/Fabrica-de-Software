# Decisões: módulo ingrediente-restricao

Consolidado de uma discussão de arquitetura sobre como vincular `Ingrediente` a `RestricaoAlimentar`. Este arquivo resume o que foi decidido e o que falta implementar. `schema.prisma` já foi atualizado com as mudanças de modelagem descritas aqui.

## Contexto

A base de ingredientes vem da TACO (Tabela Brasileira de Composição de Alimentos), que só tem dado nutricional — não tem classificação de alergênico ou restrição. O vínculo `Ingrediente` x `RestricaoAlimentar` não pode ser derivado automaticamente na maioria dos casos; é curadoria manual, com uma exceção específica (doença crônica com regra numérica).

## Decisões de modelagem (já aplicadas no schema.prisma)

### `IngredienteRestricao` ganhou o campo `origem`

```prisma
enum OrigemVinculoRestricao {
  manual
  automatico_regra_nutricional
  automatico_confirmado_curadoria
}
```

Motivo: sem isso, recomputar uma regra nutricional (ex: ajustar o limiar de sódio) poderia sobrescrever silenciosamente uma decisão manual de curador. Default `manual` — todo vínculo criado via API (POST individual) é curadoria humana; só o script de bootstrap grava os outros dois valores.

### Nova tabela `RestricaoRegraNutricional`

```prisma
model RestricaoRegraNutricional {
  id               String   @id
  restricaoId      String   // FK -> RestricaoAlimentar
  campoNutricional String   // ex: "sodioMg", "carboidratoLiquido"
  operador         String   // ex: ">"
  valorLimite      Decimal? // nullable até validação clínica
}
```

Guarda o limiar de doença crônica **ligado à restrição**, não ao ingrediente nem ao vínculo — evita duplicar o limiar por ingrediente e permite ajustar num lugar só. `valorLimite` pode ficar `null`: a linha existe, mas nenhum job deve gerar vínculo automático a partir de uma regra sem limiar definido.

## Decisões de escopo — o que NÃO existe no banco (feito de propósito)

- **Sem tabela de staging/fila de candidatos.** A geração de candidatos (por palavra-chave ou por dado nutricional ausente) roda como script único de bootstrap, revisão manual acontece fora do banco (console/CSV), e só o resultado final entra em `IngredienteRestricao`.
- **Sem tabela de dicionário de palavras-chave.** Vira config estática dentro do próprio script de bootstrap (ex: `{ lactose: ["leite", "queijo", "iogurte", ...] }`), não precisa ser editável em runtime pela aplicação.
- **Sem endpoint de vínculo em lote na API pública.** Só CRUD individual:
  - `POST /api/ingrediente/:ingredienteId/restricoes`
  - `GET /api/ingrediente/:ingredienteId/restricoes`
  - `DELETE /api/ingrediente/:ingredienteId/restricoes/:restricaoId`
  - `AuthGuard` só nas rotas de escrita (POST/DELETE); leitura pública.

Justificativa geral: o objetivo é a aplicação já nascer com a base TACO carregada e curada. A carga inicial é script direto via Prisma, não feature de produto. A API só precisa suportar manutenção incremental (adicionar/corrigir um ingrediente por vez).

## Fonte de dados da TACO

- **Fonte**: PDF oficial NEPA/UNICAMP, 4ª edição (2011), ~597 alimentos. Confirmado via `https://cfn.org.br/wp-content/uploads/2017/03/taco_4_edicao_ampliada_e_revisada.pdf` (mirror do Conselho Federal de Nutricionistas).
- **Estrutura relevante**: os campos usados por `Ingrediente` (calorias, proteína, lipídeos, carboidrato, fibra, sódio) estão todos na "Tabela 1" do PDF (não nas Tabelas 2/3, que são ácidos graxos e aminoácidos — irrelevantes pro schema atual).
- **Junção necessária**: a Tabela 1 é impressa em duas metades por página, unidas pelo "Número do Alimento". Sódio está na segunda metade — o parser precisa juntar as duas antes de mapear pro `Ingrediente`.
- **`fonteDados` sugerido**: `"TACO 4ª edição, NEPA/UNICAMP, 2011"`.

### Tratamento de valores especiais na importação

| Código na TACO | Significado | Mapeamento |
|---|---|---|
| `NA` | Não analisado / não se aplica | `null` |
| `*` | Dado não disponível | `null` |
| `Tr` | Traço (abaixo do limite de quantificação) | `0` |

**Regra de segurança obrigatória**: o job de regra nutricional (`RestricaoRegraNutricional`) nunca deve tratar um campo `null` como "abaixo do limiar" (passou no teste). Comparações tipo `sodioMg > 400` avaliam `null` como falso em SQL, o que marcaria silenciosamente um ingrediente sem dado como seguro. Lógica correta, três saídas:
1. Valor conhecido e acima do limiar → vincula automaticamente (`origem = automatico_regra_nutricional`)
2. Valor conhecido e abaixo do limiar → não vincula
3. Valor `null` → não vincula automaticamente, mas também não é tratado como seguro — precisa de revisão manual

## Limiares de doença crônica

- **Hipertensão (sódio)**: **fechado**, `600 mg / 100g`, referência RDC nº 429/2020 da ANVISA (limiar de "alto teor" em rotulagem nutricional frontal).
- **Diabetes (carboidrato)**: **em aberto**. Métrica cogitada foi carboidrato líquido (`carboidratosG - fibrasG`), mas não tem referência regulatória brasileira equivalente à do sódio (a RDC 429/2020 regula açúcar *adicionado*, não carboidrato total/líquido). Decisão do valor e da métrica exata fica para nutricionista/diretriz clínica (ex: Sociedade Brasileira de Diabetes) antes de preencher `valorLimite`.
- **Renal / gota**: fora de escopo. Faltam campos nutricionais em `Ingrediente` (potássio, fósforo, purinas).

## Próximos passos (implementação)

1. Rodar a migration do schema atualizado: `npx prisma migrate dev --name add_origem_e_regra_nutricional`.
2. Escrever o script de bootstrap (fora da API, roda uma vez):
   - Parser da TACO 4ª edição (PDF → estrutura intermediária, com junção das duas metades da Tabela 1 e tratamento de `NA`/`Tr`/`*`).
   - Import idempotente `Ingrediente` via Prisma.
   - Matching por palavra-chave (alergia/intolerância) → gera lista de candidatos pra revisão manual (fora do banco).
   - Aplicação da regra de sódio (hipertensão) sobre a base importada, respeitando a regra de três saídas acima.
   - Inserção final em `IngredienteRestricao` com `origem` correta.
3. Implementar o módulo `ingrediente-restricao` (`dtos/`, `service`, `controller`, `module`, registro em `app.module.ts`) com os 3 endpoints do CRUD individual, `AuthGuard` só em write.
4. Preencher `valorLimite` de diabetes em `RestricaoRegraNutricional` assim que houver validação clínica.

## Fora de escopo desta frente (sem mudança)

`findReplacementFor`/`findFeedbacks` em `receita.service.ts`, limpeza de imports mortos em `paciente-restricao.module.ts`, testes automatizados, migration do `CHECK` de exclusive-arc em `Telefone`/`Endereco`.
