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
- **Sem tabela de dicionário de palavras-chave.** É config estática no código (`RESTRICOES_CURADORIA` em `src/modules/nutricao/ingrediente-restricao/curadoria-alergenos.ts`), usada pelo script `scripts/curadoria-alergenos.ts`. Não precisa ser editável em runtime pela aplicação.
- **Sem endpoint de vínculo em lote na API pública.** Só CRUD individual, escrita para `admin` e `profissional`, leitura pública:
  - `POST /api/ingrediente/:ingredienteId/restricoes`
  - `GET /api/ingrediente/:ingredienteId/restricoes`
  - `DELETE /api/ingrediente/:ingredienteId/restricoes/:restricaoId`
  - `PATCH /api/ingrediente/:ingredienteId/restricoes/revisado` (marca o ingrediente como revisado; ver `regra_negocio_receitas_seguras.md`)

Justificativa geral: o objetivo é a aplicação já nascer com a base TACO carregada e curada. A carga inicial é script direto via Prisma, não feature de produto. A API só precisa suportar manutenção incremental (adicionar/corrigir um ingrediente por vez).

## Fonte de dados da TACO

- **Fonte**: TACO 4ª edição, NEPA/UNICAMP (2011), ~597 alimentos. O PDF oficial está em `https://cfn.org.br/wp-content/uploads/2017/03/taco_4_edicao_ampliada_e_revisada.pdf` (mirror do Conselho Federal de Nutricionistas). A importação usa os CSVs já extraídos de `github.com/brolesi/taco` (`scripts/taco_*.csv`) com `scripts/import-taco.ts`, sem parser de PDF.
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
- **Renal**: fora de escopo por enquanto, mas não por falta de dado: `scripts/taco_composicao.csv` tem potássio e fósforo (e colesterol; `taco_acidos_graxos.csv` tem gordura saturada). O `import-taco.ts` só importa seis campos. Para habilitar, importar esses campos, acrescentá-los a `Ingrediente` e ao enum `CampoNutricionalRegra`, e definir os limiares com nutricionista.
- **Gota**: fora de escopo. A TACO não tem purinas.
- **Regra por ingrediente, não por receita**: o limiar é por 100 g do ingrediente. Sal, caldo em tablete e fermento passam do limite de sódio e, para restrição estrita, escondem qualquer receita que os use, mesmo em pouca quantidade. Avaliar por porção da receita exige conversão de unidade para gramas (`UnidadeMedida` não tem) e limiar por porção definido por nutricionista.

## Andamento

Feito:
- Migrations de `origem` e `RestricaoRegraNutricional`.
- Import idempotente da TACO (`scripts/import-taco.ts`), com tratamento de `NA`/`Tr`/`*`.
- Módulo `ingrediente-restricao` com o CRUD individual.
- Regra nutricional com as três saídas acima (`RegraNutricionalService`). Criar, alterar ou remover uma regra reavalia a restrição inteira; sem regra com limiar, os vínculos automáticos dela são apagados.
- Curadoria por palavra-chave + IA com revisão em CSV (`scripts/curadoria-alergenos.ts`; detalhes em `regra_negocio_receitas_seguras.md`, Fase 0).

Pendente:
1. Revisar o CSV da curadoria (nutricionista) e aplicar.
2. Preencher o limite de diabetes assim que houver validação clínica e acrescentá-lo a `REGRAS_PADRAO`.

A regra de hipertensão (`sodio_mg > 600`) está em `REGRAS_PADRAO` (`src/modules/nutricao/restricao-alimentar/regras-padrao.ts`) e é criada em cada banco pelo `npm run db:preparar`.

## Fora de escopo desta frente (sem mudança)

`findFeedbacks` em `receita.service.ts`, limpeza de imports mortos em `paciente-restricao.module.ts`, migration do `CHECK` de exclusive-arc em `Telefone`/`Endereco`.
