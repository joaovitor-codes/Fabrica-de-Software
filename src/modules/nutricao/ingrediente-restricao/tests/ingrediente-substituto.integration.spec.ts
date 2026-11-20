/// <reference types="jest" />

import 'dotenv/config';
import { BadGatewayException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CampoNutricionalRegra,
  OperadorRegraNutricional,
  TipoRestricao,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { IaService } from '../../../ia/ia.service';
import {
  FONTE_ESTIMATIVA_IA,
  IngredienteSubstitutoService,
} from '../ingrediente-substituto.service';
import { RegraNutricionalService } from '../regra-nutricional.service';

/**
 * Geração de substitutos pela IA contra o Postgres de verdade, com o
 * IaService dublado: reaproveitamento pelo nome, descarte de opção
 * inválida sem gravar nada e chamadas simultâneas.
 */
describe('IngredienteSubstitutoService.gerarSubstituto (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  const nome = (texto: string) => `${texto} ${sufixo}`;
  let prisma: PrismaService;
  let service: IngredienteSubstitutoService;
  const encontrarSubstituto = jest.fn();
  let restricaoId: string;

  const opcao = (nomeOpcao: string, extra: Record<string, unknown> = {}) => ({
    nome: nomeOpcao,
    justificativa: 'Mesma função',
    caloriasKcal: '45',
    proteinasG: '1',
    carboidratosG: '7.5',
    gordurasG: '1.5',
    fibrasG: '0.8',
    sodioMg: '40',
    ...extra,
  });

  async function ingrediente(nomeIngrediente: string) {
    return prisma.ingrediente.create({ data: { nome: nomeIngrediente } });
  }

  const ingredientesDoTeste = () =>
    prisma.ingrediente.findMany({
      where: { nome: { contains: sufixo } },
      orderBy: { nome: 'asc' },
    });

  const vinculosDe = (origemId: string) =>
    prisma.ingredienteSubstituto.findMany({
      where: { ingredienteOrigemId: origemId, restricaoId },
      include: { ingredienteDestino: true },
      orderBy: { prioridade: 'asc' },
    });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const restricao = await prisma.restricaoAlimentar.create({
      data: {
        nome: nome('Restrição teste'),
        tipo: TipoRestricao.doenca_cronica,
      },
    });
    restricaoId = restricao.id;
    await prisma.restricaoRegraNutricional.create({
      data: {
        restricaoId,
        campoNutricional: CampoNutricionalRegra.sodio_mg,
        operador: OperadorRegraNutricional.maior_que,
        valorLimite: 600,
      },
    });
    service = new IngredienteSubstitutoService(
      prisma,
      new RegraNutricionalService(prisma),
      { encontrarSubstituto } as unknown as IaService,
    );
  });

  beforeEach(() => {
    encontrarSubstituto.mockReset();
  });

  afterAll(async () => {
    const ids = (await ingredientesDoTeste()).map((i) => i.id);
    await prisma.ingredienteSubstituto.deleteMany({
      where: {
        OR: [
          { ingredienteOrigemId: { in: ids } },
          { ingredienteDestinoId: { in: ids } },
          { restricaoId },
        ],
      },
    });
    await prisma.ingredienteRestricao.deleteMany({
      where: { OR: [{ ingredienteId: { in: ids } }, { restricaoId }] },
    });
    await prisma.ingrediente.deleteMany({ where: { id: { in: ids } } });
    await prisma.restricaoRegraNutricional.deleteMany({
      where: { restricaoId },
    });
    await prisma.restricaoAlimentar.delete({ where: { id: restricaoId } });
    await prisma.$disconnect();
  });

  it('cria as opções como estimativa da IA, na ordem sugerida', async () => {
    const origem = await ingrediente(nome('Leite A'));
    encontrarSubstituto.mockResolvedValue({
      opcoes: [
        opcao(nome('Bebida de aveia A')),
        opcao(nome('Bebida de soja A')),
        opcao(nome('Bebida de arroz A')),
      ],
    });

    const vinculos = await service.gerarSubstituto(origem.id, restricaoId);

    expect(vinculos).toHaveLength(3);
    const gravados = await vinculosDe(origem.id);
    expect(
      gravados.map((v) => [v.prioridade, v.ingredienteDestino.nome]),
    ).toEqual([
      [0, nome('Bebida de aveia A')],
      [1, nome('Bebida de soja A')],
      [2, nome('Bebida de arroz A')],
    ]);
    for (const v of gravados) {
      expect(v.ingredienteDestino.fonteDados).toBe(FONTE_ESTIMATIVA_IA);
      expect(v.ingredienteDestino.restricoesRevisadasEm).toBeNull();
      expect(v.observacao).toBe('Mesma função');
    }
  });

  it('sugestão com nome do catálogo (acento, caixa, espaço) reaproveita o existente', async () => {
    const existente = await ingrediente(nome('Bebida de  Avéia B'));
    const origem = await ingrediente(nome('Leite B'));
    encontrarSubstituto.mockResolvedValue({
      opcoes: [
        opcao(nome('bebida de aveia b')),
        opcao(nome('Bebida de coco B')),
      ],
    });

    await service.gerarSubstituto(origem.id, restricaoId);

    const gravados = await vinculosDe(origem.id);
    expect(gravados[0].ingredienteDestinoId).toBe(existente.id);
    expect(gravados[0].ingredienteDestino.fonteDados).toBeNull();
    const copias = (await ingredientesDoTeste()).filter((i) =>
      /aveia b/i.test(i.nome.normalize('NFD').replace(/[̀-ͯ]/g, '')),
    );
    expect(copias).toHaveLength(1);
  });

  it.each([
    ['fora do formato', { resposta: 'não é JSON de opções' }],
    [
      'sem opção válida',
      { opcoes: [{ nome: '' }, { nome: 'x', caloriasKcal: '-1' }] },
    ],
  ])('resposta %s: 502 e nada gravado', async (_, resposta) => {
    const origem = await ingrediente(nome(`Leite C ${_}`));
    const antes = (await ingredientesDoTeste()).length;
    encontrarSubstituto.mockResolvedValue(resposta);

    await expect(
      service.gerarSubstituto(origem.id, restricaoId),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(await vinculosDe(origem.id)).toEqual([]);
    expect((await ingredientesDoTeste()).length).toBe(antes);
  });

  it('descarta o original, valores fora da faixa e o que fere a regra da restrição', async () => {
    const origem = await ingrediente(nome('Leite D'));
    encontrarSubstituto.mockResolvedValue({
      opcoes: [
        opcao(nome('LEITE D')),
        opcao(nome('Caldo D'), { sodioMg: '800' }),
        opcao(nome('Óleo D'), { caloriasKcal: '1200' }),
        opcao(nome('Bebida de aveia D')),
      ],
    });

    await service.gerarSubstituto(origem.id, restricaoId);

    const gravados = await vinculosDe(origem.id);
    expect(gravados.map((v) => v.ingredienteDestino.nome)).toEqual([
      nome('Bebida de aveia D'),
    ]);
    const nomes = (await ingredientesDoTeste()).map((i) => i.nome);
    expect(nomes).not.toContain(nome('Caldo D'));
    expect(nomes).not.toContain(nome('Óleo D'));
  });

  it('não reaproveita ingrediente do catálogo que fere a restrição; sem outra opção, desfaz tudo', async () => {
    const proibido = await ingrediente(nome('Queijo E'));
    await prisma.ingredienteRestricao.create({
      data: { ingredienteId: proibido.id, restricaoId },
    });
    const origem = await ingrediente(nome('Leite E'));
    encontrarSubstituto.mockResolvedValue({
      opcoes: [opcao(nome('queijo e'))],
    });

    await expect(
      service.gerarSubstituto(origem.id, restricaoId),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(await vinculosDe(origem.id)).toEqual([]);

    encontrarSubstituto.mockResolvedValue({
      opcoes: [opcao(nome('queijo e')), opcao(nome('Tofu E'))],
    });
    await service.gerarSubstituto(origem.id, restricaoId);
    const gravados = await vinculosDe(origem.id);
    expect(gravados.map((v) => v.ingredienteDestino.nome)).toEqual([
      nome('Tofu E'),
    ]);
  });

  it('com substitutos já cadastrados, 409 sem chamar a IA', async () => {
    const origem = await ingrediente(nome('Leite F'));
    encontrarSubstituto.mockResolvedValue({ opcoes: [opcao(nome('Tofu F'))] });
    await service.gerarSubstituto(origem.id, restricaoId);
    encontrarSubstituto.mockClear();

    await expect(
      service.gerarSubstituto(origem.id, restricaoId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(encontrarSubstituto).not.toHaveBeenCalled();
  });

  it('duas gerações simultâneas do mesmo par: uma grava, a outra 409', async () => {
    for (let rodada = 0; rodada < 10; rodada++) {
      const origem = await ingrediente(nome(`Leite G${rodada}`));
      encontrarSubstituto.mockImplementation(async () => {
        await new Promise((ok) => setTimeout(ok, 5 * Math.random()));
        return {
          opcoes: [
            opcao(nome(`Bebida de aveia G${rodada}`)),
            opcao(nome(`Bebida de soja G${rodada}`)),
          ],
        };
      });

      const resultados = await Promise.allSettled([
        service.gerarSubstituto(origem.id, restricaoId),
        service.gerarSubstituto(origem.id, restricaoId),
      ]);

      const ok = resultados.filter((r) => r.status === 'fulfilled');
      const falhas = resultados.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(ok).toHaveLength(1);
      expect(falhas[0].reason).toBeInstanceOf(ConflictException);
      expect(await vinculosDe(origem.id)).toHaveLength(2);
      const criados = (await ingredientesDoTeste()).filter(
        (i) =>
          i.nome.endsWith(`G${rodada} ${sufixo}`) &&
          i.nome.startsWith('Bebida'),
      );
      expect(criados).toHaveLength(2);
    }
  });

  it('origens diferentes sugerindo o mesmo nome ao mesmo tempo criam um ingrediente só', async () => {
    for (let rodada = 0; rodada < 10; rodada++) {
      const [leite, creme] = await Promise.all([
        ingrediente(nome(`Leite H${rodada}`)),
        ingrediente(nome(`Creme H${rodada}`)),
      ]);
      encontrarSubstituto.mockImplementation(async () => {
        await new Promise((ok) => setTimeout(ok, 5 * Math.random()));
        return { opcoes: [opcao(nome(`Bebida de coco H${rodada}`))] };
      });

      await Promise.all([
        service.gerarSubstituto(leite.id, restricaoId),
        service.gerarSubstituto(creme.id, restricaoId),
      ]);

      const copias = (await ingredientesDoTeste()).filter(
        (i) => i.nome === nome(`Bebida de coco H${rodada}`),
      );
      expect(copias).toHaveLength(1);
      const [a, b] = await Promise.all([
        vinculosDe(leite.id),
        vinculosDe(creme.id),
      ]);
      expect(a[0].ingredienteDestinoId).toBe(copias[0].id);
      expect(b[0].ingredienteDestinoId).toBe(copias[0].id);
    }
  });

  describe('candidatos do catálogo', () => {
    /** Revisado depois da restrição e com o dado da regra (sódio): é candidato. */
    async function revisado(nomeIngrediente: string) {
      return prisma.ingrediente.create({
        data: {
          nome: nomeIngrediente,
          sodioMg: 10,
          restricoesRevisadasEm: new Date(),
        },
      });
    }

    const candidatosEnviados = (): string[] =>
      encontrarSubstituto.mock.calls[0][2];

    it('manda só os seguros: revisados, com o dado da regra, sem vínculo e sem o original', async () => {
      const seguro = await revisado(nome('Tofu I'));
      const vinculado = await revisado(nome('Queijo I'));
      await prisma.ingredienteRestricao.create({
        data: { ingredienteId: vinculado.id, restricaoId },
      });
      await ingrediente(nome('Não revisado I'));
      await prisma.ingrediente.create({
        data: { nome: nome('Sem sódio I'), restricoesRevisadasEm: new Date() },
      });
      const origem = await revisado(nome('Leite I'));
      encontrarSubstituto.mockResolvedValue({ opcoes: [{ c: 0 }] });

      await service.gerarSubstituto(origem.id, restricaoId);

      const doTeste = candidatosEnviados().filter((n) => n.includes(sufixo));
      expect(doTeste).toContain(seguro.nome);
      expect(doTeste).not.toContain(vinculado.nome);
      expect(doTeste).not.toContain(nome('Não revisado I'));
      expect(doTeste).not.toContain(nome('Sem sódio I'));
      expect(doTeste).not.toContain(origem.nome);
    });

    it('escolha pelo índice vincula o ingrediente do catálogo, sem criar nada', async () => {
      const tofu = await revisado(nome('Tofu J'));
      const origem = await ingrediente(nome('Leite J'));
      encontrarSubstituto.mockImplementation(async (_n, _r, candidatos) => ({
        opcoes: [
          { c: candidatos.indexOf(tofu.nome), justificativa: 'Textura' },
          opcao(nome('Bebida de aveia J')),
        ],
      }));
      const antes = (await ingredientesDoTeste()).length;

      await service.gerarSubstituto(origem.id, restricaoId);

      const gravados = await vinculosDe(origem.id);
      expect(
        gravados.map((v) => [v.ingredienteDestinoId, v.observacao]),
      ).toEqual([
        [tofu.id, 'Textura'],
        [expect.any(String), 'Mesma função'],
      ]);
      // Só a nova foi criada.
      expect((await ingredientesDoTeste()).length).toBe(antes + 1);
    });

    it('nova com o nome de um candidato já escolhido não duplica o vínculo', async () => {
      const tofu = await revisado(nome('Tofu K'));
      const origem = await ingrediente(nome('Leite K'));
      encontrarSubstituto.mockImplementation(async (_n, _r, candidatos) => ({
        opcoes: [
          { c: candidatos.indexOf(tofu.nome) },
          opcao(nome('TOFU K')),
          opcao(nome('Bebida de soja K')),
        ],
      }));

      await service.gerarSubstituto(origem.id, restricaoId);

      const gravados = await vinculosDe(origem.id);
      expect(gravados.map((v) => v.ingredienteDestino.nome)).toEqual([
        tofu.nome,
        nome('Bebida de soja K'),
      ]);
    });

    it('candidato que ganhou vínculo com a restrição depois da consulta é descartado', async () => {
      const tofu = await revisado(nome('Tofu L'));
      const origem = await ingrediente(nome('Leite L'));
      encontrarSubstituto.mockImplementation(async (_n, _r, candidatos) => {
        // Um curador marca o tofu enquanto a IA responde.
        await prisma.ingredienteRestricao.create({
          data: { ingredienteId: tofu.id, restricaoId },
        });
        return { opcoes: [{ c: candidatos.indexOf(tofu.nome) }] };
      });

      await expect(
        service.gerarSubstituto(origem.id, restricaoId),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(await vinculosDe(origem.id)).toEqual([]);
    });
  });
});
