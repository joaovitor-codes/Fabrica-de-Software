// scripts/regras-nutricionais.ts
//
// Garante as restrições com regra nutricional da lista padrão
// (REGRAS_PADRAO em src/modules/nutricao/restricao-alimentar/regras-padrao.ts)
// e reavalia todas as regras do banco sobre os ingredientes.
//
//   npx ts-node scripts/regras-nutricionais.ts [--simular]
//
// - Cria a restrição e a regra que faltarem. Nunca altera o que existe: um
//   limite diferente no banco vira aviso.
// - Sempre reavalia todas as regras, inclusive as que já existiam. Por isso
//   roda depois do import-taco.ts: o import grava os ingredientes direto no
//   banco, sem passar pela regra nutricional.
// - Pode rodar de novo sem duplicar nada.
//
// Faz parte do `npm run db:preparar`.

import 'dotenv/config';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RegraNutricionalService } from '../src/modules/nutricao/ingrediente-restricao/regra-nutricional.service';
import { normalizar } from '../src/modules/nutricao/ingrediente-restricao/curadoria-alergenos';
import { planejarRegras } from '../src/modules/nutricao/restricao-alimentar/regras-padrao';

const prisma = new PrismaService();
const regraNutricional = new RegraNutricionalService(prisma);

async function main() {
  const simular = process.argv.includes('--simular');

  const doBanco = await prisma.restricaoAlimentar.findMany({
    include: { regrasNutricionais: true },
  });
  const plano = planejarRegras(
    doBanco.map((r) => ({
      nome: r.nome,
      tipo: r.tipo,
      regras: r.regrasNutricionais.map((regra) => ({
        campoNutricional: regra.campoNutricional,
        operador: regra.operador,
        valorLimite: regra.valorLimite?.toNumber() ?? null,
      })),
    })),
  );

  plano.avisos.forEach((a) => console.warn(`aviso: ${a}`));
  console.log(
    `restrições a criar: ${plano.restricoesACriar.map((r) => r.nome).join(', ') || 'nenhuma'}`,
  );
  console.log(
    `regras a criar em restrições existentes: ${plano.regrasACriar.length}`,
  );

  if (simular) {
    console.log('--simular: nada foi gravado.');
    return;
  }

  const idPorNome = new Map(doBanco.map((r) => [normalizar(r.nome), r.id]));

  for (const restricao of plano.restricoesACriar) {
    const criada = await prisma.restricaoAlimentar.create({
      data: {
        nome: restricao.nome,
        tipo: restricao.tipo,
        descricao: restricao.descricao,
        regrasNutricionais: {
          create: restricao.regras.map((regra) => ({
            campoNutricional: regra.campo,
            operador: regra.operador,
            valorLimite: regra.limite,
          })),
        },
      },
    });
    idPorNome.set(normalizar(criada.nome), criada.id);
  }

  for (const { restricao, regra } of plano.regrasACriar) {
    await prisma.restricaoRegraNutricional.create({
      data: {
        restricaoId: idPorNome.get(normalizar(restricao))!,
        campoNutricional: regra.campo,
        operador: regra.operador,
        valorLimite: regra.limite,
      },
    });
  }

  // Todas as restrições com regra, não só as da lista padrão: cobre
  // ingredientes importados depois que as regras foram criadas.
  const comRegra = await prisma.restricaoAlimentar.findMany({
    where: { regrasNutricionais: { some: { valorLimite: { not: null } } } },
    select: { id: true, nome: true },
  });
  for (const restricao of comRegra) {
    await regraNutricional.reavaliarRestricao(restricao.id);
    const vinculos = await prisma.ingredienteRestricao.count({
      where: {
        restricaoId: restricao.id,
        origem: 'automatico_regra_nutricional',
      },
    });
    console.log(
      `${restricao.nome}: ${vinculos} ingredientes vinculados pela regra`,
    );
  }
}

main()
  .catch((erro) => {
    console.error('Falha nas regras nutricionais:', erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
