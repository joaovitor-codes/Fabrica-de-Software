/// <reference types="jest" />

import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StatusAprovacao, TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { ClinicasService } from '../clinicas/clinicas.service';
import { ProfissionalService } from './profissional.service';

/**
 * Pedidos simultâneos contra o Postgres de verdade: a condição de cada
 * avaliação e associação vai na própria gravação, então só um vence.
 */
describe('Profissional - concorrência (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let service: ProfissionalService;
  const contas: string[] = [];
  const usuarios: string[] = [];
  let seq = 0;

  async function criarUsuario(tipoUsuario: TipoUsuario) {
    const conta = await prisma.conta.create({
      data: { email: `conc-${seq++}-${sufixo}@teste.local`, senhaHash: 'x' },
    });
    const usuario = await prisma.usuario.create({
      data: { contaId: conta.id, nome: `Conc ${sufixo}`, tipoUsuario },
    });
    contas.push(conta.id);
    usuarios.push(usuario.id);
    return usuario;
  }

  async function solicitacaoPendente() {
    const usuario = await criarUsuario(TipoUsuario.comum);
    return prisma.profissional.create({
      data: {
        usuarioId: usuario.id,
        registroProfissional: `CRN-${seq++}-${sufixo}`,
        statusAprovacao: StatusAprovacao.pendente,
      },
    });
  }

  async function profissionalAprovado() {
    const usuario = await criarUsuario(TipoUsuario.profissional);
    return prisma.profissional.create({
      data: {
        usuarioId: usuario.id,
        registroProfissional: `CRN-${seq++}-${sufixo}`,
        statusAprovacao: StatusAprovacao.aprovado,
      },
    });
  }

  /** Quantos pedidos venceram; os demais têm de ser 409. */
  function vencedores(resultados: PromiseSettledResult<unknown>[]) {
    for (const r of resultados) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(ConflictException);
      }
    }
    return resultados.filter((r) => r.status === 'fulfilled').length;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new ProfissionalService(prisma, new ClinicasService(prisma), {
      del: async () => undefined,
    } as unknown as CacheService);
  });

  afterAll(async () => {
    await prisma.paciente.deleteMany({
      where: { usuarioId: { in: usuarios } },
    });
    await prisma.profissional.deleteMany({
      where: { usuarioId: { in: usuarios } },
    });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    await prisma.conta.deleteMany({ where: { id: { in: contas } } });
    await prisma.$disconnect();
  });

  it('aprovar e rejeitar ao mesmo tempo: só um vence, e a conta segue o status', async () => {
    const admin = (await criarUsuario(TipoUsuario.admin)).id;

    for (let rodada = 0; rodada < 10; rodada++) {
      const solicitacao = await solicitacaoPendente();
      const pedidos =
        rodada % 2
          ? [
              service.aprovarCadastroProfissional(admin, solicitacao.id),
              service.rejeitarCadastroProfissional(admin, solicitacao.id),
            ]
          : [
              service.rejeitarCadastroProfissional(admin, solicitacao.id),
              service.aprovarCadastroProfissional(admin, solicitacao.id),
            ];

      expect(vencedores(await Promise.allSettled(pedidos))).toBe(1);

      const final = await prisma.profissional.findUniqueOrThrow({
        where: { id: solicitacao.id },
        include: { usuario: true },
      });
      expect(final.usuario.tipoUsuario).toBe(
        final.statusAprovacao === StatusAprovacao.aprovado
          ? TipoUsuario.profissional
          : TipoUsuario.comum,
      );
    }
  });

  it('cinco aprovações simultâneas: uma vence, as outras recebem 409', async () => {
    const admin = (await criarUsuario(TipoUsuario.admin)).id;
    const solicitacao = await solicitacaoPendente();

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.aprovarCadastroProfissional(admin, solicitacao.id),
      ),
    );

    expect(vencedores(resultados)).toBe(1);
  });

  it('dois profissionais associando o mesmo paciente: só um fica com ele', async () => {
    const [a, b] = await Promise.all([
      profissionalAprovado(),
      profissionalAprovado(),
    ]);
    const paciente = await prisma.paciente.create({
      data: { usuarioId: (await criarUsuario(TipoUsuario.paciente)).id },
    });

    const resultados = await Promise.allSettled(
      [a, b, a, b].map((p) => service.associarPaciente(p.id, paciente.id)),
    );

    const final = await prisma.paciente.findUniqueOrThrow({
      where: { id: paciente.id },
    });
    const venceu = final.profissionalId;
    expect([a.id, b.id]).toContain(venceu);
    // Os pedidos do vencedor dão 200 (repetir a associação é idempotente);
    // os do outro, 409.
    resultados.forEach((r, i) => {
      const deQuem = [a, b, a, b][i].id;
      if (deQuem === venceu) {
        expect(r.status).toBe('fulfilled');
      } else {
        expect(r.status).toBe('rejected');
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
          ConflictException,
        );
      }
    });
  });

  it('solicitação em duplo clique: uma é criada, a outra recebe 409', async () => {
    const usuario = await criarUsuario(TipoUsuario.comum);

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.solicitarCadastroProfissional(usuario.id, {
          registroProfissional: `CRN-${seq++}-${sufixo}`,
        }),
      ),
    );

    expect(vencedores(resultados)).toBe(1);
    expect(
      await prisma.profissional.count({ where: { usuarioId: usuario.id } }),
    ).toBe(1);
  });
});
