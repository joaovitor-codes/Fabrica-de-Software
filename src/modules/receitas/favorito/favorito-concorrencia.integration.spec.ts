/// <reference types="jest" />

import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StatusReceita, TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import { FavoritoService } from './favorito.service';

/** Duplo clique em favoritar, contra o Postgres de verdade. */
describe('Favorito - concorrência (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let service: FavoritoService;
  let usuario: UsuarioAutenticado;
  let contaId: string;
  let receitaId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new FavoritoService(
      prisma,
      new VisibilidadeReceitaService(prisma),
    );

    const conta = await prisma.conta.create({
      data: { email: `fav-${sufixo}@teste.local`, senhaHash: 'x' },
    });
    contaId = conta.id;
    const criado = await prisma.usuario.create({
      data: { contaId, nome: `Fav ${sufixo}`, tipoUsuario: TipoUsuario.comum },
    });
    usuario = { ...criado, sub: criado.id };
    receitaId = (
      await prisma.receita.create({
        data: {
          nome: `Bolo ${sufixo}`,
          criadoPor: criado.id,
          status: StatusReceita.aprovada,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.favorito.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.receita.deleteMany({ where: { id: receitaId } });
    await prisma.usuario.deleteMany({ where: { id: usuario.id } });
    await prisma.conta.deleteMany({ where: { id: contaId } });
    await prisma.$disconnect();
  });

  it('cinco pedidos simultâneos: um favorita, os outros recebem 409', async () => {
    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () => service.addFavorite(receitaId, usuario)),
    );

    const recusados = resultados.filter((r) => r.status === 'rejected');
    expect(resultados.length - recusados.length).toBe(1);
    for (const r of recusados) {
      expect(r.reason).toBeInstanceOf(ConflictException);
    }
    expect(
      await prisma.favorito.count({ where: { usuarioId: usuario.id } }),
    ).toBe(1);
  });
});
