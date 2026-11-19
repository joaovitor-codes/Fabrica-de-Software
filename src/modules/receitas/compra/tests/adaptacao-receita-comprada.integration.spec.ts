/// <reference types="jest" />

import 'dotenv/config';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  DiaSemana,
  Gravidade,
  Prisma,
  StatusAprovacao,
  StatusCompraReceita,
  StatusReceita,
  TipoRefeicao,
  TipoRestricao,
  TipoUsuario,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CacheService } from '../../../../common/cache/cache.service';
import { UsuarioAutenticado } from '../../../../auth/auth.types';
import { IaService } from '../../../ia/ia.service';
import { UsuarioService } from '../../../identidade/usuario/usuario.service';
import { TermosService } from '../../../marketplace/termos/termos.service';
import { PlanoAlimentarService } from '../../../acompanhamento/plano-alimentar/plano-alimentar.service';
import { AdaptacaoBaseService } from '../../adaptacao/adaptacao-base.service';
import { AdaptacaoCatalogoService } from '../../adaptacao/adaptacao-catalogo.service';
import { AdaptacaoPacienteService } from '../../adaptacao/adaptacao-paciente.service';
import { AdaptacaoProfissionalService } from '../../adaptacao/adaptacao-profissional.service';
import { IngredientesReceitaService } from '../../receita/ingredientes-receita.service';
import { ReceitaService } from '../../receita/receita.service';
import { VisibilidadeReceitaService } from '../../visibilidade/visibilidade-receita.service';

/**
 * Adaptação e plano alimentar sobre a receita comprada (#127), contra o
 * Postgres de verdade: a adaptação da cópia fica só para o comprador, e o
 * plano aceita só a cópia que o próprio paciente comprou (P10). A IA é
 * dublada: troca o leite pela bebida de aveia e não acha nada fora da lista.
 */
describe('Adaptação e plano da receita comprada (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let receitas: ReceitaService;
  let adaptacao: AdaptacaoPacienteService;
  let adaptacaoProfissional: AdaptacaoProfissionalService;
  let planos: PlanoAlimentarService;

  const ids = { contas: [] as string[], usuarios: [] as string[] };
  let vendedor: UsuarioAutenticado;
  let comprador: UsuarioAutenticado;
  let outro: UsuarioAutenticado;
  let profissional: UsuarioAutenticado;
  let profissionalId: string;
  let pacienteComprador: string;
  let pacienteOutro: string;
  let restricaoId: string;
  let leiteId: string;
  let aveiaId: string;
  let unidadeId: string;
  let originalId: string;
  let ofertaId: string;
  let copiaId: string;
  let compraId: string;

  const nomeAveia = () => `Bebida de aveia ${sufixo}`;
  const iaDublada = {
    adaptarReceita: async (dados: { candidatos: string[] }) => ({
      trocas: [
        { i: 0, acao: 'substituir', c: dados.candidatos.indexOf(nomeAveia()) },
      ],
      resumo: 'Leite trocado pela bebida de aveia.',
    }),
    ingredientesNaoListados: async () => ({ faltando: [] }),
  };

  async function criarUsuario(nome: string, tipoUsuario: TipoUsuario) {
    const conta = await prisma.conta.create({
      data: { email: `${nome}-${sufixo}@teste.local`, senhaHash: 'x' },
    });
    const usuario = await prisma.usuario.create({
      data: { contaId: conta.id, nome, tipoUsuario },
    });
    ids.contas.push(conta.id);
    ids.usuarios.push(usuario.id);
    return { ...usuario, sub: usuario.id } as UsuarioAutenticado;
  }

  async function restricaoDoComprador(gravidade: Gravidade) {
    await prisma.pacienteRestricao.deleteMany({
      where: { pacienteId: pacienteComprador },
    });
    await prisma.pacienteRestricao.create({
      data: { pacienteId: pacienteComprador, restricaoId, gravidade },
    });
  }

  const adaptacaoDaCopia = () =>
    prisma.receitaAdaptacao.findFirstOrThrow({
      where: { receitaOrigemId: copiaId },
    });

  async function criarPlano(pacienteId: string) {
    return prisma.planoAlimentar.create({
      data: {
        pacienteId,
        profissionalId,
        nome: `Plano ${sufixo}`,
        dataInicio: new Date(),
      },
    });
  }

  const item = (receitaId: string) => ({
    receitaId,
    diaSemana: DiaSemana.segunda,
    tipoRefeicao: TipoRefeicao.almoco,
    horarioSugerido: '12:00',
  });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    vendedor = await criarUsuario('vendedor', TipoUsuario.comum);
    comprador = await criarUsuario('comprador', TipoUsuario.paciente);
    outro = await criarUsuario('outro', TipoUsuario.paciente);
    profissional = await criarUsuario('nutri', TipoUsuario.profissional);

    profissionalId = (
      await prisma.profissional.create({
        data: {
          usuarioId: profissional.id,
          registroProfissional: `CRN-${sufixo}`,
          statusAprovacao: StatusAprovacao.aprovado,
        },
      })
    ).id;
    pacienteComprador = (
      await prisma.paciente.create({
        data: { usuarioId: comprador.id, profissionalId },
      })
    ).id;
    pacienteOutro = (
      await prisma.paciente.create({
        data: { usuarioId: outro.id, profissionalId },
      })
    ).id;

    restricaoId = (
      await prisma.restricaoAlimentar.create({
        data: { nome: `Lactose ${sufixo}`, tipo: TipoRestricao.intolerancia },
      })
    ).id;
    // Revisados depois da restrição: o leite a contém, a aveia é segura.
    const revisadoEm = new Date(Date.now() + 1000);
    leiteId = (
      await prisma.ingrediente.create({
        data: { nome: `Leite ${sufixo}`, restricoesRevisadasEm: revisadoEm },
      })
    ).id;
    aveiaId = (
      await prisma.ingrediente.create({
        data: { nome: nomeAveia(), restricoesRevisadasEm: revisadoEm },
      })
    ).id;
    await prisma.ingredienteRestricao.create({
      data: { ingredienteId: leiteId, restricaoId },
    });
    unidadeId = (
      await prisma.unidadeMedida.create({
        data: { codigo: `u${sufixo}`, nome: `Unidade ${sufixo}` },
      })
    ).id;

    originalId = (
      await prisma.receita.create({
        data: {
          nome: `Bolo ${sufixo}`,
          modoPreparo: 'Misture e asse.',
          criadoPor: vendedor.id,
          status: StatusReceita.aprovada,
        },
      })
    ).id;
    ofertaId = (
      await prisma.receitaOferta.create({
        data: { receitaId: originalId, preco: new Prisma.Decimal('29.90') },
      })
    ).id;

    const ia = iaDublada as unknown as IaService;
    const cache = { del: async () => undefined } as unknown as CacheService;
    const visibilidade = new VisibilidadeReceitaService(prisma);
    const ingredientesReceita = new IngredientesReceitaService(prisma, ia);
    const base = new AdaptacaoBaseService(prisma, ia, ingredientesReceita);
    adaptacao = new AdaptacaoPacienteService(prisma, cache, base, visibilidade);
    adaptacaoProfissional = new AdaptacaoProfissionalService(
      prisma,
      base,
      ingredientesReceita,
    );
    planos = new PlanoAlimentarService(prisma);
    receitas = new ReceitaService(
      prisma,
      {} as UsuarioService,
      cache,
      visibilidade,
      ingredientesReceita,
      {} as AdaptacaoCatalogoService,
      {} as TermosService,
      {} as ConfigService,
    );
  });

  /** A cópia e a compra paga, como o webhook deixa depois do pagamento. */
  beforeEach(async () => {
    await restricaoDoComprador(Gravidade.moderada);
    const copia = await prisma.receita.create({
      data: {
        nome: `Bolo ${sufixo}`,
        modoPreparo: 'Misture e asse.',
        criadoPor: vendedor.id,
        status: StatusReceita.aprovada,
        ingredientes: {
          create: {
            ingredienteId: leiteId,
            quantidade: new Prisma.Decimal('200'),
            unidadeMedidaId: unidadeId,
          },
        },
      },
    });
    copiaId = copia.id;
    compraId = (
      await prisma.receitaCompra.create({
        data: {
          ofertaId,
          compradorId: comprador.id,
          precoPago: new Prisma.Decimal('29.90'),
          taxaPlataforma: new Prisma.Decimal('4.49'),
          versaoComprada: 1,
          conteudoComprado: {},
          status: StatusCompraReceita.paga,
          pagaEm: new Date(),
          receitaCopiaId: copia.id,
        },
      })
    ).id;
  });

  afterEach(async () => {
    const dosTestes = {
      criadoPor: { in: ids.usuarios },
      id: { not: originalId },
    };
    await prisma.planoAlimentarItem.deleteMany({
      where: { planoAlimentar: { profissionalId } },
    });
    await prisma.planoAlimentar.deleteMany({ where: { profissionalId } });
    await prisma.ingredienteSubstituto.deleteMany({
      where: { ingredienteOrigemId: leiteId },
    });
    await prisma.receitaAdaptacao.deleteMany({
      where: { receitaOrigem: dosTestes },
    });
    await prisma.receitaCompra.deleteMany({
      where: { compradorId: comprador.id },
    });
    await prisma.receitaIngrediente.deleteMany({
      where: { receita: dosTestes },
    });
    await prisma.receita.deleteMany({ where: dosTestes });
  });

  afterAll(async () => {
    await prisma.receitaOferta.deleteMany({ where: { id: ofertaId } });
    await prisma.receita.deleteMany({ where: { id: originalId } });
    await prisma.pacienteRestricao.deleteMany({ where: { restricaoId } });
    await prisma.paciente.deleteMany({
      where: { id: { in: [pacienteComprador, pacienteOutro] } },
    });
    await prisma.profissional.deleteMany({ where: { id: profissionalId } });
    await prisma.ingredienteRestricao.deleteMany({ where: { restricaoId } });
    await prisma.ingrediente.deleteMany({
      where: { id: { in: [leiteId, aveiaId] } },
    });
    await prisma.restricaoAlimentar.deleteMany({ where: { id: restricaoId } });
    await prisma.unidadeMedida.deleteMany({ where: { id: unidadeId } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids.usuarios } } });
    await prisma.conta.deleteMany({ where: { id: { in: ids.contas } } });
    await prisma.$disconnect();
  });

  describe('POST :id/adaptar sobre a cópia', () => {
    it('o comprador adapta a cópia, e só ele vê a adaptação', async () => {
      const res: any = await adaptacao.adaptar(copiaId, restricaoId, comprador);

      expect(res.disponivel).toBe(true);
      const adaptadaId = res.receita.id;
      expect((await adaptacaoDaCopia()).receitaAdaptadaId).toBe(adaptadaId);

      const vista: any = await receitas.findOne(adaptadaId, comprador);
      expect(vista.id).toBe(adaptadaId);

      for (const usuario of [outro, vendedor, undefined]) {
        await expect(
          receitas.findOne(adaptadaId, usuario),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
    });

    it('continua privada depois de verificada, até para o profissional', async () => {
      const res: any = await adaptacao.adaptar(copiaId, restricaoId, comprador);
      const adaptadaId = res.receita.id;

      // Pendente, o profissional a vê para verificar (curadoria).
      const naFila: any = await receitas.findOne(adaptadaId, profissional);
      expect(naFila.id).toBe(adaptadaId);

      await prisma.receita.update({
        where: { id: adaptadaId },
        data: { status: StatusReceita.aprovada },
      });
      for (const usuario of [outro, profissional, undefined]) {
        await expect(
          receitas.findOne(adaptadaId, usuario),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
      expect((await receitas.findOne(adaptadaId, comprador)).id).toBe(
        adaptadaId,
      );
    });

    it('fica fora das listagens, mesmo verificada', async () => {
      const res: any = await adaptacao.adaptar(copiaId, restricaoId, comprador);
      await prisma.receita.update({
        where: { id: res.receita.id },
        data: { status: StatusReceita.aprovada },
      });

      const aparece = await prisma.receita.count({
        where: {
          id: res.receita.id,
          AND: [
            new VisibilidadeReceitaService(prisma).filtroBase(outro),
            new VisibilidadeReceitaService(prisma).semReceitasPagas(),
          ],
        },
      });
      expect(aparece).toBe(0);
    });

    it('com restrição estrita, o comprador só vê depois da verificação', async () => {
      await restricaoDoComprador(Gravidade.grave);

      const res: any = await adaptacao.adaptar(copiaId, restricaoId, comprador);
      expect(res.disponivel).toBe(false);
      expect(res.receita).toBeUndefined();

      const { receitaAdaptadaId } = await adaptacaoDaCopia();
      await expect(
        receitas.findOne(receitaAdaptadaId, comprador),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await prisma.receita.update({
        where: { id: receitaAdaptadaId },
        data: { status: StatusReceita.aprovada },
      });
      expect((await receitas.findOne(receitaAdaptadaId, comprador)).id).toBe(
        receitaAdaptadaId,
      );
    });

    it('outro usuário não adapta a cópia', async () => {
      await expect(
        adaptacao.adaptar(copiaId, restricaoId, outro),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('com a compra reembolsada, o comprador não adapta nem vê a adaptação', async () => {
      const res: any = await adaptacao.adaptar(copiaId, restricaoId, comprador);
      await prisma.receitaCompra.update({
        where: { id: compraId },
        data: { status: StatusCompraReceita.reembolsada },
      });

      await expect(
        receitas.findOne(res.receita.id, comprador),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        adaptacao.adaptar(copiaId, restricaoId, comprador),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('não adapta a adaptação da cópia, que ficaria pública', async () => {
      const res: any = await adaptacao.adaptar(copiaId, restricaoId, comprador);

      await expect(
        adaptacao.adaptar(res.receita.id, restricaoId, comprador),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('adaptação do profissional sobre a cópia', () => {
    const escolha = (pacienteId: string) => ({
      pacienteId,
      ingredientes: [
        {
          ingredienteId: aveiaId,
          quantidade: 200,
          unidadeMedidaId: unidadeId,
        },
      ],
    });

    it('adapta a cópia do próprio paciente, visível para ele', async () => {
      const res: any = await adaptacaoProfissional.salvarDoProfissional(
        copiaId,
        escolha(pacienteComprador),
        profissional,
      );

      expect((await receitas.findOne(res.receita.id, comprador)).id).toBe(
        res.receita.id,
      );
      await expect(
        receitas.findOne(res.receita.id, outro),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('recusa adaptar a cópia de outro usuário para um paciente', async () => {
      await expect(
        adaptacaoProfissional.salvarDoProfissional(
          copiaId,
          escolha(pacienteOutro),
          profissional,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(
        adaptacaoProfissional.sugerir(copiaId, pacienteOutro, profissional),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('plano alimentar', () => {
    it('o profissional inclui no plano a cópia do próprio paciente', async () => {
      const plano = await criarPlano(pacienteComprador);

      const criado = await planos.adicionarItemAoPlano(
        plano.id,
        item(copiaId),
        profissionalId,
      );
      expect(criado.receitaId).toBe(copiaId);
    });

    it('e a adaptação que o paciente fez da cópia', async () => {
      const res: any = await adaptacao.adaptar(copiaId, restricaoId, comprador);
      const plano = await criarPlano(pacienteComprador);

      const criado = await planos.adicionarItemAoPlano(
        plano.id,
        item(res.receita.id),
        profissionalId,
      );
      expect(criado.receitaId).toBe(res.receita.id);
    });

    it('recusa a cópia de outro usuário, e a adaptação dela', async () => {
      const res: any = await adaptacao.adaptar(copiaId, restricaoId, comprador);
      const plano = await criarPlano(pacienteOutro);

      for (const receitaId of [copiaId, res.receita.id]) {
        await expect(
          planos.adicionarItemAoPlano(
            plano.id,
            item(receitaId),
            profissionalId,
          ),
        ).rejects.toThrow('só entra no plano a cópia que o paciente comprou');
      }
    });

    it('recusa ao trocar a receita de um item para a cópia de outro', async () => {
      const plano = await criarPlano(pacienteOutro);
      const comum = await prisma.receita.create({
        data: {
          nome: `Salada ${sufixo}`,
          criadoPor: vendedor.id,
          status: StatusReceita.aprovada,
        },
      });
      const existente = await planos.adicionarItemAoPlano(
        plano.id,
        item(comum.id),
        profissionalId,
      );

      await expect(
        planos.updateItemDoPlano(
          existente.id,
          { receitaId: copiaId },
          profissionalId,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('recusa a cópia de compra reembolsada', async () => {
      await prisma.receitaCompra.update({
        where: { id: compraId },
        data: { status: StatusCompraReceita.reembolsada },
      });
      const plano = await criarPlano(pacienteComprador);

      await expect(
        planos.adicionarItemAoPlano(plano.id, item(copiaId), profissionalId),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    // Achado no teste de carga: o findFirst antes do create deixava 6 pedidos
    // simultâneos gravarem 6 itens no mesmo dia e refeição.
    it('pedidos simultâneos no mesmo dia e refeição gravam um item só', async () => {
      const plano = await criarPlano(pacienteComprador);

      const resultados = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          planos.adicionarItemAoPlano(plano.id, item(copiaId), profissionalId),
        ),
      );

      const recusados = resultados.filter((r) => r.status === 'rejected');
      expect(resultados.length - recusados.length).toBe(1);
      for (const r of recusados) {
        expect(r.reason).toBeInstanceOf(ConflictException);
      }
      expect(
        await prisma.planoAlimentarItem.count({
          where: { planoAlimentarId: plano.id },
        }),
      ).toBe(1);
    });

    it('mover dois itens para o mesmo horário ao mesmo tempo: um vence', async () => {
      const plano = await criarPlano(pacienteComprador);
      const [a, b] = await Promise.all(
        [TipoRefeicao.almoco, TipoRefeicao.jantar].map((tipoRefeicao) =>
          planos.adicionarItemAoPlano(
            plano.id,
            { ...item(copiaId), tipoRefeicao },
            profissionalId,
          ),
        ),
      );

      const resultados = await Promise.allSettled(
        [a, b].map((i) =>
          planos.updateItemDoPlano(
            i.id,
            { tipoRefeicao: TipoRefeicao.ceia },
            profissionalId,
          ),
        ),
      );

      const recusados = resultados.filter((r) => r.status === 'rejected');
      expect(recusados).toHaveLength(1);
      expect(recusados[0].reason).toBeInstanceOf(ConflictException);
      expect(
        await prisma.planoAlimentarItem.count({
          where: { planoAlimentarId: plano.id, tipoRefeicao: 'ceia' },
        }),
      ).toBe(1);
    });
  });
});
