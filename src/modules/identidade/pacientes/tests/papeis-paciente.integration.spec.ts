/// <reference types="jest" />

import 'dotenv/config';
import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MailerService } from '@nestjs-modules/mailer';
import { randomUUID } from 'crypto';
import { StatusAprovacao, TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CacheService } from '../../../../common/cache/cache.service';
import { AuthService } from '../../../../auth/auth.service';
import { NotificacaoService } from '../../../notificacao/notificacao.service';
import { TermosService } from '../../../marketplace/termos/termos.service';
import { ProdutoService } from '../../../marketplace/produtos/produto/produto.service';
import { DiarioDeSintomasService } from '../../../acompanhamento/diario-de-sintomas/diario-de-sintomas.service';
import { restricoesDoUsuario } from '../../../receitas/visibilidade/restricoes-receita';
import { ClinicasService } from '../../clinicas/clinicas.service';
import { ProfissionalService } from '../../profissional/profissional.service';
import { PacientesService } from '../pacientes.service';

/**
 * Papéis derivados dos registros (#168), contra o Postgres de verdade: o
 * profissional também pode ser paciente (de outro nutricionista, nunca de
 * si mesmo), sem perder o tipo nem a ética da D4/D5.
 */
describe('Papéis derivados dos registros (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let pacientes: PacientesService;
  let profissionais: ProfissionalService;
  let auth: AuthService;
  let diario: DiarioDeSintomasService;
  let produtos: ProdutoService;
  let restricaoId: string;
  let categoriaId: string;
  const contas: string[] = [];
  const usuarios: string[] = [];
  let seq = 0;

  const cache = {
    get: async () => undefined,
    set: async () => undefined,
    del: async () => undefined,
  } as unknown as CacheService;

  async function criarUsuario(tipoUsuario: TipoUsuario) {
    const conta = await prisma.conta.create({
      data: { email: `papeis-${seq++}-${sufixo}@teste.local`, senhaHash: 'x' },
    });
    const usuario = await prisma.usuario.create({
      data: { contaId: conta.id, nome: `Papéis ${sufixo}`, tipoUsuario },
    });
    contas.push(conta.id);
    usuarios.push(usuario.id);
    return usuario.id;
  }

  async function profissionalAprovado() {
    const usuarioId = await criarUsuario(TipoUsuario.profissional);
    const { id } = await prisma.profissional.create({
      data: {
        usuarioId,
        registroProfissional: `CRN-${seq++}-${sufixo}`,
        statusAprovacao: StatusAprovacao.aprovado,
      },
    });
    return { usuarioId, profissionalId: id };
  }

  const tipoDa = async (id: string) =>
    (await prisma.usuario.findUniqueOrThrow({ where: { id } })).tipoUsuario;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const notificacao = new NotificacaoService(prisma);
    pacientes = new PacientesService(prisma, cache);
    profissionais = new ProfissionalService(
      prisma,
      new ClinicasService(prisma),
      cache,
      notificacao,
    );
    auth = new AuthService(
      prisma,
      {} as JwtService,
      {} as ConfigService,
      {} as MailerService,
      cache,
    );
    diario = new DiarioDeSintomasService(prisma);
    produtos = new ProdutoService(prisma, notificacao, {
      garantirAceite: async () => undefined,
    } as unknown as TermosService);

    restricaoId = (
      await prisma.restricaoAlimentar.create({
        data: { nome: `Lactose ${sufixo}`, tipo: 'intolerancia' },
      })
    ).id;
    categoriaId = (
      await prisma.categoriaProduto.create({
        data: { codigo: `cat-${sufixo}`, nome: `Categoria ${sufixo}` },
      })
    ).id;
  });

  afterAll(async () => {
    const where = { usuarioId: { in: usuarios } };
    await prisma.pacienteRestricao.deleteMany({ where: { restricaoId } });
    await prisma.diarioSintoma.deleteMany({ where: { paciente: where } });
    await prisma.produto.deleteMany({
      where: { vendedorId: { in: usuarios } },
    });
    await prisma.paciente.deleteMany({ where });
    await prisma.profissional.deleteMany({ where });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    await prisma.conta.deleteMany({ where: { id: { in: contas } } });
    await prisma.restricaoAlimentar.deleteMany({ where: { id: restricaoId } });
    await prisma.categoriaProduto.deleteMany({ where: { id: categoriaId } });
    await prisma.$disconnect();
  });

  describe('profissional que também é paciente', () => {
    let eu: { usuarioId: string; profissionalId: string };
    let meuNutri: { usuarioId: string; profissionalId: string };
    let pacienteId: string;

    beforeAll(async () => {
      eu = await profissionalAprovado();
      meuNutri = await profissionalAprovado();
      pacienteId = (
        await pacientes.createPaciente({
          userId: eu.usuarioId,
          profissionalId: meuNutri.profissionalId,
        })
      ).id;
      await prisma.pacienteRestricao.create({
        data: { pacienteId, restricaoId },
      });
    });

    it('continua profissional e ganha o papel de paciente (inclusive no /auth/me)', async () => {
      expect(await tipoDa(eu.usuarioId)).toBe(TipoUsuario.profissional);
      const me = (await auth.me(eu.usuarioId)) as { papeis: TipoUsuario[] };
      expect(me.papeis).toEqual([
        TipoUsuario.profissional,
        TipoUsuario.paciente,
      ]);
      expect(me).not.toHaveProperty('paciente');
    });

    it('as restrições dele valem no filtro e na compra', async () => {
      const comPapeis = await restricoesDoUsuario(prisma, {
        id: eu.usuarioId,
        papeis: [TipoUsuario.profissional, TipoUsuario.paciente],
      });
      const semPapeis = await restricoesDoUsuario(prisma, {
        id: eu.usuarioId,
      });
      for (const restricoes of [comPapeis, semPapeis]) {
        expect(restricoes.map((r) => r.restricaoId)).toEqual([restricaoId]);
      }
    });

    it('usa o próprio diário de sintomas; outro profissional não', async () => {
      await expect(
        diario.criarDiarioDeSintomas(
          pacienteId,
          { observacao: 'Inchaço' },
          eu.usuarioId,
          TipoUsuario.profissional,
        ),
      ).resolves.toBeDefined();
      await expect(
        diario.findAllPorPacienteId(
          pacienteId,
          eu.usuarioId,
          TipoUsuario.profissional,
          1,
          10,
        ),
      ).resolves.toHaveLength(1);

      const estranho = await profissionalAprovado();
      await expect(
        diario.findAllPorPacienteId(
          pacienteId,
          estranho.usuarioId,
          TipoUsuario.profissional,
          1,
          10,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // O responsável segue vendo.
      await expect(
        diario.findAllPorPacienteId(
          pacienteId,
          meuNutri.usuarioId,
          TipoUsuario.profissional,
          1,
          10,
        ),
      ).resolves.toHaveLength(1);
    });

    it('a ética vence o papel de paciente: não anuncia produto (D5)', async () => {
      await expect(
        produtos.createProduto(eu.usuarioId, {
          categoriaId,
          titulo: 'Granola',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('apagar o registro de paciente tira só o papel; a conta segue profissional', async () => {
      const outro = await profissionalAprovado();
      await pacientes.createPaciente({
        userId: outro.usuarioId,
        profissionalId: meuNutri.profissionalId,
      });

      await pacientes.deletePaciente(outro.usuarioId);

      expect(await tipoDa(outro.usuarioId)).toBe(TipoUsuario.profissional);
      expect(
        await prisma.paciente.count({ where: { usuarioId: outro.usuarioId } }),
      ).toBe(0);
    });
  });

  describe('ninguém é paciente de si mesmo', () => {
    it('o admin não cria o paciente com o próprio usuário como responsável', async () => {
      const eu = await profissionalAprovado();

      await expect(
        pacientes.createPaciente({
          userId: eu.usuarioId,
          profissionalId: eu.profissionalId,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(
        await prisma.paciente.count({ where: { usuarioId: eu.usuarioId } }),
      ).toBe(0);
    });

    it('nem passa a ser responsável por si mesmo depois (admin, associar ou direto no banco)', async () => {
      const eu = await profissionalAprovado();
      const { id: pacienteId } = await pacientes.createPaciente({
        userId: eu.usuarioId,
        profissionalId: null as unknown as string,
      });

      await expect(
        pacientes.updatePaciente(
          { profissionalId: eu.profissionalId },
          eu.usuarioId,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(
        profissionais.associarPaciente(eu.profissionalId, pacienteId),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      // A rede de segurança do banco (trigger check_tipo_paciente).
      await expect(
        prisma.paciente.update({
          where: { id: pacienteId },
          data: { profissionalId: eu.profissionalId },
        }),
      ).rejects.toThrow(/proprio registro de paciente/);

      const final = await prisma.paciente.findUniqueOrThrow({
        where: { id: pacienteId },
      });
      expect(final.profissionalId).toBeNull();

      // Outro profissional associa normalmente.
      const outro = await profissionalAprovado();
      await expect(
        profissionais.associarPaciente(outro.profissionalId, pacienteId),
      ).resolves.toMatchObject({ profissionalId: outro.profissionalId });
    });
  });

  describe('admin criando paciente', () => {
    it('conta comum vira paciente; apagar o registro volta a comum', async () => {
      const usuarioId = await criarUsuario(TipoUsuario.comum);
      const { profissionalId } = await profissionalAprovado();

      await pacientes.createPaciente({ userId: usuarioId, profissionalId });
      expect(await tipoDa(usuarioId)).toBe(TipoUsuario.paciente);

      await pacientes.deletePaciente(usuarioId);
      expect(await tipoDa(usuarioId)).toBe(TipoUsuario.comum);
    });

    it('falha no meio não deixa a conta convertida pela metade', async () => {
      const usuarioId = await criarUsuario(TipoUsuario.comum);

      await expect(
        pacientes.createPaciente({
          userId: usuarioId,
          profissionalId: randomUUID(),
        }),
      ).rejects.toThrow();
      expect(await tipoDa(usuarioId)).toBe(TipoUsuario.comum);
    });

    it('recusa admin (422) e quem já é paciente (409)', async () => {
      const adminId = await criarUsuario(TipoUsuario.admin);
      await expect(
        pacientes.createPaciente({
          userId: adminId,
          profissionalId: null as unknown as string,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(await tipoDa(adminId)).toBe(TipoUsuario.admin);

      const usuarioId = await criarUsuario(TipoUsuario.comum);
      await pacientes.createPaciente({
        userId: usuarioId,
        profissionalId: null as unknown as string,
      });
      await expect(
        pacientes.createPaciente({
          userId: usuarioId,
          profissionalId: null as unknown as string,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
