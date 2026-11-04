/// <reference types="jest" />

import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MailerService } from '@nestjs-modules/mailer';
import { randomUUID } from 'crypto';
import { StatusAprovacao, StatusReceita, TipoUsuario } from '@prisma/client';
import { AuthService } from '../../../auth/auth.service';
import { CacheService } from '../../../common/cache/cache.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ClinicasService } from '../../identidade/clinicas/clinicas.service';
import { ProfissionalService } from '../../identidade/profissional/profissional.service';
import { PontosTransacaoService } from '../pontos-transacao/pontos-transacao.service';
import { CuradoriaReceitaService } from './curadoria-receita.service';

/**
 * Roda contra o Postgres de verdade: o trigger que liga o cadastro aprovado
 * ao tipo da conta e a disputa entre dois curadores só existem lá.
 * Grava dados com um sufixo próprio e apaga tudo no fim.
 */
describe('Aprovação do profissional e curadoria (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  const dto = { registroProfissional: 'CRN-6 12345' };
  let prisma: PrismaService;
  let profissionais: ProfissionalService;
  let curadoria: CuradoriaReceitaService;
  let auth: AuthService;
  let adminId: string;
  let autorId: string;

  /** Cache de verdade em memória: o /auth/me precisa ver a limpeza. */
  const guardado = new Map<string, unknown>();
  const cache = {
    get: async (chave: string) => guardado.get(chave),
    set: async (chave: string, valor: unknown) => {
      guardado.set(chave, valor);
    },
    del: async (chave: string) => {
      guardado.delete(chave);
    },
  } as unknown as CacheService;

  const ids = { contas: [] as string[], usuarios: [] as string[] };
  let seq = 0;

  async function criarUsuario(tipoUsuario: TipoUsuario) {
    const conta = await prisma.conta.create({
      data: {
        email: `curadoria-${sufixo}-${seq++}@teste.local`,
        senhaHash: 'x',
      },
    });
    const usuario = await prisma.usuario.create({
      data: { contaId: conta.id, nome: 'Teste', tipoUsuario },
    });
    ids.contas.push(conta.id);
    ids.usuarios.push(usuario.id);
    return usuario.id;
  }

  async function criarCurador() {
    const usuarioId = await criarUsuario(TipoUsuario.comum);
    const { id } = await profissionais.solicitarCadastroProfissional(
      usuarioId,
      dto,
    );
    await profissionais.aprovarCadastroProfissional(adminId, id);
    return { usuarioId, profissionalId: id };
  }

  const tipoDaConta = async (id: string) =>
    (await prisma.usuario.findUniqueOrThrow({ where: { id } })).tipoUsuario;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    profissionais = new ProfissionalService(
      prisma,
      {} as unknown as ClinicasService,
      cache,
    );
    curadoria = new CuradoriaReceitaService(
      prisma,
      cache,
      new PontosTransacaoService(prisma),
    );
    auth = new AuthService(
      prisma,
      {} as unknown as JwtService,
      {} as unknown as ConfigService,
      {} as unknown as MailerService,
      cache,
    );
    adminId = await criarUsuario(TipoUsuario.admin);
    autorId = await criarUsuario(TipoUsuario.comum);
  });

  afterAll(async () => {
    const donos = { usuarioId: { in: ids.usuarios } };
    await prisma.pontosTransacao.deleteMany({
      where: { profissional: donos },
    });
    await prisma.receita.deleteMany({
      where: { criadoPor: { in: ids.usuarios } },
    });
    await prisma.profissional.deleteMany({ where: donos });
    await prisma.usuario.deleteMany({ where: { id: { in: ids.usuarios } } });
    await prisma.conta.deleteMany({ where: { id: { in: ids.contas } } });
    await prisma.$disconnect();
  });

  it('a conta só vira profissional quando o admin aprova', async () => {
    const usuarioId = await criarUsuario(TipoUsuario.comum);

    const { id } = await profissionais.solicitarCadastroProfissional(
      usuarioId,
      dto,
    );
    expect(await tipoDaConta(usuarioId)).toBe(TipoUsuario.comum);

    await profissionais.aprovarCadastroProfissional(adminId, id);
    expect(await tipoDaConta(usuarioId)).toBe(TipoUsuario.profissional);
  });

  it('solicitação rejeitada e reaberta promove a conta ao ser aprovada', async () => {
    const usuarioId = await criarUsuario(TipoUsuario.comum);
    const { id } = await profissionais.solicitarCadastroProfissional(
      usuarioId,
      dto,
    );

    await profissionais.rejeitarCadastroProfissional(adminId, id);
    expect(await tipoDaConta(usuarioId)).toBe(TipoUsuario.comum);

    await profissionais.solicitarCadastroProfissional(usuarioId, dto);
    await profissionais.aprovarCadastroProfissional(adminId, id);
    expect(await tipoDaConta(usuarioId)).toBe(TipoUsuario.profissional);
  });

  it('o /auth/me acompanha cada etapa, mesmo já estando em cache', async () => {
    const usuarioId = await criarUsuario(TipoUsuario.comum);
    const me = () =>
      auth.me(usuarioId) as Promise<{
        tipoUsuario: TipoUsuario;
        profissional: { statusAprovacao: StatusAprovacao } | null;
      }>;

    expect(await me()).toMatchObject({
      tipoUsuario: TipoUsuario.comum,
      profissional: null,
    });

    const { id } = await profissionais.solicitarCadastroProfissional(
      usuarioId,
      dto,
    );
    expect(await me()).toMatchObject({
      tipoUsuario: TipoUsuario.comum,
      profissional: { statusAprovacao: StatusAprovacao.pendente },
    });

    await profissionais.rejeitarCadastroProfissional(adminId, id);
    expect(await me()).toMatchObject({
      tipoUsuario: TipoUsuario.comum,
      profissional: { statusAprovacao: StatusAprovacao.rejeitado },
    });

    await profissionais.solicitarCadastroProfissional(usuarioId, dto);
    await me();
    await profissionais.aprovarCadastroProfissional(adminId, id);
    expect(await me()).toMatchObject({
      tipoUsuario: TipoUsuario.profissional,
      profissional: { statusAprovacao: StatusAprovacao.aprovado },
    });
  });

  it('o banco recusa cadastro aprovado em conta que não é profissional', async () => {
    const usuarioId = await criarUsuario(TipoUsuario.comum);
    const { id } = await profissionais.solicitarCadastroProfissional(
      usuarioId,
      dto,
    );

    await expect(
      prisma.profissional.update({
        where: { id },
        data: { statusAprovacao: StatusAprovacao.aprovado },
      }),
    ).rejects.toThrow('precisa ser do tipo profissional');
  });

  it('com dois curadores ao mesmo tempo, só um decide e ganha pontos', async () => {
    const [primeiro, segundo] = [await criarCurador(), await criarCurador()];
    const { id } = await prisma.receita.create({
      data: {
        nome: `Omelete ${sufixo}`,
        criadoPor: autorId,
        status: StatusReceita.pendente,
      },
    });

    const resultados = await Promise.allSettled([
      curadoria.aprovarReceita(id, primeiro.usuarioId),
      curadoria.rejeitarReceita(id, segundo.usuarioId),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const transacoes = await prisma.pontosTransacao.findMany({
      where: {
        profissionalId: {
          in: [primeiro.profissionalId, segundo.profissionalId],
        },
      },
    });
    expect(transacoes).toHaveLength(1);
  });
});
