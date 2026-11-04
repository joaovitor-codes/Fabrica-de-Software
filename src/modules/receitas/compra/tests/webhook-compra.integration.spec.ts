/// <reference types="jest" />

import 'dotenv/config';
import { Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Prisma,
  StatusCompraReceita,
  StatusReceita,
  TipoUsuario,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { MercadoPagoService } from '../../../marketplace/mercado-pago/mercado-pago.service';
import { PagamentoMercadoPago } from '../../../marketplace/mercado-pago/mercado-pago.types';
import { RecebedorService } from '../../../marketplace/recebedor/recebedor.service';
import { NotificacaoService } from '../../../notificacao/notificacao.service';
import { UsuarioAutenticado } from '../../../../auth/auth.types';
import { VisibilidadeReceitaService } from '../../visibilidade/visibilidade-receita.service';
import { ConteudoComprado } from '../compra.types';
import { WebhookCompraService } from '../webhook-compra.service';

/**
 * Roda contra o Postgres de verdade: a trava da compra (FOR UPDATE), a
 * unicidade de gatewayCobrancaId e o índice de compra viva só existem lá.
 * Grava dados com um sufixo próprio e apaga tudo no fim.
 */
describe('Webhook da compra (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  const CONTA_MP = `mp-${sufixo}`;
  let prisma: PrismaService;
  let service: WebhookCompraService;
  let pagamentoMp: PagamentoMercadoPago;

  const ids = {
    contas: [] as string[],
    usuarios: [] as string[],
    receitas: [] as string[],
  };
  let vendedorId: string;
  let compradorId: string;
  let ofertaId: string;
  let ingredienteId: string;
  let unidadeId: string;
  let conteudo: ConteudoComprado;
  let seq = 0;

  async function criarUsuario(nome: string, tipoUsuario: TipoUsuario) {
    const conta = await prisma.conta.create({
      data: { email: `${nome}-${sufixo}@teste.local`, senhaHash: 'x' },
    });
    const usuario = await prisma.usuario.create({
      data: { contaId: conta.id, nome, tipoUsuario },
    });
    ids.contas.push(conta.id);
    ids.usuarios.push(usuario.id);
    return usuario.id;
  }

  function criarCompra(status: StatusCompraReceita = 'pendente') {
    return prisma.receitaCompra.create({
      data: {
        ofertaId,
        compradorId,
        precoPago: new Prisma.Decimal('29.90'),
        taxaPlataforma: new Prisma.Decimal('4.49'),
        versaoComprada: 1,
        conteudoComprado: conteudo as unknown as Prisma.InputJsonObject,
        status,
      },
    });
  }

  /** Simula o Mercado Pago devolvendo, para qualquer ID, o pagamento atual. */
  const avisar = (pagamentoId: string) =>
    service.processar(CONTA_MP, pagamentoId);

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma = new PrismaService();
    await prisma.$connect();

    vendedorId = await criarUsuario('vendedor', TipoUsuario.comum);
    compradorId = await criarUsuario('comprador', TipoUsuario.paciente);
    await prisma.contaRecebedor.create({
      data: {
        usuarioId: vendedorId,
        gatewayRecebedorId: CONTA_MP,
        accessTokenCifrado: 'x',
        refreshTokenCifrado: 'x',
        tokenExpiraEm: new Date(Date.now() + 86_400_000),
      },
    });

    unidadeId = (
      await prisma.unidadeMedida.create({
        data: { codigo: `u${sufixo}`, nome: `Unidade ${sufixo}` },
      })
    ).id;
    ingredienteId = (
      await prisma.ingrediente.create({ data: { nome: `Farinha ${sufixo}` } })
    ).id;

    const original = await prisma.receita.create({
      data: {
        nome: `Bolo ${sufixo}`,
        criadoPor: vendedorId,
        status: StatusReceita.aprovada,
      },
    });
    ids.receitas.push(original.id);
    ofertaId = (
      await prisma.receitaOferta.create({
        data: { receitaId: original.id, preco: new Prisma.Decimal('29.90') },
      })
    ).id;

    conteudo = {
      nome: `Bolo ${sufixo}`,
      descricao: 'Fofinho',
      modoPreparo: 'Misture e asse.',
      tempoPreparoMin: 40,
      porcoes: 8,
      nivelDificuldade: 'facil',
      avisoContaminacaoCruzada: false,
      ingredientesNaoListados: [],
      ingredientes: [
        { ingredienteId, quantidade: '200.5', unidadeMedidaId: unidadeId },
      ],
      midias: [{ url: 'https://cdn/1.jpg', tipo: 'capa', ordem: 0 }],
    };

    const recebedor = {
      tokenPorContaMercadoPago: jest.fn().mockResolvedValue('token'),
    };
    const mercadoPago = {
      buscarPagamento: jest.fn(async (_token: string, id: string) => ({
        ...pagamentoMp,
        id,
      })),
    };
    service = new WebhookCompraService(
      prisma,
      recebedor as unknown as RecebedorService,
      mercadoPago as unknown as MercadoPagoService,
      new NotificacaoService(prisma),
    );
  });

  afterEach(async () => {
    // Entre os testes: as compras do comprador e o que nasceu delas.
    const compras = await prisma.receitaCompra.findMany({
      where: { compradorId },
      select: { id: true, receitaCopiaId: true },
    });
    const copias = compras.flatMap((c) => c.receitaCopiaId ?? []);
    await prisma.pagamento.deleteMany({
      where: { receitaCompraId: { in: compras.map((c) => c.id) } },
    });
    await prisma.receitaCompra.deleteMany({ where: { compradorId } });
    await prisma.notificacao.deleteMany({
      where: { usuarioId: { in: ids.usuarios } },
    });
    await prisma.receitaIngrediente.deleteMany({
      where: { receitaId: { in: copias } },
    });
    await prisma.receitaMidia.deleteMany({
      where: { receitaId: { in: copias } },
    });
    await prisma.receita.deleteMany({ where: { id: { in: copias } } });
  });

  afterAll(async () => {
    await prisma.receitaOferta.deleteMany({ where: { id: ofertaId } });
    await prisma.receita.deleteMany({ where: { id: { in: ids.receitas } } });
    await prisma.contaRecebedor.deleteMany({
      where: { usuarioId: vendedorId },
    });
    await prisma.ingrediente.deleteMany({ where: { id: ingredienteId } });
    await prisma.unidadeMedida.deleteMany({ where: { id: unidadeId } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids.usuarios } } });
    await prisma.conta.deleteMany({ where: { id: { in: ids.contas } } });
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  function aprovado(referencia: string): PagamentoMercadoPago {
    return {
      id: '',
      status: 'aprovado',
      valor: 29.9,
      referencia,
      metodo: 'pix',
      pagoEm: new Date(),
    };
  }

  it('o mesmo aviso 5 vezes ao mesmo tempo cria um pagamento e uma cópia', async () => {
    const compra = await criarCompra();
    pagamentoMp = aprovado(compra.id);
    const pagamentoId = `pag-${sufixo}-1`;

    await Promise.all(Array.from({ length: 5 }, () => avisar(pagamentoId)));

    const pagamentos = await prisma.pagamento.findMany({
      where: { receitaCompraId: compra.id },
    });
    const depois = await prisma.receitaCompra.findUniqueOrThrow({
      where: { id: compra.id },
    });
    const copias = await prisma.receita.findMany({
      where: { copiaDeCompra: { id: compra.id } },
    });
    const notificacoes = await prisma.notificacao.count({
      where: { usuarioId: { in: [vendedorId, compradorId] } },
    });

    expect(pagamentos).toHaveLength(1);
    expect(pagamentos[0].gatewayCobrancaId).toBe(pagamentoId);
    expect(copias).toHaveLength(1);
    expect(depois.status).toBe(StatusCompraReceita.paga);
    expect(depois.receitaCopiaId).toBe(copias[0].id);
    expect(notificacoes).toBe(2);
  });

  describe('quem vê a cópia', () => {
    const visibilidade = () => new VisibilidadeReceitaService(prisma);
    let copiaId: string;

    const comoUsuario = async (id: string) => {
      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id } });
      return { ...usuario, sub: id } as UsuarioAutenticado;
    };

    beforeEach(async () => {
      const compra = await criarCompra();
      pagamentoMp = aprovado(compra.id);
      await avisar(`pag-${randomUUID()}`);
      const { receitaCopiaId } = await prisma.receitaCompra.findUniqueOrThrow({
        where: { id: compra.id },
      });
      copiaId = receitaCopiaId!;
    });

    it('fica fora do detalhe para visitante, comprador, autor e curador', async () => {
      const usuarios: (UsuarioAutenticado | undefined)[] = [
        undefined,
        await comoUsuario(compradorId),
        await comoUsuario(vendedorId),
        await comoUsuario(
          await criarUsuario(`curador-${seq++}`, TipoUsuario.profissional),
        ),
        await comoUsuario(
          await criarUsuario(`outro-${seq++}`, TipoUsuario.comum),
        ),
      ];

      for (const usuario of usuarios) {
        await expect(
          visibilidade().garantirVisivel(copiaId, usuario),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
    });

    it('o admin abre pelo id, mas ela fica fora das listagens', async () => {
      const admin = await comoUsuario(
        await criarUsuario(`admin-${seq++}`, TipoUsuario.admin),
      );

      await expect(
        visibilidade().garantirVisivel(copiaId, admin),
      ).resolves.toBeUndefined();
      expect(
        await prisma.receita.findFirst({
          where: { id: copiaId, ...visibilidade().semReceitasPagas() },
        }),
      ).toBeNull();
    });
  });

  it('a cópia tem os ingredientes e as mídias guardados na compra', async () => {
    const compra = await criarCompra();
    pagamentoMp = aprovado(compra.id);

    await avisar(`pag-${sufixo}-2`);

    const { receitaCopiaId } = await prisma.receitaCompra.findUniqueOrThrow({
      where: { id: compra.id },
    });
    const copia = await prisma.receita.findUniqueOrThrow({
      where: { id: receitaCopiaId! },
      include: { ingredientes: true, midias: true },
    });
    expect(copia).toMatchObject({
      nome: `Bolo ${sufixo}`,
      criadoPor: vendedorId,
      status: StatusReceita.aprovada,
    });
    expect(copia.ingredientes).toHaveLength(1);
    expect(copia.ingredientes[0]).toMatchObject({
      ingredienteId,
      unidadeMedidaId: unidadeId,
    });
    expect(copia.ingredientes[0].quantidade.toString()).toBe('200.5');
    expect(copia.midias).toMatchObject([
      { url: 'https://cdn/1.jpg', tipo: 'capa', ordem: 0 },
    ]);
  });

  it('dois pagamentos aprovados da mesma compra ao mesmo tempo: uma cópia só', async () => {
    const compra = await criarCompra();
    pagamentoMp = aprovado(compra.id);

    await Promise.all([avisar(`pag-${sufixo}-3a`), avisar(`pag-${sufixo}-3b`)]);

    const pagamentos = await prisma.pagamento.count({
      where: { receitaCompraId: compra.id },
    });
    const copias = await prisma.receita.count({
      where: { copiaDeCompra: { id: compra.id } },
    });
    expect(pagamentos).toBe(2);
    expect(copias).toBe(1);
  });

  it('aviso para compra cancelada cancela a pendente mais nova e libera a antiga', async () => {
    const antiga = await criarCompra(StatusCompraReceita.cancelada);
    const nova = await criarCompra();
    pagamentoMp = aprovado(antiga.id);

    await avisar(`pag-${sufixo}-4`);

    const [a, n] = await Promise.all([
      prisma.receitaCompra.findUniqueOrThrow({ where: { id: antiga.id } }),
      prisma.receitaCompra.findUniqueOrThrow({ where: { id: nova.id } }),
    ]);
    expect(a.status).toBe(StatusCompraReceita.paga);
    expect(a.receitaCopiaId).not.toBeNull();
    expect(n.status).toBe(StatusCompraReceita.cancelada);
  });
});
