// scripts/curadoria-alergenos.ts
//
// Curadoria das restrições dos ingredientes (Fase 0 de
// regra_negocio_receitas_seguras.md). Roda em dois passos, com revisão humana
// no meio:
//
//   1. gerar: cruza palavra-chave + IA e escreve um CSV de candidatos.
//        npx ts-node scripts/curadoria-alergenos.ts gerar [saida.csv] [--sem-ia] [--todos]
//      --sem-ia  só palavra-chave (não precisa de OPENAI_API_KEY)
//      --todos   inclui ingredientes já revisados (padrão: só os não revisados)
//
//   2. o curador revisa a coluna `decisao` do CSV:
//        vincular   o ingrediente fere a restrição (padrão de toda candidata)
//        descartar  falso positivo
//        pendente   não sabe ainda: o ingrediente NÃO é marcado como revisado
//        revisado   linha sem restrição: ingrediente analisado, nada a vincular
//      Para uma restrição que ficou de fora, adicione uma linha com o mesmo
//      ingrediente_id, a restrição e `vincular`.
//
//   3. aplicar: grava os vínculos e marca os ingredientes como revisados.
//        npx ts-node scripts/curadoria-alergenos.ts aplicar revisado.csv [--simular]
//      --simular  valida e mostra o resumo sem gravar nada
//
// A IA nunca grava vínculo direto: tudo passa pelo CSV revisado.

import 'dotenv/config';
import { PrismaClient, RestricaoAlimentar } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { parse } from 'csv-parse/sync';
import { readFileSync, writeFileSync } from 'fs';
import { IaService } from '../src/modules/ia/ia.service';
import {
  ClassificacaoIa,
  LinhaCuradoria,
  RESTRICOES_CURADORIA,
  encontrarPorPalavraChave,
  gerarCsv,
  interpretarClassificacaoIa,
  montarLinhas,
  normalizar,
  planejarAplicacao,
} from '../src/modules/nutricao/ingrediente-restricao/curadoria-alergenos';

const prisma = new PrismaClient();

const TAMANHO_LOTE_IA = 40;
// Falhas seguidas (ex: chave inválida) antes de desistir da IA no resto.
const MAX_FALHAS_SEGUIDAS_IA = 2;
const SAIDA_PADRAO = 'curadoria-alergenos.csv';

const USO = `Uso:
  npx ts-node scripts/curadoria-alergenos.ts gerar [saida.csv] [--sem-ia] [--todos]
  npx ts-node scripts/curadoria-alergenos.ts aplicar revisado.csv [--simular]`;

async function gerar(saida: string, usarIa: boolean, todos: boolean) {
  const ingredientes = await prisma.ingrediente.findMany({
    where: todos ? {} : { restricoesRevisadasEm: null },
    select: { id: true, nome: true },
    orderBy: { nome: 'asc' },
  });
  console.log(`ingredientes a analisar: ${ingredientes.length}`);

  let ia = usarIa ? new IaService(new ConfigService()) : undefined;
  let falhasSeguidas = 0;
  const criterios = RESTRICOES_CURADORIA.map(({ nome, criterio }) => ({
    nome,
    criterio,
  }));

  const linhas: LinhaCuradoria[] = [];
  let semRespostaIa = 0;

  for (
    let inicio = 0;
    inicio < ingredientes.length;
    inicio += TAMANHO_LOTE_IA
  ) {
    const lote = ingredientes.slice(inicio, inicio + TAMANHO_LOTE_IA);

    let classificacao = new Map<number, ClassificacaoIa>();
    if (ia) {
      process.stdout.write(
        `IA: ingredientes ${inicio + 1}-${inicio + lote.length}... `,
      );
      try {
        const resposta = await ia.classificarRestricoes(
          lote.map((i) => i.nome),
          criterios,
        );
        classificacao = interpretarClassificacaoIa(resposta, lote.length);
        console.log(`${classificacao.size}/${lote.length} respondidos`);
        falhasSeguidas = 0;
      } catch (erro) {
        // Lote sem resposta não trava a curadoria: os ingredientes saem como
        // `pendente` no CSV.
        console.log(`falhou (${(erro as Error).message})`);
        falhasSeguidas += 1;
        if (falhasSeguidas >= MAX_FALHAS_SEGUIDAS_IA) {
          console.log(
            `IA desativada após ${falhasSeguidas} falhas seguidas; o resto sai só com palavra-chave.`,
          );
          ia = undefined;
        }
      }
    }

    lote.forEach((ingrediente, i) => {
      const respostaIa = classificacao.get(i);
      if (!respostaIa) semRespostaIa += 1;
      linhas.push(
        ...montarLinhas(
          ingrediente,
          encontrarPorPalavraChave(ingrediente.nome),
          respostaIa,
        ),
      );
    });
  }

  writeFileSync(saida, gerarCsv(linhas), 'utf-8');

  const contar = (filtro: (l: LinhaCuradoria) => boolean) =>
    linhas.filter(filtro).length;
  console.log('\n--- resumo ---');
  console.log(`arquivo:                  ${saida}`);
  console.log(`linhas:                   ${linhas.length}`);
  console.log(
    `vínculos candidatos:      ${contar((l) => l.decisao === 'vincular')}`,
  );
  console.log(
    `  pedem atenção:          ${contar((l) => l.decisao === 'vincular' && l.atencao === 'sim')}`,
  );
  console.log(
    `sem restrição (revisado): ${contar((l) => l.decisao === 'revisado')}`,
  );
  console.log(`ingredientes sem IA:      ${semRespostaIa}`);
  console.log('\nRevise a coluna "decisao" e rode o passo "aplicar".');
}

async function aplicar(caminho: string, simular: boolean) {
  const linhasCsv: Record<string, string>[] = parse(
    readFileSync(caminho, 'utf-8'),
    {
      columns: true,
      bom: true,
      trim: true,
      skip_empty_lines: true,
      // Excel em português salva CSV com ";".
      delimiter: [',', ';'],
    },
  );

  const doBanco = await prisma.restricaoAlimentar.findMany({
    include: { regrasNutricionais: { select: { id: true } } },
  });
  const plano = planejarAplicacao(linhasCsv, [
    ...doBanco.map((r) => r.nome),
    ...RESTRICOES_CURADORIA.map((r) => r.nome),
  ]);

  const ids = [
    ...new Set([
      ...plano.revisados,
      ...plano.pendentes,
      ...plano.vinculos.map((v) => v.ingredienteId),
    ]),
  ];
  const existentes = await prisma.ingrediente.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const idsExistentes = new Set(existentes.map((i) => i.id));
  for (const id of ids) {
    if (!idsExistentes.has(id)) {
      plano.erros.push(`ingrediente ${id} não existe no banco`);
    }
  }

  if (plano.erros.length > 0) {
    console.error('CSV com erros, nada foi gravado:');
    plano.erros.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
    return;
  }

  // Restrição do CSV que ainda não existe no banco é criada com o tipo da
  // config. A que já existe é reaproveitada (comparando sem acento), mesmo
  // com nome escrito diferente.
  const porNome = new Map<string, RestricaoAlimentar>(
    doBanco.map((r) => [normalizar(r.nome), r]),
  );
  const usadas = [...new Set(plano.vinculos.map((v) => v.restricao))];
  const aCriar = RESTRICOES_CURADORIA.filter(
    (r) => usadas.includes(r.nome) && !porNome.has(normalizar(r.nome)),
  );
  for (const r of RESTRICOES_CURADORIA) {
    const existente = porNome.get(normalizar(r.nome));
    if (existente && existente.tipo !== r.tipo) {
      console.warn(
        `aviso: "${existente.nome}" está no banco como ${existente.tipo}; a curadoria esperava ${r.tipo}. Mantido como está.`,
      );
    }
  }

  // A marca de revisado vale para todas as restrições que já existem. Uma
  // restrição do banco fora desta curadoria passaria como conferida.
  const cobertas = new Set(RESTRICOES_CURADORIA.map((r) => normalizar(r.nome)));
  const naoCobertas = doBanco.filter(
    (r) =>
      !cobertas.has(normalizar(r.nome)) && r.regrasNutricionais.length === 0,
  );
  for (const r of naoCobertas) {
    console.warn(
      `aviso: "${r.nome}" não está na curadoria e não tem regra nutricional; os ingredientes marcados como revisados aqui vão contar como seguros para ela.`,
    );
  }

  console.log('--- resumo ---');
  console.log(
    `restrições a criar:             ${aCriar.map((r) => r.nome).join(', ') || 'nenhuma'}`,
  );
  console.log(`vínculos a gravar:              ${plano.vinculos.length}`);
  console.log(`ingredientes marcados revisados: ${plano.revisados.length}`);
  console.log(`ingredientes pendentes:         ${plano.pendentes.length}`);

  if (simular) {
    console.log('\n--simular: nada foi gravado.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const r of aCriar) {
      const criada = await tx.restricaoAlimentar.create({
        data: { nome: r.nome, tipo: r.tipo },
      });
      porNome.set(normalizar(criada.nome), criada);
    }

    // skipDuplicates: vínculo que já existe (inclusive manual) fica como está.
    const { count } = await tx.ingredienteRestricao.createMany({
      data: plano.vinculos.map((v) => ({
        ingredienteId: v.ingredienteId,
        restricaoId: porNome.get(normalizar(v.restricao))!.id,
        origem: 'automatico_confirmado_curadoria',
      })),
      skipDuplicates: true,
    });

    // O filtro só aceita revisão posterior à criação da restrição. A
    // restrição criada acima ganha o horário do banco; se o relógio da
    // máquina estiver atrás, usar `new Date()` deixaria a revisão "antes" dela.
    const revisadoEm = new Date(
      Math.max(
        Date.now(),
        ...[...porNome.values()].map((r) => r.createdAt.getTime()),
      ),
    );
    await tx.ingrediente.updateMany({
      where: { id: { in: plano.revisados } },
      data: { restricoesRevisadasEm: revisadoEm },
    });

    console.log(
      `\ngravado: ${count} vínculos novos (${plano.vinculos.length - count} já existiam).`,
    );
  });
}

async function main() {
  const [comando, ...resto] = process.argv.slice(2);
  const flags = resto.filter((a) => a.startsWith('--'));
  const [arquivo] = resto.filter((a) => !a.startsWith('--'));

  if (comando === 'gerar') {
    await gerar(
      arquivo ?? SAIDA_PADRAO,
      !flags.includes('--sem-ia'),
      flags.includes('--todos'),
    );
  } else if (comando === 'aplicar' && arquivo) {
    await aplicar(arquivo, flags.includes('--simular'));
  } else {
    console.error(USO);
    process.exitCode = 1;
  }
}

main()
  .catch((erro) => {
    console.error('Falha na curadoria:', erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
