/// <reference types="jest" />

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CODIGOS_NOTIFICACAO } from './dtos/notificacao.types';

/**
 * Roda contra o Postgres de verdade (no CI: banco nutrify_test com as
 * migrations aplicadas). Nenhum insert daqui é gravado: o Postgres avalia a
 * CHECK antes das FKs, então os UUIDs aleatórios só chegam a violar a FK
 * quando o arco está correto.
 */
describe('Notificação (integração com Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Insere direto, sem passar pelo serviço, e devolve o código de erro do Postgres. */
  async function codigoErroAoInserir(
    referencias: Partial<Record<'receita_id' | 'produto_id', string>>,
  ): Promise<string | undefined> {
    try {
      await prisma.$executeRaw`
        INSERT INTO notificacoes (usuario_id, tipo_notificacao_id, titulo, receita_id, produto_id)
        VALUES (
          ${randomUUID()}::uuid,
          ${randomUUID()}::uuid,
          'teste',
          ${referencias.receita_id ?? null}::uuid,
          ${referencias.produto_id ?? null}::uuid
        )`;
      return undefined;
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError) {
        return (erro.meta as { code?: string } | undefined)?.code;
      }
      throw erro;
    }
  }

  it('a migration cadastra os 4 tipos de notificação do marketplace', async () => {
    const tipos = await prisma.tipoNotificacao.findMany({
      where: { codigo: { in: [...CODIGOS_NOTIFICACAO] } },
    });

    expect(tipos.map((t) => t.codigo).sort()).toEqual(
      [...CODIGOS_NOTIFICACAO].sort(),
    );
  });

  it('a CHECK chk_notificacao_exclusive_arc recusa duas referências', async () => {
    await expect(
      codigoErroAoInserir({
        receita_id: randomUUID(),
        produto_id: randomUUID(),
      }),
    ).resolves.toBe('23514');
  });

  it('a CHECK chk_notificacao_exclusive_arc recusa nenhuma referência', async () => {
    await expect(codigoErroAoInserir({})).resolves.toBe('23514');
  });

  it('com uma referência a CHECK passa (o erro seguinte já é de FK)', async () => {
    await expect(
      codigoErroAoInserir({ produto_id: randomUUID() }),
    ).resolves.toBe('23503');
  });
});
