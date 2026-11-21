/// <reference types="jest" />

import 'dotenv/config';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  StatusAprovacao,
  StatusCompraReceita,
  StatusReceita,
  TipoRestricao,
  TipoUsuario,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CacheService } from '../../../../common/cache/cache.service';
import { UsuarioAutenticado } from '../../../../auth/auth.types';
import { IaService } from '../../../ia/ia.service';
import { UsuarioService } from '../../../identidade/usuario/usuario.service';
import { TermosService } from '../../../marketplace/termos/termos.service';
import { AdaptacaoCatalogoService } from '../../adaptacao/adaptacao-catalogo.service';
import { VisibilidadeReceitaService } from '../../visibilidade/visibilidade-receita.service';
import { IngredientesReceitaService } from '../ingredientes-receita.service';
import { ReceitaService } from '../receita.service';

/**
 * Apagar a receita original não pode desvincular as adaptações dela (#172),
 * contra o Postgres de verdade: o vínculo é o que esconde a adaptação feita
 * para um paciente. Sem ele, ela viraria uma receita pública.
 */
describe('Apagar receita com adaptações (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let receitas: ReceitaService;
  let visibilidade: VisibilidadeReceitaService;
  const contas: string[] = [];
  const usuarios: string[] = [];
  const criadas: string[] = [];
  let autor: UsuarioAutenticado;
  let outro: UsuarioAutenticado;
  let dono: UsuarioAutenticado;
  let profissionalId: string;
  let pacienteId: string;
  let restricaoId: string;
  let seq = 0;

  async function criarUsuario(tipoUsuario: TipoUsuario) {
    const conta = await prisma.conta.create({
      data: { email: `rem-${seq++}-${sufixo}@teste.local`, senhaHash: 'x' },
    });
    const usuario = await prisma.usuario.create({
      data: { contaId: conta.id, nome: `Rem ${sufixo}`, tipoUsuario },
    });
    contas.push(conta.id);
    usuarios.push(usuario.id);
    return {
      ...usuario,
      sub: usuario.id,
      papeis: [tipoUsuario],
    } as UsuarioAutenticado;
  }

  async function receita(criadoPor: string, nome: string) {
    const { id } = await prisma.receita.create({
      data: { nome, criadoPor, status: StatusReceita.aprovada },
    });
    criadas.push(id);
    return id;
  }

  /** Original aprovada com uma adaptação do paciente e uma pública. */
  async function originalComAdaptacoes() {
    const originalId = await receita(autor.id, `Bolo ${sufixo}`);
    const doPacienteId = await receita(autor.id, `Bolo do paciente ${sufixo}`);
    const publicaId = await receita(autor.id, `Bolo sem lactose ${sufixo}`);
    await prisma.receitaAdaptacao.createMany({
      data: [
        {
          receitaOrigemId: originalId,
          versaoOrigem: 1,
          receitaAdaptadaId: doPacienteId,
          pacienteId,
          trocas: [],
        },
        {
          receitaOrigemId: originalId,
          versaoOrigem: 1,
          receitaAdaptadaId: publicaId,
          restricaoId,
          trocas: [],
        },
      ],
    });
    return { originalId, doPacienteId, publicaId };
  }

  /** Entra nas listagens (o mesmo filtro das rotas de catálogo)? */
  const listada = async (id: string, usuario?: UsuarioAutenticado) =>
    (await prisma.receita.count({
      where: {
        id,
        deletedAt: null,
        AND: [
          visibilidade.filtroBase(usuario),
          visibilidade.semReceitasPagas(),
        ],
      },
    })) > 0;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    visibilidade = new VisibilidadeReceitaService(prisma);
    receitas = new ReceitaService(
      prisma,
      {} as UsuarioService,
      { del: async () => undefined } as unknown as CacheService,
      visibilidade,
      new IngredientesReceitaService(prisma, {} as IaService),
      {} as AdaptacaoCatalogoService,
      {} as TermosService,
      {} as ConfigService,
    );

    autor = await criarUsuario(TipoUsuario.comum);
    outro = await criarUsuario(TipoUsuario.comum);
    dono = await criarUsuario(TipoUsuario.paciente);
    const nutri = await criarUsuario(TipoUsuario.profissional);
    profissionalId = (
      await prisma.profissional.create({
        data: {
          usuarioId: nutri.id,
          registroProfissional: `CRN-${sufixo}`,
          statusAprovacao: StatusAprovacao.aprovado,
        },
      })
    ).id;
    pacienteId = (
      await prisma.paciente.create({
        data: { usuarioId: dono.id, profissionalId },
      })
    ).id;
    restricaoId = (
      await prisma.restricaoAlimentar.create({
        data: { nome: `Lactose ${sufixo}`, tipo: TipoRestricao.intolerancia },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.receitaCompra.deleteMany({
      where: { compradorId: { in: usuarios } },
    });
    await prisma.receitaOferta.deleteMany({
      where: { receitaId: { in: criadas } },
    });
    await prisma.receitaAdaptacao.deleteMany({
      where: {
        OR: [
          { receitaOrigemId: { in: criadas } },
          { receitaAdaptadaId: { in: criadas } },
        ],
      },
    });
    await prisma.receita.deleteMany({ where: { id: { in: criadas } } });
    await prisma.paciente.deleteMany({ where: { id: pacienteId } });
    await prisma.profissional.deleteMany({ where: { id: profissionalId } });
    await prisma.restricaoAlimentar.deleteMany({ where: { id: restricaoId } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    await prisma.conta.deleteMany({ where: { id: { in: contas } } });
    await prisma.$disconnect();
  });

  it('a adaptação feita para o paciente continua privada', async () => {
    const { originalId, doPacienteId } = await originalComAdaptacoes();

    await receitas.remove(originalId, autor);

    for (const usuario of [outro, undefined]) {
      await expect(
        receitas.findOne(doPacienteId, usuario),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await listada(doPacienteId, usuario)).toBe(false);
    }
    // O paciente segue vendo a dele.
    expect((await receitas.findOne(doPacienteId, dono)).id).toBe(doPacienteId);
  });

  it('a original sai das listagens, mas os vínculos ficam', async () => {
    const { originalId, doPacienteId, publicaId } =
      await originalComAdaptacoes();

    await receitas.remove(originalId, autor);

    const original = await prisma.receita.findUnique({
      where: { id: originalId },
    });
    expect(original?.deletedAt).toBeInstanceOf(Date);
    expect(await listada(originalId, outro)).toBe(false);
    expect(
      await prisma.receitaAdaptacao.count({
        where: { receitaAdaptadaId: { in: [doPacienteId, publicaId] } },
      }),
    ).toBe(2);
    // A pública continua pública, como antes.
    expect(await listada(publicaId, outro)).toBe(true);
  });

  it('receita sem adaptações e fora de planos continua sendo apagada de vez', async () => {
    const id = await receita(autor.id, `Sopa ${sufixo}`);

    await receitas.remove(id, autor);

    expect(await prisma.receita.findUnique({ where: { id } })).toBeNull();
  });

  it('apagar a própria adaptação apaga de vez e não mexe na original', async () => {
    const { originalId, publicaId } = await originalComAdaptacoes();

    await receitas.remove(publicaId, autor);

    expect(
      await prisma.receita.findUnique({ where: { id: publicaId } }),
    ).toBeNull();
    expect(
      (await prisma.receita.findUniqueOrThrow({ where: { id: originalId } }))
        .deletedAt,
    ).toBeNull();
  });

  it('receita paga sai da vitrine; a oferta e a cópia de quem comprou ficam', async () => {
    const id = await receita(autor.id, `Torta ${sufixo}`);
    const oferta = await prisma.receitaOferta.create({
      data: { receitaId: id, preco: 20 },
    });
    const copiaId = await receita(autor.id, `Torta ${sufixo}`);
    await prisma.receitaCompra.create({
      data: {
        ofertaId: oferta.id,
        compradorId: outro.id,
        precoPago: 20,
        taxaPlataforma: 2,
        versaoComprada: 1,
        conteudoComprado: {},
        status: StatusCompraReceita.paga,
        pagaEm: new Date(),
        receitaCopiaId: copiaId,
      },
    });

    await receitas.remove(id, autor);

    expect(
      (await prisma.receita.findUniqueOrThrow({ where: { id } })).deletedAt,
    ).toBeInstanceOf(Date);
    expect(
      await prisma.receita.count({
        where: { id, ...visibilidade.filtroAVenda() },
      }),
    ).toBe(0);
    expect(await prisma.receitaOferta.count({ where: { id: oferta.id } })).toBe(
      1,
    );
    expect((await receitas.findOne(copiaId, outro)).id).toBe(copiaId);
  });
});
