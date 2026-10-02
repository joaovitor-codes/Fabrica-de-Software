/// <reference types="jest" />

import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RestricaoRegraNutricionalService } from './restricao-regra-nutricional.service';
import { RegraNutricionalService } from '../ingrediente-restricao/regra-nutricional.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

describe('RestricaoRegraNutricionalService - reavaliação dos vínculos', () => {
  const restricaoId = 'hipertensao';
  let prisma: any;
  let reavaliarRestricao: jest.Mock;
  let service: RestricaoRegraNutricionalService;

  beforeEach(() => {
    prisma = {
      restricaoAlimentar: {
        findUnique: jest.fn().mockResolvedValue({ id: restricaoId }),
      },
      restricaoRegraNutricional: {
        create: jest.fn().mockResolvedValue({ id: 'r1', restricaoId }),
        update: jest.fn().mockResolvedValue({ id: 'r1', restricaoId }),
        delete: jest.fn().mockResolvedValue({ id: 'r1', restricaoId }),
      },
    };
    reavaliarRestricao = jest.fn().mockResolvedValue(undefined);
    service = new RestricaoRegraNutricionalService(
      prisma as PrismaService,
      { reavaliarRestricao } as unknown as RegraNutricionalService,
    );
  });

  it('reavalia a restrição ao criar uma regra', async () => {
    await service.criarRegra(restricaoId, {
      campoNutricional: 'sodio_mg',
      operador: 'maior_que',
      valorLimite: 600,
    });

    expect(reavaliarRestricao).toHaveBeenCalledWith(restricaoId);
  });

  it('reavalia a restrição ao alterar uma regra, inclusive limpando o limite', async () => {
    await service.updateRegra(restricaoId, 'r1', { valorLimite: undefined });

    expect(reavaliarRestricao).toHaveBeenCalledWith(restricaoId);
  });

  it('reavalia a restrição ao remover uma regra', async () => {
    await service.delete(restricaoId, 'r1');

    expect(reavaliarRestricao).toHaveBeenCalledWith(restricaoId);
  });

  it('não reavalia quando a regra a remover não existe', async () => {
    prisma.restricaoRegraNutricional.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('P2025', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(service.delete(restricaoId, 'r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reavaliarRestricao).not.toHaveBeenCalled();
  });
});
