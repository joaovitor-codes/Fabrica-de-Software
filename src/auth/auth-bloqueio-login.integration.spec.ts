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
 * Bloqueio de login por e-mail, contra o Postgres de verdade: no máximo
 * LOGIN_MAX_FAILED_ATTEMPTS tentativas por janela, mesmo com tentativas
 * simultâneas e com e-mail que não existe.
 */
describe('Login - bloqueio por tentativas (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  const MAX = 3;
  const SENHA = 'senha-certa-123';
  const BLOQUEIO = 'Muitas tentativas de login';
  let prisma: PrismaService;
  let auth: AuthService;
  const contas: string[] = [];
  const emails: string[] = [];

  async function criarConta() {
    const email = `login-${contas.length}-${sufixo}@teste.local`;
    const conta = await prisma.conta.create({
      data: { email, senhaHash: await bcrypt.hash(SENHA, 4) },
    });
    await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Login',
        tipoUsuario: TipoUsuario.comum,
      },
    });
    contas.push(conta.id);
    emails.push(email);
    return email;
  }

  const entrar = (email: string, password: string) =>
    auth.signIn({ email, password }, { ipAddress: '10.0.0.1' });

  const bloqueado = (e: unknown) =>
    e instanceof HttpException && e.getStatus() === 429;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const config = {
      get: (chave: string) =>
        ({
          LOGIN_MAX_FAILED_ATTEMPTS: MAX,
          LOGIN_LOCKOUT_MINUTES: 15,
          JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
          JWT_EXPIRES_IN: '1h',
          JWT_REFRESH_EXPIRES_IN: '7d',
        })[chave],
    } as unknown as ConfigService;
    auth = new AuthService(
      prisma,
      new JwtService({ secret: 'segredo-de-teste-com-mais-de-32-caracteres' }),
      config,
      {} as MailerService,
      { del: async () => undefined } as unknown as CacheService,
    );
  });

  afterAll(async () => {
    await prisma.tentativaLogin.deleteMany({
      where: { emailTentado: { in: emails } },
    });
    await prisma.sessao.deleteMany({ where: { contaId: { in: contas } } });
    await prisma.usuario.deleteMany({ where: { contaId: { in: contas } } });
    await prisma.conta.deleteMany({ where: { id: { in: contas } } });
    await prisma.$disconnect();
  });

  it('depois de MAX senhas erradas, nem a senha certa entra (429)', async () => {
    const email = await criarConta();
    for (let i = 0; i < MAX; i++) {
      await expect(entrar(email, 'errada')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }

    await expect(entrar(email, SENHA)).rejects.toThrow(BLOQUEIO);
  });

  it('login certo zera a contagem', async () => {
    const email = await criarConta();
    for (let i = 0; i < MAX - 1; i++) {
      await expect(entrar(email, 'errada')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    await expect(entrar(email, SENHA)).resolves.toHaveProperty('accessToken');

    for (let i = 0; i < MAX - 1; i++) {
      await expect(entrar(email, 'errada')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    await expect(entrar(email, SENHA)).resolves.toHaveProperty('accessToken');
  });

  it('30 tentativas simultâneas: no máximo MAX chegam a conferir a senha', async () => {
    const email = await criarConta();

    const resultados = await Promise.allSettled(
      Array.from({ length: 30 }, () => entrar(email, 'errada')),
    );

    // Conta existente com senha errada: 401 só depois de conferir a senha.
    const conferidas = resultados.filter(
      (r) =>
        r.status === 'rejected' && r.reason instanceof UnauthorizedException,
    );
    const barradas = resultados.filter(
      (r) => r.status === 'rejected' && bloqueado(r.reason),
    );
    expect(conferidas.length).toBeLessThanOrEqual(MAX);
    expect(conferidas.length + barradas.length).toBe(30);

    // As barradas não contam (nem chegaram à senha). Somando as conferidas
    // na rajada e as seguintes, o total de senhas testadas é exatamente MAX.
    let seguintes = 0;
    for (;;) {
      try {
        await entrar(email, 'errada');
      } catch (e) {
        if (e instanceof UnauthorizedException) {
          seguintes++;
          continue;
        }
        expect(e).toBeInstanceOf(HttpException);
        break;
      }
    }
    expect(conferidas.length + seguintes).toBe(MAX);
    await expect(entrar(email, SENHA)).rejects.toThrow(BLOQUEIO);
  });

  it('e-mail sem conta também bloqueia, sem revelar que a conta não existe', async () => {
    const email = `ninguem-${sufixo}@teste.local`;
    emails.push(email);
    for (let i = 0; i < MAX; i++) {
      await expect(entrar(email, 'qualquer')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }

    await expect(entrar(email, 'qualquer')).rejects.toThrow(BLOQUEIO);
  });

  it('troca de senha pelo e-mail libera a conta bloqueada', async () => {
    const email = await criarConta();
    for (let i = 0; i < MAX; i++) {
      await entrar(email, 'errada').catch(() => undefined);
    }
    await expect(entrar(email, SENHA)).rejects.toThrow(BLOQUEIO);

    const conta = await prisma.conta.findUniqueOrThrow({ where: { email } });
    await prisma.tokenResetSenha.create({
      data: {
        contaId: conta.id,
        token: `reset-${sufixo}-${randomUUID()}`,
        expiraEm: new Date(Date.now() + 60_000),
        usadoEm: new Date(),
      },
    });

    await expect(entrar(email, SENHA)).resolves.toHaveProperty('accessToken');
    await prisma.tokenResetSenha.deleteMany({ where: { contaId: conta.id } });
  });
});
