// scripts/import-taco.ts
//
// Import idempotente de data/processed/taco/taco_composicao.csv
// (fonte: https://github.com/brolesi/taco, TACO 4a edicao, NEPA/UNICAMP 2011)
// para o model Ingrediente.
//
// Uso:
//   npx ts-node scripts/import-taco.ts caminho/para/taco_composicao.csv
//
// Dependencia extra necessaria (se ainda nao tiver no projeto):
//   npm install csv-parse
//
// Pre-requisito: o campo `codigoFonteExterno` precisa existir em Ingrediente
// (String? @unique) e a migration correspondente ja aplicada. Sem isso o
// upsert abaixo nao tem uma chave estavel pra rodar de novo sem duplicar.

import { PrismaClient, Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();

const FONTE_DADOS = 'TACO 4a edicao, NEPA/UNICAMP, 2011 (via github.com/brolesi/taco)';

// Valor usado pelo pipeline de origem para representar "Tr" (traco).
// Decisao registrada na discussao: traco vira 0, nao fica distinto de zero
// real. Se um dia quiser preservar a distincao, mude o retorno de
// parseNutriente para null ou para um marcador proprio em vez de 0.
const MARCADOR_TRACO = 0.00001;
const EPSILON = 1e-9;

interface LinhaTaco {
  numero_alimento: string;
  descricao: string;
  energia_kcal: string;
  proteina_g: string;
  carboidrato_g: string;
  lipideos_g: string;
  fibra_g: string;
  sodio_mg: string;
}

interface ResumoImportacao {
  total: number;
  importados: number;
  linhasVazias: number;
  camposNulos: Record<string, number>;
}

/**
 * Converte um valor de celula do CSV em Decimal-compativel (number) ou null.
 *
 * Regras (definidas na discussao de arquitetura):
 * - celula vazia (NaN/nao analisado)          -> null
 * - "Tr" do pipeline, representado como 1e-05 -> 0
 * - qualquer outro numero                     -> o proprio numero
 */
function parseNutriente(valor: string): number | null {
  if (valor === undefined || valor === null || valor.trim() === '') {
    return null;
  }
  const num = Number(valor);
  if (Number.isNaN(num)) {
    return null;
  }
  if (Math.abs(num - MARCADOR_TRACO) < EPSILON) {
    return 0;
  }
  return num;
}

function main(): void {
  const caminhoCsv = process.argv[2];
  if (!caminhoCsv) {
    console.error('Uso: npx ts-node scripts/import-taco.ts caminho/para/taco_composicao.csv');
    process.exit(1);
  }

  const conteudo = readFileSync(caminhoCsv, 'utf-8');
  const linhas: LinhaTaco[] = parse(conteudo, {
    columns: true,
    skip_empty_lines: true,
    bom: true, // remove BOM do inicio do arquivo, se houver (comum em CSV
               // exportado por Excel/Windows) - sem isso, a primeira coluna
               // do cabecalho vira "\uFEFFnumero_alimento" e numero_alimento
               // fica undefined em toda linha
    trim: true,
  });

  importar(linhas)
    .then((resumo) => {
      console.log('\n--- resumo da importacao ---');
      console.log(`total de linhas lidas:     ${resumo.total}`);
      console.log(`ingredientes importados:   ${resumo.importados}`);
      console.log(`linhas totalmente vazias:  ${resumo.linhasVazias} (importadas com todos os campos nutricionais null)`);
      console.log('campos ausentes (null) por nutriente:');
      for (const [campo, qtd] of Object.entries(resumo.camposNulos)) {
        console.log(`  ${campo}: ${qtd} de ${resumo.total} (${((qtd / resumo.total) * 100).toFixed(1)}%)`);
      }
    })
    .catch((erro) => {
      console.error('Falha na importacao:', erro);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

async function importar(linhas: LinhaTaco[]): Promise<ResumoImportacao> {
  const resumo: ResumoImportacao = {
    total: linhas.length,
    importados: 0,
    linhasVazias: 0,
    camposNulos: {
      caloriasKcal: 0,
      proteinasG: 0,
      carboidratosG: 0,
      gordurasG: 0,
      fibrasG: 0,
      sodioMg: 0,
    },
  };

  for (const [indice, linha] of linhas.entries()) {
    if (!linha.numero_alimento || linha.numero_alimento.trim() === '') {
      throw new Error(
        `linha ${indice + 2} do CSV nao tem numero_alimento valido. ` +
        `Colunas lidas: ${Object.keys(linha).join(', ')}. ` +
        `Se "numero_alimento" nao aparecer na lista acima (ou aparecer com ` +
        `caracteres estranhos antes), o cabecalho do CSV provavelmente tem ` +
        `um problema de encoding/BOM diferente do esperado.`
      );
    }

    const caloriasKcal = parseNutriente(linha.energia_kcal);
    const proteinasG = parseNutriente(linha.proteina_g);
    const carboidratosG = parseNutriente(linha.carboidrato_g);
    const gordurasG = parseNutriente(linha.lipideos_g);
    const fibrasG = parseNutriente(linha.fibra_g);
    const sodioMg = parseNutriente(linha.sodio_mg);

    const todosNulos = [caloriasKcal, proteinasG, carboidratosG, gordurasG, fibrasG, sodioMg]
      .every((v) => v === null);
    if (todosNulos) {
      resumo.linhasVazias += 1;
      console.warn(`aviso: "${linha.descricao}" (numero ${linha.numero_alimento}) nao tem nenhum dado nutricional. Importando mesmo assim, com tudo null.`);
    }

    for (const [campo, valor] of Object.entries({
      caloriasKcal,
      proteinasG,
      carboidratosG,
      gordurasG,
      fibrasG,
      sodioMg,
    })) {
      if (valor === null) {
        resumo.camposNulos[campo] += 1;
      }
    }

    const codigoFonteExterno = `TACO-4-${linha.numero_alimento}`;

    const dados: Prisma.IngredienteUpsertArgs['create'] = {
      codigoFonteExterno,
      nome: linha.descricao,
      fonteDados: FONTE_DADOS,
      caloriasKcal,
      proteinasG,
      carboidratosG,
      gordurasG,
      fibrasG,
      sodioMg,
    };

    await prisma.ingrediente.upsert({
      where: { codigoFonteExterno },
      create: dados,
      update: dados,
    });

    resumo.importados += 1;
  }

  return resumo;
}

main();
