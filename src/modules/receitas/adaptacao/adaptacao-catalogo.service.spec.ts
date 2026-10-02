/// <reference types="jest" />

import { ForbiddenException } from '@nestjs/common';
import { TipoUsuario } from '@prisma/client';
import { AdaptacaoCatalogoService } from './adaptacao-catalogo.service';
import { AdaptacaoPacienteService } from './adaptacao-paciente.service';
import * as restricoesReceita from '../visibilidade/restricoes-receita';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';

jest.mock('../visibilidade/restricoes-receita');
const mocked = jest.mocked(restricoesReceita);

describe('AdaptacaoCatalogoService.abrirAdaptada', () => {
  const usuario = {
    id: 'davi',
    tipoUsuario: TipoUsuario.paciente,
  } as UsuarioAutenticado;
  const violacao = (id: string, estrita: boolean) => ({
    id,
    nome: id,
    estrita,
    contem: [{ id: 'x', nome: 'x' }],
    naoRevisados: [],
    semDado: [],
  });
  const lactose = violacao('lactose', false);
  const ovo = violacao('ovo', true);
  const restricoes = [
    {
      restricaoId: 'lactose',
      nome: 'lactose',
      estrita: false,
      criadaEm: new Date(),
      campos: [],
    },
    {
      restricaoId: 'ovo',
      nome: 'ovo',
      estrita: true,
      criadaEm: new Date(),
      campos: [],
    },
  ];
  const origem = { id: 'bolo', nome: 'Bolo' };

  let prisma: any;
  let adaptar: jest.Mock;
  let service: AdaptacaoCatalogoService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma = {
      receita: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async ({ where }: any) => ({ id: where.id })),
      },
    };
    mocked.restricoesVioladas.mockImplementation(
      async (_p, ids) => new Map(ids.map((id) => [id, []])),
    );
    adaptar = jest.fn();
    service = new AdaptacaoCatalogoService(
      prisma as PrismaService,
      {
        filtroVisibilidade: () => ({}),
      } as unknown as VisibilidadeReceitaService,
      { adaptar } as unknown as AdaptacaoPacienteService,
    );
  });

  it('adapta uma restrição de cada vez, estritas primeiro, encadeando', async () => {
    adaptar
      .mockResolvedValueOnce({
        disponivel: true,
        receita: { id: 'bolo-sem-ovo' },
      })
      .mockResolvedValueOnce({
        disponivel: true,
        receita: { id: 'bolo-sem-ovo-sem-leite' },
      });

    const r = await service.abrirAdaptada(
      origem,
      [lactose, ovo],
      usuario,
      restricoes,
    );

    // Cada passo restringe os candidatos pelas outras restrições do paciente.
    expect(adaptar.mock.calls).toEqual([
      ['bolo', 'ovo', usuario, [restricoes[0]]],
      ['bolo-sem-ovo', 'lactose', usuario, [restricoes[1]]],
    ]);
    expect(r?.receita).toEqual({ id: 'bolo-sem-ovo-sem-leite' });
  });

  it('a receita final é conferida contra todas as restrições', async () => {
    adaptar
      .mockResolvedValueOnce({ disponivel: true, receita: { id: 'a1' } })
      .mockResolvedValueOnce({ disponivel: true, receita: { id: 'a2' } });
    // A troca para lactose trouxe de volta um ingrediente com ovo.
    mocked.restricoesVioladas.mockResolvedValue(new Map([['a2', [ovo]]]));

    const r = await service.abrirAdaptada(
      origem,
      [lactose, ovo],
      usuario,
      restricoes,
    );

    expect(r).toBeNull();
  });

  it('usa a adaptação existente que fere menos, sem chamar a IA', async () => {
    prisma.receita.findMany.mockResolvedValue([
      {
        id: 'pronta',
        status: 'aprovada',
        adaptacaoDe: { receitaOrigemId: 'bolo' },
      },
    ]);

    const r = await service.abrirAdaptada(origem, [ovo], usuario, restricoes);

    expect(r?.receita).toMatchObject({ id: 'pronta' });
    expect(adaptar).not.toHaveBeenCalled();
  });

  it('passo "já segura" é pulado', async () => {
    adaptar.mockResolvedValueOnce({ jaSegura: true }).mockResolvedValueOnce({
      disponivel: true,
      receita: { id: 'sem-leite' },
    });

    const r = await service.abrirAdaptada(
      origem,
      [lactose, ovo],
      usuario,
      restricoes,
    );

    expect(r?.receita).toEqual({ id: 'sem-leite' });
  });

  it('adaptação pendente para restrição estrita: 403 explicando', async () => {
    adaptar.mockResolvedValueOnce({
      disponivel: false,
      adaptacao: { id: 'nova', restricao: 'ovo', resumoIa: null },
    });

    await expect(
      service.abrirAdaptada(origem, [ovo], usuario, restricoes),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a IA falha: devolve null para o comportamento normal assumir', async () => {
    adaptar.mockRejectedValueOnce(new Error('422'));

    await expect(
      service.abrirAdaptada(origem, [ovo], usuario, restricoes),
    ).resolves.toBeNull();
  });
});
