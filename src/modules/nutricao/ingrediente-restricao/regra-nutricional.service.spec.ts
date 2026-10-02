/// <reference types="jest" />

import {
  CampoNutricionalRegra,
  OperadorRegraNutricional,
  OrigemVinculoRestricao,
  Prisma,
} from '@prisma/client';
import { RegraNutricionalService } from './regra-nutricional.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

const decimal = (valor: number | null) =>
  valor === null ? null : new Prisma.Decimal(valor);

class FakePrismaService {
  regras: any[] = [];
  ingredientes: any[] = [];
  vinculos: any[] = [];

  restricaoRegraNutricional = {
    findMany: async ({ where }: any) =>
      this.regras.filter(
        (r) => r.restricaoId === where.restricaoId && r.valorLimite !== null,
      ),
  };

  ingrediente = {
    findMany: async () => this.ingredientes,
  };

  ingredienteRestricao = {
    upsert: async ({ where, create }: any) => {
      const { ingredienteId, restricaoId } = where.ingredienteId_restricaoId;
      const existe = this.vinculos.find(
        (v) =>
          v.ingredienteId === ingredienteId && v.restricaoId === restricaoId,
      );
      if (!existe) this.vinculos.push(create);
    },
    deleteMany: async ({ where }: any) => {
      this.vinculos = this.vinculos.filter(
        (v) =>
          !(
            (where.ingredienteId === undefined ||
              v.ingredienteId === where.ingredienteId) &&
            v.restricaoId === where.restricaoId &&
            v.origem === where.origem
          ),
      );
    },
  };
}

describe('RegraNutricionalService.reavaliarRestricao', () => {
  let prisma: FakePrismaService;
  let service: RegraNutricionalService;

  const hipertensao = 'hipertensao';

  const regra = (
    id: string,
    campoNutricional: CampoNutricionalRegra,
    valorLimite: number | null,
  ) => ({
    id,
    restricaoId: hipertensao,
    campoNutricional,
    operador: OperadorRegraNutricional.maior_que,
    valorLimite: decimal(valorLimite),
  });

  const ingrediente = (id: string, sodioMg: number | null, gordurasG = 0) => ({
    id,
    sodioMg: decimal(sodioMg),
    gordurasG: decimal(gordurasG),
  });

  const vinculados = (origem?: OrigemVinculoRestricao) =>
    prisma.vinculos
      .filter((v) => !origem || v.origem === origem)
      .map((v) => v.ingredienteId)
      .sort();

  beforeEach(() => {
    prisma = new FakePrismaService();
    service = new RegraNutricionalService(prisma as unknown as PrismaService);
    prisma.ingredientes = [
      ingrediente('sal', 39943),
      ingrediente('banana', 1),
      ingrediente('sem-dado', null),
      ingrediente('bacon', 100, 40),
    ];
  });

  it('vincula quem passa do limite e não decide nada sem o dado', async () => {
    prisma.regras = [regra('r1', CampoNutricionalRegra.sodio_mg, 600)];

    await service.reavaliarRestricao(hipertensao);

    expect(vinculados()).toEqual(['sal']);
  });

  it('sem nenhuma regra, apaga os vínculos automáticos e mantém os manuais', async () => {
    prisma.vinculos = [
      {
        ingredienteId: 'sal',
        restricaoId: hipertensao,
        origem: OrigemVinculoRestricao.automatico_regra_nutricional,
      },
      {
        ingredienteId: 'banana',
        restricaoId: hipertensao,
        origem: OrigemVinculoRestricao.manual,
      },
    ];
    prisma.regras = [];

    await service.reavaliarRestricao(hipertensao);

    expect(vinculados()).toEqual(['banana']);
  });

  it('regra com limite limpo (null) conta como removida', async () => {
    prisma.regras = [regra('r1', CampoNutricionalRegra.sodio_mg, 600)];
    await service.reavaliarRestricao(hipertensao);
    expect(vinculados()).toEqual(['sal']);

    prisma.regras = [regra('r1', CampoNutricionalRegra.sodio_mg, null)];
    await service.reavaliarRestricao(hipertensao);

    expect(vinculados()).toEqual([]);
  });

  it('removendo uma de duas regras, mantém o que a outra sustenta', async () => {
    prisma.regras = [
      regra('r1', CampoNutricionalRegra.sodio_mg, 600),
      regra('r2', CampoNutricionalRegra.gorduras_g, 30),
    ];
    await service.reavaliarRestricao(hipertensao);
    expect(vinculados()).toEqual(['bacon', 'sal']);

    prisma.regras = [regra('r2', CampoNutricionalRegra.gorduras_g, 30)];
    await service.reavaliarRestricao(hipertensao);

    expect(vinculados()).toEqual(['bacon']);
  });
});
