/// <reference types="jest" />

import 'dotenv/config';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MailerService } from '@nestjs-modules/mailer';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { TipoUsuario } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CacheService } from '../common/cache/cache.service';
import { AuthService } from './auth.service';

/**
 * Refresh e reenvio de código com pedidos simultâneos, contra o Postgres de
 * verdade.
 */
describe('Auth - concorrência (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-certa-123';
  const MAX_REENVIOS = 3;
  let prisma: PrismaService;
  let auth: AuthService;
  const emailsEnviados: string[] = [];
  const contas: string[] = [];
  const emails: string[] = [];

  async function criarConta() {
    const email = `conc-${contas.length}-${sufixo}@teste.local`;
    const conta = await prisma.conta.create({
      data: { email, senhaHash: await bcrypt.hash(SENHA, 4) },
    });
    await prisma.usuario.create({
      data: { contaId: conta.id, nome: 'Conc', tipoUsuario: TipoUsuario.comum },
    });
    contas.push(conta.id);
    emails.push(email);
    return email;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const valores: Record<string, unknown> = {
      JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
      JWT_EXPIRES_IN: '1h',
      JWT_REFRESH_EXPIRES_IN: '7d',
      EMAIL_VERIFICATION_MAX_RESEND_ATTEMPTS: MAX_REENVIOS,
    };
    const config = {
      get: (chave: string, padrao?: unknown) => valores[chave] ?? padrao,
    } as unknown as ConfigService;
    auth = new AuthService(
      prisma,
      new JwtService({ secret: valores.JWT_SECRET as string }),
      config,
      {
        sendMail: async ({ to }: { to: string }) => {
          emailsEnviados.push(to);
        },
      } as unknown as MailerService,
      { del: async () => undefined } as unknown as CacheService,
    );
  });

  afterAll(async () => {
    await prisma.tentativaLogin.deleteMany({
      where: { emailTentado: { in: emails } },
    });
    await prisma.tokenVerificacaoEmail.deleteMany({
      where: { contaId: { in: contas } },
    });
    await prisma.sessao.deleteMany({ where: { contaId: { in: contas } } });
    await prisma.usuario.deleteMany({ where: { contaId: { in: contas } } });
    await prisma.conta.deleteMany({ where: { id: { in: contas } } });
    await prisma.$disconnect();
  });

  it('cinco refresh juntos com o mesmo token: um troca, os outros recebem 401', async () => {
    const email = await criarConta();
    const { refreshToken } = await auth.signIn(
      { email, password: SENHA },
      { ipAddress: '10.0.0.1' },
    );

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () => auth.refreshToken(refreshToken)),
    );

    const ok = resultados.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    for (const r of resultados) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(UnauthorizedException);
      }
    }
    // O token que saiu do refresh vencedor continua valendo; o antigo não.
    const novo = (ok[0] as PromiseFulfilledResult<{ refreshToken: string }>)
      .value.refreshToken;
    await expect(auth.refreshToken(novo)).resolves.toHaveProperty(
      'accessToken',
    );
    await expect(auth.refreshToken(refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('quinze reenvios juntos: no máximo o limite de códigos e e-mails', async () => {
    const email = await criarConta();
    const enviadosAntes = emailsEnviados.filter((e) => e === email).length;

    const resultados = await Promise.allSettled(
      Array.from({ length: 15 }, () => auth.resendEmailVerification({ email })),
    );

    for (const r of resultados) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(HttpException);
        expect((r.reason as HttpException).getStatus()).toBe(429);
      }
    }
    const conta = await prisma.conta.findUniqueOrThrow({ where: { email } });
    const codigos = await prisma.tokenVerificacaoEmail.count({
      where: { contaId: conta.id },
    });
    const enviados =
      emailsEnviados.filter((e) => e === email).length - enviadosAntes;
    expect(codigos).toBeLessThanOrEqual(MAX_REENVIOS);
    expect(enviados).toBe(codigos);
    expect(resultados.filter((r) => r.status === 'fulfilled').length).toBe(
      enviados,
    );
  });
});
