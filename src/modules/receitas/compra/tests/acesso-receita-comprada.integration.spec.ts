/// <reference types="jest" />

import 'dotenv/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  Prisma,
  StatusCompraReceita,
  StatusReceita,
  StatusRecebedor,
  TipoMidia,
  TipoUsuario,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CacheService } from '../../../../common/cache/cache.service';
import { UsuarioAutenticado } from '../../../../auth/auth.types';
import { UsuarioService } from '../../../identidade/usuario/usuario.service';
import { TermosService } from '../../../marketplace/termos/termos.service';
import { MercadoPagoService } from '../../../marketplace/mercado-pago/mercado-pago.service';
import { RecebedorService } from '../../../marketplace/recebedor/recebedor.service';
import { AdaptacaoCatalogoService } from '../../adaptacao/adaptacao-catalogo.service';
import { IngredientesReceitaService } from '../../receita/ingredientes-receita.service';
import { ReceitaService } from '../../receita/receita.service';
import { VisibilidadeReceitaService } from '../../visibilidade/visibilidade-receita.service';
import { CompraService } from '../compra.service';

/**
 * Acesso à receita comprada (#126), contra o Postgres de verdade: os filtros
 * pela relação ReceitaCompra e a gravação de primeiroAcessoEm. A cópia e a
 * compra paga são gravadas direto, como o webhook as deixa.
 */
describe('Acesso à receita comprada (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let receitas: ReceitaService;
  let compras: CompraService;

  const ids = {
    contas: [] as string[],
    usuarios: [] as string[],
    receitas: [] as string[],
  };
  let vendedor: UsuarioAutenticado;
  let comprador: UsuarioAutenticado;
  let outro: UsuarioAutenticado;
  let admin: UsuarioAutenticado;
  let originalId: string;
  let ofertaId: string;
  let ingredienteId: string;
  let unidadeId: string;
  let copiaId: string;
  let compraId: string;

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

  /** A cópia e a compra paga, como o webhook deixa depois do pagamento. */
  async function comprar(status: StatusCompraReceita = 'paga') {
    const copia = await prisma.receita.create({
      data: {
        nome: `Bolo ${sufixo}`,
        modoPreparo: 'Misture e asse.',
        criadoPor: vendedor.id,
        status: StatusReceita.aprovada,
        ingredientes: {
          create: {
            ingredienteId,
            quantidade: new Prisma.Decimal('200'),
            unidadeMedidaId: unidadeId,
          },
        },
        midias: {
          createMany: {
            data: [
              { url: 'https://cdn/capa.jpg', tipo: TipoMidia.capa, ordem: 0 },
              {
                url: 'https://cdn/passo.jpg',
                tipo: TipoMidia.passo_a_passo,
                ordem: 1,
              },
            ],
          },
        },
      },
    });
    const compra = await prisma.receitaCompra.create({
      data: {
        ofertaId,
        compradorId: comprador.id,
        precoPago: new Prisma.Decimal('29.90'),
        taxaPlataforma: new Prisma.Decimal('4.49'),
        versaoComprada: 1,
        conteudoComprado: {},
        status,
        pagaEm: new Date(),
        receitaCopiaId: copia.id,
      },
    });
    copiaId = copia.id;
    compraId = compra.id;
  }

  const primeiroAcesso = async () =>
    (
      await prisma.receitaCompra.findUniqueOrThrow({
        where: { id: compraId },
      })
    ).primeiroAcessoEm;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    vendedor = await criarUsuario('vendedor', TipoUsuario.comum);
    comprador = await criarUsuario('comprador', TipoUsuario.paciente);
    outro = await criarUsuario('outro', TipoUsuario.comum);
    admin = await criarUsuario('admin', TipoUsuario.admin);
    await prisma.contaRecebedor.create({
      data: {
        usuarioId: vendedor.id,
        gatewayRecebedorId: `mp-${sufixo}`,
        accessTokenCifrado: 'x',
        refreshTokenCifrado: 'x',
        tokenExpiraEm: new Date(Date.now() + 86_400_000),
        status: StatusRecebedor.ativo,
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
        modoPreparo: 'Misture e asse.',
        criadoPor: vendedor.id,
        status: StatusReceita.aprovada,
      },
    });
    originalId = original.id;
    ids.receitas.push(original.id);
    ofertaId = (
      await prisma.receitaOferta.create({
        data: { receitaId: original.id, preco: new Prisma.Decimal('29.90') },
      })
    ).id;

    const visibilidade = new VisibilidadeReceitaService(prisma);
    receitas = new ReceitaService(
      prisma,
      {} as UsuarioService,
      { del: async () => undefined } as unknown as CacheService,
      visibilidade,
      {
        avisoIngredientesOcultos: () => ({}),
      } as unknown as IngredientesReceitaService,
      {} as AdaptacaoCatalogoService,
      {} as TermosService,
      {} as ConfigService,
    );
    compras = new CompraService(
      prisma,
      {} as ConfigService,
      {} as TermosService,
      visibilidade,
      {} as RecebedorService,
      {} as MercadoPagoService,
    );
  });

  beforeEach(() => comprar());

  afterEach(async () => {
    const lista = await prisma.receitaCompra.findMany({
      where: { compradorId: comprador.id },
      select: { receitaCopiaId: true },
    });
    const copias = lista.flatMap((c) => c.receitaCopiaId ?? []);
    await prisma.receitaCompra.deleteMany({
      where: { compradorId: comprador.id },
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
    await prisma.receitaVersao.deleteMany({
      where: { receitaId: { in: ids.receitas } },
    });
    await prisma.receitaOferta.deleteMany({ where: { id: ofertaId } });
    await prisma.receita.deleteMany({ where: { id: { in: ids.receitas } } });
    await prisma.contaRecebedor.deleteMany({
      where: { usuarioId: vendedor.id },
    });
    await prisma.ingrediente.deleteMany({ where: { id: ingredienteId } });
    await prisma.unidadeMedida.deleteMany({ where: { id: unidadeId } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids.usuarios } } });
    await prisma.conta.deleteMany({ where: { id: { in: ids.contas } } });
    await prisma.$disconnect();
  });

  describe('GET :id', () => {
    it('o comprador recebe a cópia completa, com compradaDe', async () => {
      const res: any = await receitas.findOne(copiaId, comprador);

      expect(res).toMatchObject({
        id: copiaId,
        modoPreparo: 'Misture e asse.',
        compradaDe: { id: originalId, nome: `Bolo ${sufixo}` },
      });
      expect(res.ingredientes).toHaveLength(1);
      expect(res.midias).toHaveLength(2);
    });

    it('pelo id da original, o comprador recebe a cópia dele', async () => {
      const res: any = await receitas.findOne(originalId, comprador);

      expect(res.id).toBe(copiaId);
      expect(res.compradaDe.id).toBe(originalId);
    });

    it('grava primeiroAcessoEm só na primeira abertura', async () => {
      expect(await primeiroAcesso()).toBeNull();

      await receitas.findOne(copiaId, comprador);
      const primeira = await primeiroAcesso();
      await receitas.findOne(originalId, comprador);

      expect(primeira).not.toBeNull();
      expect(await primeiroAcesso()).toEqual(primeira);
    });

    it('outro usuário vê a prévia da original e não acha a cópia', async () => {
      const previa: any = await receitas.findOne(originalId, outro);
      expect(previa.modoPreparo).toBeUndefined();
      expect(previa.oferta.comprada).toBe(false);

      await expect(receitas.findOne(copiaId, outro)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(receitas.findOne(copiaId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(await primeiroAcesso()).toBeNull();
    });

    it('o vendedor, autor da cópia, não a abre; abre a original inteira', async () => {
      await expect(receitas.findOne(copiaId, vendedor)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      const res: any = await receitas.findOne(originalId, vendedor);
      expect(res.id).toBe(originalId);
      expect(res.modoPreparo).toBe('Misture e asse.');
    });

    it('com a compra reembolsada, a cópia sai do ar para o comprador', async () => {
      await prisma.receitaCompra.update({
        where: { id: compraId },
        data: { status: StatusCompraReceita.reembolsada },
      });

      await expect(receitas.findOne(copiaId, comprador)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const previa: any = await receitas.findOne(originalId, comprador);
      expect(previa.modoPreparo).toBeUndefined();
    });

    it('com o reembolso em análise, o comprador continua abrindo', async () => {
      await prisma.receitaCompra.update({
        where: { id: compraId },
        data: { status: StatusCompraReceita.reembolso_em_analise },
      });

      const res: any = await receitas.findOne(copiaId, comprador);
      expect(res.id).toBe(copiaId);
    });
  });

  describe('GET :id/ingredientes', () => {
    it('o comprador recebe os da cópia, pelo id dela ou da original, e conta como abrir', async () => {
      const pelaCopia = await receitas.findIngredients(copiaId, comprador);
      const pelaOriginal = await receitas.findIngredients(
        originalId,
        comprador,
      );

      expect(pelaCopia).toHaveLength(1);
      expect(pelaOriginal).toEqual(pelaCopia);
      expect(await primeiroAcesso()).not.toBeNull();
    });

    it('outro usuário recebe 403 na original e 404 na cópia', async () => {
      await expect(
        receitas.findIngredients(originalId, outro),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        receitas.findIngredients(copiaId, outro),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('GET compradas', () => {
    it('traz o resumo da cópia sem contar como abrir', async () => {
      const lista: any[] = await compras.compradas(comprador);

      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({
        id: copiaId,
        compradaDe: { id: originalId },
        compra: {
          id: compraId,
          status: StatusCompraReceita.paga,
          precoPago: 29.9,
          primeiroAcessoEm: null,
        },
      });
      expect(lista[0].modoPreparo).toBeUndefined();
      expect(lista[0].midias).toEqual([
        expect.objectContaining({ tipo: TipoMidia.capa }),
      ]);
      expect(await primeiroAcesso()).toBeNull();
    });

    it('não traz a compra reembolsada nem as de outro usuário', async () => {
      expect(await compras.compradas(outro)).toEqual([]);

      await prisma.receitaCompra.update({
        where: { id: compraId },
        data: { status: StatusCompraReceita.reembolsada },
      });
      expect(await compras.compradas(comprador)).toEqual([]);
    });
  });

  describe('GET minhas-vendas', () => {
    it('o vendedor vê a venda com os valores, sem o comprador', async () => {
      const vendas: any[] = await compras.minhasVendas(vendedor);

      expect(vendas).toHaveLength(1);
      expect(vendas[0]).toMatchObject({
        id: compraId,
        receita: { id: originalId },
        status: StatusCompraReceita.paga,
        precoPago: 29.9,
        taxaPlataforma: 4.49,
        valorVendedor: 25.41,
      });
      expect(JSON.stringify(vendas[0])).not.toContain(comprador.id);
      expect(await compras.minhasVendas(comprador)).toEqual([]);
    });
  });

  describe('listagens', () => {
    it('a-venda marca comprada só para quem comprou', async () => {
      const daVez = async (usuario: UsuarioAutenticado) =>
        (await receitas.findAVenda(usuario, { q: sufixo })).find(
          (r) => r.id === originalId,
        );

      expect((await daVez(comprador))?.oferta.comprada).toBe(true);
      expect((await daVez(outro))?.oferta.comprada).toBe(false);
    });

    it('a cópia não aparece em /all nem em /nome, nem para o comprador', async () => {
      const ids = async (busca: () => Promise<Record<string, unknown>[]>) =>
        (await busca().catch(() => [])).map((r) => r.id);

      expect(await ids(() => receitas.findAll(comprador))).not.toContain(
        copiaId,
      );
      expect(
        await ids(() => receitas.findByName(sufixo, comprador)),
      ).not.toContain(copiaId);
    });
  });

  describe('a cópia não muda', () => {
    it.each([
      ['o vendedor', () => vendedor],
      ['o admin', () => admin],
    ])('%s não edita nem exclui a cópia', async (_quem, quem) => {
      await expect(
        receitas.update(copiaId, { nome: 'Outro' }, quem()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(receitas.remove(copiaId, quem())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('o comprador não edita nem exclui a cópia', async () => {
      await expect(
        receitas.update(copiaId, { nome: 'Outro' }, comprador),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(receitas.remove(copiaId, comprador)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    // Por último: a edição devolve a original para a curadoria.
    it('editar a original não altera a cópia', async () => {
      await receitas.update(originalId, { nome: 'Bolo editado' }, vendedor);

      const copia = await prisma.receita.findUniqueOrThrow({
        where: { id: copiaId },
      });
      expect(copia.nome).toBe(`Bolo ${sufixo}`);
    });
  });
});
