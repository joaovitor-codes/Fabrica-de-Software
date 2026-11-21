/// <reference types="jest" />

import 'dotenv/config';
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  StatusAprovacao,
  StatusCompraReceita,
  StatusProduto,
  TipoUsuario,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CacheService } from '../../../../common/cache/cache.service';
import { NotificacaoService } from '../../../notificacao/notificacao.service';
import { TermosService } from '../../../marketplace/termos/termos.service';
import { ProdutoService } from '../../../marketplace/produtos/produto/produto.service';
import { ClinicasService } from '../../clinicas/clinicas.service';
import { ProfissionalService } from '../profissional.service';

/**
 * D4/D5 contra o Postgres de verdade: na aprovação do cadastro profissional,
 * o que o usuário vendia sai do ar e não volta, nem reativando junto com a
 * aprovação.
 */
describe('Profissional aprovado não vende nem anuncia (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let profissionais: ProfissionalService;
  let produtos: ProdutoService;
  let adminId: string;
  let categoriaId: string;
  const contas: string[] = [];
  const usuarios: string[] = [];
  let seq = 0;

  async function criarUsuario(tipoUsuario: TipoUsuario) {
    const conta = await prisma.conta.create({
      data: { email: `vendas-${seq++}-${sufixo}@teste.local`, senhaHash: 'x' },
    });
    const usuario = await prisma.usuario.create({
      data: { contaId: conta.id, nome: `Vendas ${sufixo}`, tipoUsuario },
    });
    contas.push(conta.id);
    usuarios.push(usuario.id);
    return usuario.id;
  }

  async function solicitante() {
    const usuarioId = await criarUsuario(TipoUsuario.comum);
    const { id } = await prisma.profissional.create({
      data: {
        usuarioId,
        registroProfissional: `CRN-${seq++}-${sufixo}`,
        statusAprovacao: StatusAprovacao.pendente,
      },
    });
    return { usuarioId, profissionalId: id };
  }

  async function receitaAVenda(criadoPor: string) {
    const receita = await prisma.receita.create({
      data: { nome: `Bolo ${sufixo}`, criadoPor, status: 'aprovada' },
    });
    const oferta = await prisma.receitaOferta.create({
      data: { receitaId: receita.id, preco: 12.9 },
    });
    return { receita, oferta };
  }

  function produto(vendedorId: string, status: StatusProduto) {
    return prisma.produto.create({
      data: { vendedorId, categoriaId, titulo: `Granola ${sufixo}`, status },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const notificacao = new NotificacaoService(prisma);
    profissionais = new ProfissionalService(
      prisma,
      new ClinicasService(prisma),
      { del: async () => undefined } as unknown as CacheService,
      notificacao,
    );
    produtos = new ProdutoService(prisma, notificacao, {} as TermosService);
    adminId = await criarUsuario(TipoUsuario.admin);
    categoriaId = (
      await prisma.categoriaProduto.create({
        data: { codigo: `cat-${sufixo}`, nome: `Categoria ${sufixo}` },
      })
    ).id;
  });

  afterAll(async () => {
    const where = { usuarioId: { in: usuarios } };
    await prisma.notificacao.deleteMany({ where });
    await prisma.receitaCompra.deleteMany({
      where: { compradorId: { in: usuarios } },
    });
    await prisma.receitaOferta.deleteMany({
      where: { receita: { criadoPor: { in: usuarios } } },
    });
    await prisma.receita.deleteMany({ where: { criadoPor: { in: usuarios } } });
    await prisma.produto.deleteMany({
      where: { vendedorId: { in: usuarios } },
    });
    await prisma.categoriaProduto.deleteMany({ where: { id: categoriaId } });
    await prisma.profissional.deleteMany({ where });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    await prisma.conta.deleteMany({ where: { id: { in: contas } } });
    await prisma.$disconnect();
  });

  it('a aprovação pausa a oferta e o produto, avisa uma vez por item e preserva as compras', async () => {
    const { usuarioId, profissionalId } = await solicitante();
    const { receita, oferta } = await receitaAVenda(usuarioId);
    const ativo = await produto(usuarioId, StatusProduto.ativo);
    const vendido = await produto(usuarioId, StatusProduto.vendido);
    const comprador = await criarUsuario(TipoUsuario.comum);
    const compra = await prisma.receitaCompra.create({
      data: {
        ofertaId: oferta.id,
        compradorId: comprador,
        precoPago: 12.9,
        taxaPlataforma: 1.29,
        versaoComprada: 1,
        conteudoComprado: {},
        status: StatusCompraReceita.paga,
        pagaEm: new Date(),
      },
    });

    await profissionais.aprovarCadastroProfissional(adminId, profissionalId);

    const ofertaFinal = await prisma.receitaOferta.findUniqueOrThrow({
      where: { id: oferta.id },
    });
    expect(ofertaFinal.ativa).toBe(false);
    const status = async (id: string) =>
      (await prisma.produto.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(ativo.id)).toBe(StatusProduto.pausado);
    // Já fora da vitrine: fica como estava.
    expect(await status(vendido.id)).toBe(StatusProduto.vendido);

    const avisos = await prisma.notificacao.findMany({
      where: { usuarioId },
      include: { tipoNotificacao: true },
    });
    expect(
      avisos.map((a) => [a.tipoNotificacao.codigo, a.receitaId ?? a.produtoId]),
    ).toEqual(
      expect.arrayContaining([
        ['receita_venda_pausada', receita.id],
        ['produto_pausado', ativo.id],
      ]),
    );
    expect(avisos).toHaveLength(2);

    const compraFinal = await prisma.receitaCompra.findUniqueOrThrow({
      where: { id: compra.id },
    });
    expect(compraFinal.status).toBe(StatusCompraReceita.paga);

    await expect(
      produtos.ativarProduto(ativo.id, usuarioId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reativar o produto junto com a aprovação: termina fora da vitrine', async () => {
    // Várias reativações espalhadas pela duração da aprovação: alguma confere
    // antes do commit dela e grava depois que ela já leu os produtos.
    for (let rodada = 0; rodada < 20; rodada++) {
      const { usuarioId, profissionalId } = await solicitante();
      const p = await produto(usuarioId, StatusProduto.pausado);
      const espera = () =>
        new Promise((ok) => setTimeout(ok, 20 * Math.random()));

      const [aprovacao, ...reativacoes] = await Promise.allSettled([
        profissionais.aprovarCadastroProfissional(adminId, profissionalId),
        ...Array.from({ length: 8 }, () =>
          espera().then(() => produtos.ativarProduto(p.id, usuarioId)),
        ),
      ]);

      expect(aprovacao.status).toBe('fulfilled');
      for (const r of reativacoes) {
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(ForbiddenException);
        }
      }
      const final = await prisma.produto.findUniqueOrThrow({
        where: { id: p.id },
      });
      expect(final.status).toBe(StatusProduto.pausado);
    }
    // Rodadas o bastante para a corrida aparecer sem a trava, mesmo com a
    // suíte inteira disputando o banco.
  }, 30_000);
});
