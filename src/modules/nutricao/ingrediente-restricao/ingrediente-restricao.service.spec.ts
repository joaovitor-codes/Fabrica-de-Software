/// <reference types="jest" />

import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IngredienteRestricaoService } from './ingrediente-restricao.service';
import { FONTE_ESTIMATIVA_IA } from './ingrediente-substituto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

describe('IngredienteRestricaoService.marcarRevisado', () => {
  const ingredienteId = 'i1';
  let update: jest.Mock;
  let service: IngredienteRestricaoService;

  beforeEach(() => {
    update = jest.fn();
    service = new IngredienteRestricaoService({
      ingrediente: { update },
    } as unknown as PrismaService);
  });

  it('marca a data de revisão e não devolve a fonte dos dados', async () => {
    update.mockImplementation(async ({ data }: any) => ({
      id: ingredienteId,
      nome: 'Sal, grosso',
      restricoesRevisadasEm: data.restricoesRevisadasEm,
      fonteDados: 'TACO 4a edicao',
    }));

    const resultado = await service.marcarRevisado(ingredienteId);

    expect(resultado.restricoesRevisadasEm).toBeInstanceOf(Date);
    expect(resultado).not.toHaveProperty('fonteDados');
    expect(resultado).not.toHaveProperty('aviso');
  });

  it('avisa quando os nutrientes são estimativa da IA', async () => {
    update.mockResolvedValue({
      id: ingredienteId,
      nome: 'Creme vegetal de castanha',
      restricoesRevisadasEm: new Date(),
      fonteDados: FONTE_ESTIMATIVA_IA,
    });

    const resultado = await service.marcarRevisado(ingredienteId);

    expect(resultado).toHaveProperty('aviso');
    expect((resultado as { aviso: string }).aviso).toContain('estimativas');
  });

  it('ingrediente inexistente responde 404', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('P2025', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(service.marcarRevisado(ingredienteId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
