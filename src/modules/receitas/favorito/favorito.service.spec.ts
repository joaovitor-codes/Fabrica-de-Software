/// <reference types="jest" />

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StatusReceita, TipoMidia, TipoUsuario } from '@prisma/client';
import { FavoritoService } from './favorito.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';

jest.mock('../visibilidade/restricoes-receita', () => ({
  restricoesDoPaciente: async () => [],
}));

describe('FavoritoService.findFavorites', () => {
  const quem = (id: string, tipoUsuario: TipoUsuario) =>
    ({ id, sub: id, tipoUsuario }) as UsuarioAutenticado;
  const leitor = quem('leitor', TipoUsuario.comum);
  const vendedor = quem('vendedor', TipoUsuario.comum);

  const receita = (id: string, oferta: object | null) => ({
    id,
    nome: id,
    descricao: null,
    modoPreparo: 'Modo de preparo completo.',
    tempoPreparoMin: 30,
    porcoes: 4,
    nivelDificuldade: 'facil',
    avisoContaminacaoCruzada: false,
    status: StatusReceita.aprovada,
    criadoPor: vendedor.id,
    ingredientes: [{ ingredienteId: 'farinha', quantidade: 200 }],
    midias: [
      { id: 'capa', tipo: TipoMidia.capa },
      { id: 'video', tipo: TipoMidia.video },
    ],
    oferta,
  });
  const gratuita = receita('gratuita', null);
  const paga = receita('paga', {
    preco: 12.9,
    publicoAlvo: [{ restricao: { id: 'r-lactose', nome: 'Lactose' } }],
  });

  const filtroDoUsuario = { status: StatusReceita.aprovada };

  let service: FavoritoService;
  let prisma: {
    favorito: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    receita: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      favorito: {
        findMany: jest.fn(async () =>
          [gratuita, paga].map((r) => ({ receita: r })),
        ),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => data),
      },
      receita: { findFirst: jest.fn(async () => ({ id: 'gratuita' })) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FavoritoService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: VisibilidadeReceitaService,
          useValue: {
            comRestricoesVioladas: async (rs: unknown[]) => rs,
            filtroBase: () => filtroDoUsuario,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(FavoritoService);
  });

  it('receita paga favoritada vira prévia; a gratuita vem inteira', async () => {
    const [primeira, segunda] = (await service.findFavorites(leitor)) as any[];

    expect(primeira).toBe(gratuita);
    expect(segunda).toMatchObject({
      id: 'paga',
      oferta: { preco: 12.9, comprada: false },
    });
    expect(segunda).not.toHaveProperty('modoPreparo');
    expect(segunda).not.toHaveProperty('ingredientes');
    expect(segunda.midias.map((m: any) => m.id)).toEqual(['capa']);
  });

  it('lista só os favoritos que o usuário pode ver hoje', async () => {
    await service.findFavorites(leitor);

    expect(prisma.favorito.findMany.mock.calls[0][0].where).toEqual({
      usuarioId: leitor.id,
      receita: filtroDoUsuario,
    });
  });

  it('o autor vê a própria receita paga inteira nos favoritos', async () => {
    const [, segunda] = (await service.findFavorites(vendedor)) as any[];

    expect(segunda).toBe(paga);
  });
});

describe('FavoritoService.addFavorite', () => {
  const leitor = {
    id: 'leitor',
    sub: 'leitor',
    tipoUsuario: TipoUsuario.comum,
  } as UsuarioAutenticado;
  const filtroDoUsuario = { status: StatusReceita.aprovada };

  let service: FavoritoService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      favorito: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => data),
      },
      receita: { findFirst: jest.fn(async () => ({ id: 'receita' })) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        FavoritoService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: VisibilidadeReceitaService,
          useValue: { filtroBase: () => filtroDoUsuario },
        },
      ],
    }).compile();
    service = moduleRef.get(FavoritoService);
  });

  it('procura a receita com a visibilidade do usuário', async () => {
    await service.addFavorite('receita', leitor);

    expect(prisma.receita.findFirst.mock.calls[0][0].where).toEqual({
      id: 'receita',
      deletedAt: null,
      ...filtroDoUsuario,
    });
    expect(prisma.favorito.create).toHaveBeenCalledWith({
      data: { usuarioId: 'leitor', receitaId: 'receita' },
    });
  });

  it('receita que o usuário não pode ver (pendente de outro): 404', async () => {
    prisma.receita.findFirst.mockResolvedValue(null);

    await expect(service.addFavorite('receita', leitor)).rejects.toThrow(
      new NotFoundException('Receita não encontrada'),
    );
    expect(prisma.favorito.create).not.toHaveBeenCalled();
  });
});
