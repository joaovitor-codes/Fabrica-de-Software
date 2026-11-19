/// <reference types="jest" />

import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { TipoConsentimento, TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TermosService } from './termos.service';

/** Aceite dos termos em duplo clique, contra o Postgres de verdade. */
describe('Termos - aceite concorrente (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let termos: TermosService;
  let contaId: string;
  let usuarioId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    termos = new TermosService(prisma, {
      getOrThrow: () => `teste-${sufixo}`,
    } as unknown as ConfigService);
    contaId = (
      await prisma.conta.create({
        data: { email: `termos-${sufixo}@teste.local`, senhaHash: 'x' },
      })
    ).id;
    usuarioId = (
      await prisma.usuario.create({
        data: { contaId, nome: 'Termos', tipoUsuario: TipoUsuario.comum },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.consentimentoLgpd.deleteMany({ where: { usuarioId } });
    await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    await prisma.conta.deleteMany({ where: { id: contaId } });
    await prisma.$disconnect();
  });

  it('dez aceites juntos gravam um só, e todos devolvem o mesmo', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () =>
        termos.aceitar(usuarioId, `teste-${sufixo}`),
      ),
    );

    expect(new Set(resultados.map((r) => r.id)).size).toBe(1);
    expect(
      await prisma.consentimentoLgpd.count({
        where: {
          usuarioId,
          tipoConsentimento: TipoConsentimento.termos_marketplace,
        },
      }),
    ).toBe(1);
  });
});
