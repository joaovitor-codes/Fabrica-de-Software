/// <reference types="jest" />

import 'dotenv/config';
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StatusProduto, TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { NotificacaoService } from '../../../notificacao/notificacao.service';
import { TermosService } from '../../termos/termos.service';
import { ProdutoService } from './produto.service';

/**
 * O vendedor mexendo no status junto com a moderação, contra o Postgres de
 * verdade: produto removido não volta à vitrine, e o vendedor é avisado da
 * remoção uma vez só.
 */
describe('Produto - concorrência com a moderação (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let service: ProdutoService;
  let vendedorId: string;
  let contaId: string;
  let categoriaId: string;
  const produtos: string[] = [];

  async function produto() {
    const p = await prisma.produto.create({
      data: {
        vendedorId,
        categoriaId,
        titulo: `Granola ${sufixo}`,
        status: StatusProduto.ativo,
      },
    });
    produtos.push(p.id);
    return p;
  }

  const notificacoesDe = (produtoId: string) =>
    prisma.notificacao.count({
      where: { usuarioId: vendedorId, produtoId },
    });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new ProdutoService(
      prisma,
      new NotificacaoService(prisma),
      {} as TermosService,
    );
    const conta = await prisma.conta.create({
      data: { email: `vend-${sufixo}@teste.local`, senhaHash: 'x' },
    });
    contaId = conta.id;
    vendedorId = (
      await prisma.usuario.create({
        data: { contaId, nome: 'Vendedor', tipoUsuario: TipoUsuario.comum },
      })
    ).id;
    categoriaId = (
      await prisma.categoriaProduto.create({
        data: { codigo: `cat-${sufixo}`, nome: `Categoria ${sufixo}` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.notificacao.deleteMany({ where: { usuarioId: vendedorId } });
    await prisma.produto.deleteMany({ where: { id: { in: produtos } } });
    await prisma.categoriaProduto.deleteMany({ where: { id: categoriaId } });
    await prisma.usuario.deleteMany({ where: { id: vendedorId } });
    await prisma.conta.deleteMany({ where: { id: contaId } });
    await prisma.$disconnect();
  });

  it('ativar e pausar junto com a remoção: o produto termina removido', async () => {
    for (let rodada = 0; rodada < 15; rodada++) {
      const p = await produto();
      const espera = () =>
        new Promise((ok) => setTimeout(ok, 5 * Math.random()));

      const resultados = await Promise.allSettled([
        espera().then(() => service.ativarProduto(p.id, vendedorId)),
        espera().then(() => service.removerProduto(p.id)),
        espera().then(() => service.desativarProduto(p.id, vendedorId)),
        espera().then(() => service.ativarProduto(p.id, vendedorId)),
      ]);

      for (const r of resultados) {
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(ForbiddenException);
        }
      }
      const final = await prisma.produto.findUniqueOrThrow({
        where: { id: p.id },
      });
      expect(final.status).toBe(StatusProduto.removido);
      expect(await notificacoesDe(p.id)).toBe(1);
    }
  });

  it('cinco remoções juntas avisam o vendedor uma vez', async () => {
    const p = await produto();

    await Promise.all(
      Array.from({ length: 5 }, () => service.removerProduto(p.id)),
    );

    expect(await notificacoesDe(p.id)).toBe(1);
  });
});
