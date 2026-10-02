/// <reference types="jest" />

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { DiaSemana, TipoRefeicao, TipoUsuario } from '@prisma/client';
import { PlanoAlimentarModule } from './plano-alimentar.module';
import { PrismaModule } from '../../../common/prisma/prisma.module';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthGuard } from '../../../auth/auth.guard';

/**
 * Guard de teste: substitui o AuthGuard real (que depende de JWT + banco) por
 * uma leitura direta de headers, mantendo o RolesGuard real no pipeline —
 * assim o teste continua exercitando a checagem de papel de verdade.
 */
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const sub = request.headers['x-user-sub'];
    const tipoUsuario = request.headers['x-user-tipo'];

    if (!sub || !tipoUsuario) {
      return false;
    }

    request.user = { sub, tipoUsuario };
    return true;
  }
}

/**
 * Fake em memória do PrismaService cobrindo apenas os models usados pelo
 * módulo de plano alimentar, permitindo um teste de integração real
 * (controller + guards + services + validação de DTO) sem depender de um
 * banco Postgres.
 */
class FakePrismaService {
  profissionais = new Map<string, any>();
  pacientes = new Map<string, any>();
  receitas = new Map<string, any>();
  planosAlimentares = new Map<string, any>();
  planoAlimentarItens = new Map<string, any>();
  checklists: any[] = [];
  comentarios: any[] = [];

  profissional = {
    findUnique: async ({ where }: any) => {
      if (where.id) return this.profissionais.get(where.id) ?? null;
      if (where.usuarioId) {
        return (
          [...this.profissionais.values()].find(
            (p) => p.usuarioId === where.usuarioId,
          ) ?? null
        );
      }
      return null;
    },
  };

  paciente = {
    findUnique: async ({ where }: any) => {
      if (where.id) return this.pacientes.get(where.id) ?? null;
      if (where.usuarioId) {
        return (
          [...this.pacientes.values()].find(
            (p) => p.usuarioId === where.usuarioId,
          ) ?? null
        );
      }
      return null;
    },
  };

  receita = {
    findUnique: async ({ where }: any) => this.receitas.get(where.id) ?? null,
    // Só a checagem de restrição usa: 0 = a receita fere a restrição.
    count: async ({ where }: any) =>
      this.receitasInseguras.has(where.id) ? 0 : 1,
  };

  receitasInseguras = new Set<string>();
  pacienteRestricoes: any[] = [];

  pacienteRestricao = {
    findMany: async ({ where }: any) =>
      this.pacienteRestricoes.filter((r) => r.pacienteId === where.paciente.id),
  };

  receitaIngrediente = { findMany: async () => [] };

  planoAlimentar = {
    create: async ({ data }: any) => {
      const planoAlimentar = { id: randomUUID(), ativo: true, ...data };
      this.planosAlimentares.set(planoAlimentar.id, planoAlimentar);
      return planoAlimentar;
    },
    findUnique: async ({ where, include }: any) => {
      const planoAlimentar = this.planosAlimentares.get(where.id);
      if (!planoAlimentar) return null;
      if (!include?.itens) return planoAlimentar;
      const itens = [...this.planoAlimentarItens.values()]
        .filter((i) => i.planoAlimentarId === planoAlimentar.id)
        .map((i) => ({
          ...i,
          receita: this.receitas.get(i.receitaId) ?? null,
        }));
      return { ...planoAlimentar, itens };
    },
    findMany: async ({ where }: any) =>
      [...this.planosAlimentares.values()].filter(
        (p) => p.pacienteId === where.pacienteId,
      ),
    update: async ({ where, data }: any) => {
      const planoAlimentar = {
        ...this.planosAlimentares.get(where.id),
        ...semUndefined(data),
      };
      this.planosAlimentares.set(where.id, planoAlimentar);
      return planoAlimentar;
    },
  };

  planoAlimentarItem = {
    create: async ({ data }: any) => {
      const item = { id: randomUUID(), ...data };
      this.planoAlimentarItens.set(item.id, item);
      return item;
    },
    findFirst: async ({ where }: any) =>
      [...this.planoAlimentarItens.values()].find(
        (i) =>
          i.planoAlimentarId === where.planoAlimentarId &&
          i.diaSemana === where.diaSemana &&
          i.tipoRefeicao === where.tipoRefeicao &&
          (!where.id?.not || i.id !== where.id.not),
      ) ?? null,
    findUnique: async ({ where, include }: any) => {
      const item = this.planoAlimentarItens.get(where.id);
      if (!item) return null;
      if (!include?.planoAlimentar) return item;
      return {
        ...item,
        planoAlimentar: this.planosAlimentares.get(item.planoAlimentarId),
      };
    },
    update: async ({ where, data }: any) => {
      const item = {
        ...this.planoAlimentarItens.get(where.id),
        ...semUndefined(data),
      };
      this.planoAlimentarItens.set(where.id, item);
      return item;
    },
    delete: async ({ where }: any) => {
      const item = this.planoAlimentarItens.get(where.id);
      this.planoAlimentarItens.delete(where.id);
      return item;
    },
  };

  checklistRefeicao = {
    count: async ({ where }: any) =>
      this.checklists.filter(
        (c) => c.planoAlimentarItemId === where.planoAlimentarItemId,
      ).length,
    findMany: async ({ where }: any) =>
      this.checklists.filter(
        (c) => c.planoAlimentarItemId === where.planoAlimentarItemId,
      ),
  };

  comentarioRefeicao = {
    count: async ({ where }: any) =>
      this.comentarios.filter(
        (c) => c.planoAlimentarItemId === where.planoAlimentarItemId,
      ).length,
    findMany: async ({ where }: any) =>
      this.comentarios.filter(
        (c) => c.planoAlimentarItemId === where.planoAlimentarItemId,
      ),
  };
}

/** Prisma ignora chaves `undefined` no `data` de um update; o fake precisa imitar isso. */
const semUndefined = (data: any) =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

describe('PlanoAlimentar (integration)', () => {
  let app: INestApplication;
  let prisma: FakePrismaService;

  const profissionalDono = { id: randomUUID(), usuarioId: randomUUID() };
  const outroProfissional = { id: randomUUID(), usuarioId: randomUUID() };
  const paciente = {
    id: randomUUID(),
    usuarioId: randomUUID(),
    profissionalId: profissionalDono.id,
  };
  const pacienteSemVinculo = {
    id: randomUUID(),
    usuarioId: randomUUID(),
    profissionalId: null,
  };

  const asAdmin = () => ({
    'x-user-sub': randomUUID(),
    'x-user-tipo': TipoUsuario.admin,
  });
  const asProfissionalDono = () => ({
    'x-user-sub': profissionalDono.usuarioId,
    'x-user-tipo': TipoUsuario.profissional,
  });
  const asOutroProfissional = () => ({
    'x-user-sub': outroProfissional.usuarioId,
    'x-user-tipo': TipoUsuario.profissional,
  });
  const asPaciente = () => ({
    'x-user-sub': paciente.usuarioId,
    'x-user-tipo': TipoUsuario.paciente,
  });

  const receitaValida = { id: randomUUID(), nome: 'Omelete de claras' };

  const itemValido = {
    receitaId: receitaValida.id,
    diaSemana: DiaSemana.segunda,
    tipoRefeicao: TipoRefeicao.cafe_da_manha,
    horarioSugerido: '08:00',
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, PlanoAlimentarModule],
    })
      .overrideProvider(PrismaService)
      .useClass(FakePrismaService)
      .overrideProvider(AuthGuard)
      .useClass(FakeAuthGuard)
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleRef.get(PrismaService);
    prisma.profissionais.set(profissionalDono.id, profissionalDono);
    prisma.profissionais.set(outroProfissional.id, outroProfissional);
    prisma.pacientes.set(paciente.id, paciente);
    prisma.pacientes.set(pacienteSemVinculo.id, pacienteSemVinculo);
    prisma.receitas.set(receitaValida.id, receitaValida);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/plano-alimentar/pacientes/:pacienteId', () => {
    const body = {
      nome: 'Plano de emagrecimento',
      dataInicio: '2026-01-01',
      dataFim: '2026-01-31',
    };

    it('rejeita quem não é profissional', async () => {
      await request(app.getHttpServer())
        .post(`/api/plano-alimentar/pacientes/${paciente.id}`)
        .set(asPaciente())
        .send(body)
        .expect(403);
    });

    it('rejeita pacienteId com formato inválido', async () => {
      await request(app.getHttpServer())
        .post('/api/plano-alimentar/pacientes/id-invalido')
        .set(asProfissionalDono())
        .send(body)
        .expect(400);
    });

    it('rejeita paciente inexistente', async () => {
      await request(app.getHttpServer())
        .post(`/api/plano-alimentar/pacientes/${randomUUID()}`)
        .set(asProfissionalDono())
        .send(body)
        .expect(404);
    });

    it('rejeita profissional criando plano para paciente que não é dele (BOLA)', async () => {
      await request(app.getHttpServer())
        .post(`/api/plano-alimentar/pacientes/${paciente.id}`)
        .set(asOutroProfissional())
        .send(body)
        .expect(404);

      await request(app.getHttpServer())
        .post(`/api/plano-alimentar/pacientes/${pacienteSemVinculo.id}`)
        .set(asProfissionalDono())
        .send(body)
        .expect(404);
    });

    it('rejeita corpo sem nome/dataInicio/dataFim', async () => {
      await request(app.getHttpServer())
        .post(`/api/plano-alimentar/pacientes/${paciente.id}`)
        .set(asProfissionalDono())
        .send({ nome: 'Plano' })
        .expect(400);
    });

    let planoAlimentarId: string;

    it('permite que o profissional dono crie o plano vazio, sem itens', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/plano-alimentar/pacientes/${paciente.id}`)
        .set(asProfissionalDono())
        .send(body)
        .expect(201);

      planoAlimentarId = res.body.id;
      expect(res.body.pacienteId).toBe(paciente.id);
      expect(res.body.profissionalId).toBe(profissionalDono.id);
      expect(res.body.itens).toBeUndefined();
      expect(prisma.planoAlimentarItens.size).toBe(0);
    });

    describe('POST /api/plano-alimentar/:id/itens', () => {
      it('rejeita quem não é profissional', async () => {
        await request(app.getHttpServer())
          .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
          .set(asPaciente())
          .send(itemValido)
          .expect(403);
      });

      it('rejeita id de plano com formato inválido', async () => {
        await request(app.getHttpServer())
          .post('/api/plano-alimentar/id-invalido/itens')
          .set(asProfissionalDono())
          .send(itemValido)
          .expect(400);
      });

      it('rejeita plano alimentar inexistente', async () => {
        await request(app.getHttpServer())
          .post(`/api/plano-alimentar/${randomUUID()}/itens`)
          .set(asProfissionalDono())
          .send(itemValido)
          .expect(404);
      });

      it('rejeita outro profissional adicionando item a plano que não é dele (BOLA)', async () => {
        await request(app.getHttpServer())
          .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
          .set(asOutroProfissional())
          .send(itemValido)
          .expect(404);
      });

      it('rejeita horarioSugerido em formato inválido', async () => {
        await request(app.getHttpServer())
          .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
          .set(asProfissionalDono())
          .send({ ...itemValido, horarioSugerido: '25:99' })
          .expect(400);
      });

      it('rejeita item sem diaSemana/tipoRefeicao', async () => {
        await request(app.getHttpServer())
          .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
          .set(asProfissionalDono())
          .send({ receitaId: randomUUID(), horarioSugerido: '08:00' })
          .expect(400);
      });

      it('rejeita item com receita inexistente', async () => {
        await request(app.getHttpServer())
          .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
          .set(asProfissionalDono())
          .send({ ...itemValido, receitaId: randomUUID() })
          .expect(404);
      });

      it('permite que o profissional dono adicione um item à grade dia x refeição', async () => {
        const res = await request(app.getHttpServer())
          .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
          .set(asProfissionalDono())
          .send(itemValido)
          .expect(201);

        expect(res.body.planoAlimentarId).toBe(planoAlimentarId);
        expect(res.body.diaSemana).toBe(DiaSemana.segunda);
        expect(res.body.tipoRefeicao).toBe(TipoRefeicao.cafe_da_manha);
        expect(prisma.planoAlimentarItens.size).toBe(1);
      });

      it('rejeita item duplicado para o mesmo dia e refeição do plano', async () => {
        await request(app.getHttpServer())
          .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
          .set(asProfissionalDono())
          .send(itemValido)
          .expect(409);

        expect(prisma.planoAlimentarItens.size).toBe(1);
      });

      it('permite montar a grade completa adicionando itens em dias/refeições diferentes', async () => {
        const outroItem = {
          ...itemValido,
          diaSemana: DiaSemana.terca,
          tipoRefeicao: TipoRefeicao.almoco,
        };
        await request(app.getHttpServer())
          .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
          .set(asProfissionalDono())
          .send(outroItem)
          .expect(201);

        expect(prisma.planoAlimentarItens.size).toBe(2);
      });
    });
  });

  describe('DELETE /api/plano-alimentar/:id', () => {
    const criarPlano = async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/plano-alimentar/pacientes/${paciente.id}`)
        .set(asProfissionalDono())
        .send({
          nome: 'Plano a remover',
          dataInicio: '2026-02-01',
          dataFim: '2026-02-28',
        })
        .expect(201);
      return res.body.id as string;
    };

    it('rejeita quem não é admin nem profissional', async () => {
      const planoAlimentarId = await criarPlano();

      await request(app.getHttpServer())
        .delete(`/api/plano-alimentar/${planoAlimentarId}`)
        .set(asPaciente())
        .expect(403);
    });

    it('rejeita id com formato inválido', async () => {
      await request(app.getHttpServer())
        .delete('/api/plano-alimentar/id-invalido')
        .set(asProfissionalDono())
        .expect(400);
    });

    it('rejeita plano alimentar inexistente', async () => {
      await request(app.getHttpServer())
        .delete(`/api/plano-alimentar/${randomUUID()}`)
        .set(asProfissionalDono())
        .expect(404);
    });

    it('rejeita outro profissional removendo plano que não é dele (BOLA)', async () => {
      const planoAlimentarId = await criarPlano();

      await request(app.getHttpServer())
        .delete(`/api/plano-alimentar/${planoAlimentarId}`)
        .set(asOutroProfissional())
        .expect(404);
    });

    it('permite que o profissional dono remova (inative) o próprio plano', async () => {
      const planoAlimentarId = await criarPlano();

      await request(app.getHttpServer())
        .delete(`/api/plano-alimentar/${planoAlimentarId}`)
        .set(asProfissionalDono())
        .expect(200);

      expect(prisma.planosAlimentares.get(planoAlimentarId).ativo).toBe(false);
    });

    it('rejeita remover um plano que já está inativo', async () => {
      const planoAlimentarId = await criarPlano();

      await request(app.getHttpServer())
        .delete(`/api/plano-alimentar/${planoAlimentarId}`)
        .set(asProfissionalDono())
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/plano-alimentar/${planoAlimentarId}`)
        .set(asProfissionalDono())
        .expect(404);
    });

    it('permite que o admin remova o plano de qualquer profissional', async () => {
      const planoAlimentarId = await criarPlano();

      await request(app.getHttpServer())
        .delete(`/api/plano-alimentar/${planoAlimentarId}`)
        .set(asAdmin())
        .expect(200);

      expect(prisma.planosAlimentares.get(planoAlimentarId).ativo).toBe(false);
    });
  });

  describe('consulta e edição de plano/itens', () => {
    const asOutroPaciente = () => ({
      'x-user-sub': pacienteSemVinculo.usuarioId,
      'x-user-tipo': TipoUsuario.paciente,
    });
    const outraReceita = { id: randomUUID(), nome: 'Salada de grão-de-bico' };

    const criarPlano = async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/plano-alimentar/pacientes/${paciente.id}`)
        .set(asProfissionalDono())
        .send({
          nome: 'Plano de março',
          dataInicio: '2026-03-01',
          dataFim: '2026-03-31',
        })
        .expect(201);
      return res.body.id as string;
    };

    const criarItem = async (
      planoAlimentarId: string,
      item: any = itemValido,
    ) => {
      const res = await request(app.getHttpServer())
        .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
        .set(asProfissionalDono())
        .send(item)
        .expect(201);
      return res.body.id as string;
    };

    beforeAll(() => {
      prisma.receitas.set(outraReceita.id, outraReceita);
    });

    describe('GET /api/plano-alimentar/:id', () => {
      it('permite que o profissional dono veja o plano com a grade de itens e a receita', async () => {
        const planoAlimentarId = await criarPlano();
        await criarItem(planoAlimentarId);

        const res = await request(app.getHttpServer())
          .get(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asProfissionalDono())
          .expect(200);

        expect(res.body.itens).toHaveLength(1);
        expect(res.body.itens[0].receita.nome).toBe(receitaValida.nome);
      });

      it('permite que o paciente dono veja o próprio plano', async () => {
        const planoAlimentarId = await criarPlano();

        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asPaciente())
          .expect(200);
      });

      it('permite que o admin veja qualquer plano', async () => {
        const planoAlimentarId = await criarPlano();

        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asAdmin())
          .expect(200);
      });

      it('rejeita outro profissional ou outro paciente vendo plano que não é dele (BOLA)', async () => {
        const planoAlimentarId = await criarPlano();

        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asOutroProfissional())
          .expect(404);

        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asOutroPaciente())
          .expect(404);
      });

      it('rejeita plano inexistente e id inválido', async () => {
        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/${randomUUID()}`)
          .set(asProfissionalDono())
          .expect(404);

        await request(app.getHttpServer())
          .get('/api/plano-alimentar/id-invalido')
          .set(asProfissionalDono())
          .expect(400);
      });
    });

    describe('GET /api/plano-alimentar/pacientes/:pacienteId', () => {
      it('permite que o paciente e o profissional responsável listem os planos', async () => {
        await criarPlano();

        const resPaciente = await request(app.getHttpServer())
          .get(`/api/plano-alimentar/pacientes/${paciente.id}`)
          .set(asPaciente())
          .expect(200);

        const resProfissional = await request(app.getHttpServer())
          .get(`/api/plano-alimentar/pacientes/${paciente.id}`)
          .set(asProfissionalDono())
          .expect(200);

        expect(resPaciente.body.length).toBeGreaterThan(0);
        expect(
          resPaciente.body.every((p: any) => p.pacienteId === paciente.id),
        ).toBe(true);
        expect(resProfissional.body).toHaveLength(resPaciente.body.length);
      });

      it('rejeita outro profissional ou outro paciente listando planos de quem não é dele (BOLA)', async () => {
        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/pacientes/${paciente.id}`)
          .set(asOutroProfissional())
          .expect(404);

        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/pacientes/${paciente.id}`)
          .set(asOutroPaciente())
          .expect(404);
      });

      it('rejeita paciente inexistente', async () => {
        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/pacientes/${randomUUID()}`)
          .set(asAdmin())
          .expect(404);
      });
    });

    describe('PATCH /api/plano-alimentar/:id', () => {
      it('permite que o profissional dono renomeie o plano sem mexer nas datas', async () => {
        const planoAlimentarId = await criarPlano();

        const res = await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asProfissionalDono())
          .send({ nome: 'Plano de março (revisado)' })
          .expect(200);

        expect(res.body.nome).toBe('Plano de março (revisado)');
        expect(
          prisma.planosAlimentares.get(planoAlimentarId).dataInicio,
        ).toEqual(new Date('2026-03-01'));
      });

      it('rejeita dataFim anterior a dataInicio', async () => {
        const planoAlimentarId = await criarPlano();

        await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asProfissionalDono())
          .send({ dataFim: '2026-02-01' })
          .expect(400);
      });

      it('rejeita quem não é profissional e outro profissional (BOLA)', async () => {
        const planoAlimentarId = await criarPlano();

        await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asPaciente())
          .send({ nome: 'x' })
          .expect(403);

        await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asOutroProfissional())
          .send({ nome: 'x' })
          .expect(404);
      });

      it('rejeita editar plano inativo', async () => {
        const planoAlimentarId = await criarPlano();

        await request(app.getHttpServer())
          .delete(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asProfissionalDono())
          .expect(200);

        await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/${planoAlimentarId}`)
          .set(asProfissionalDono())
          .send({ nome: 'x' })
          .expect(404);
      });
    });

    describe('PATCH /api/plano-alimentar/itens/:itemId', () => {
      it('permite trocar receita e horário do item', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);

        const res = await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/itens/${itemId}`)
          .set(asProfissionalDono())
          .send({ receitaId: outraReceita.id, horarioSugerido: '09:30' })
          .expect(200);

        expect(res.body.receitaId).toBe(outraReceita.id);
        expect(res.body.diaSemana).toBe(itemValido.diaSemana);
      });

      it('permite reenviar o mesmo dia/refeição do próprio item sem acusar duplicidade', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);

        await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/itens/${itemId}`)
          .set(asProfissionalDono())
          .send({
            diaSemana: itemValido.diaSemana,
            tipoRefeicao: itemValido.tipoRefeicao,
          })
          .expect(200);
      });

      it('rejeita mover o item para um dia/refeição já ocupado no plano', async () => {
        const planoAlimentarId = await criarPlano();
        await criarItem(planoAlimentarId);
        const itemId = await criarItem(planoAlimentarId, {
          ...itemValido,
          tipoRefeicao: TipoRefeicao.almoco,
        });

        await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/itens/${itemId}`)
          .set(asProfissionalDono())
          .send({ tipoRefeicao: TipoRefeicao.cafe_da_manha })
          .expect(409);
      });

      it('rejeita trocar o item para uma receita excluída', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);
        const receitaExcluida = {
          id: randomUUID(),
          nome: 'Receita excluída',
          deletedAt: new Date(),
        };
        prisma.receitas.set(receitaExcluida.id, receitaExcluida);

        await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/itens/${itemId}`)
          .set(asProfissionalDono())
          .send({ receitaId: receitaExcluida.id })
          .expect(404);

        await request(app.getHttpServer())
          .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
          .set(asProfissionalDono())
          .send({
            ...itemValido,
            receitaId: receitaExcluida.id,
            tipoRefeicao: TipoRefeicao.ceia,
          })
          .expect(404);
      });

      it('rejeita receita que fere restrição estrita do paciente (422)', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);
        const receitaComLeite = { id: randomUUID(), nome: 'Bolo de leite' };
        prisma.receitas.set(receitaComLeite.id, receitaComLeite);
        prisma.receitasInseguras.add(receitaComLeite.id);
        prisma.pacienteRestricoes.push({
          pacienteId: paciente.id,
          restricaoId: randomUUID(),
          gravidade: 'leve',
          restricao: {
            nome: 'Alergia a leite',
            tipo: 'alergia',
            createdAt: new Date(),
            regrasNutricionais: [],
          },
        });

        try {
          const res = await request(app.getHttpServer())
            .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
            .set(asProfissionalDono())
            .send({
              ...itemValido,
              receitaId: receitaComLeite.id,
              tipoRefeicao: TipoRefeicao.ceia,
            })
            .expect(422);
          expect(res.body.message).toContain('restrições do paciente');

          await request(app.getHttpServer())
            .patch(`/api/plano-alimentar/itens/${itemId}`)
            .set(asProfissionalDono())
            .send({ receitaId: receitaComLeite.id })
            .expect(422);
        } finally {
          prisma.pacienteRestricoes = [];
        }
      });

      it('rejeita receita inexistente e enum inválido', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);

        await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/itens/${itemId}`)
          .set(asProfissionalDono())
          .send({ receitaId: randomUUID() })
          .expect(404);

        await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/itens/${itemId}`)
          .set(asProfissionalDono())
          .send({ diaSemana: 'feriado' })
          .expect(400);
      });

      it('rejeita outro profissional editando item que não é dele (BOLA)', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);

        await request(app.getHttpServer())
          .patch(`/api/plano-alimentar/itens/${itemId}`)
          .set(asOutroProfissional())
          .send({ horarioSugerido: '10:00' })
          .expect(404);
      });
    });

    describe('GET de checklist e comentários de um item', () => {
      it('permite que o admin veja o histórico de checklist do item', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);
        prisma.checklists.push({ planoAlimentarItemId: itemId });

        const res = await request(app.getHttpServer())
          .get(`/api/plano-alimentar/itens/${itemId}/checklist`)
          .set(asAdmin())
          .expect(200);

        expect(res.body).toHaveLength(1);
      });

      it('permite que o paciente e o profissional donos vejam os comentários do item', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);
        prisma.comentarios.push({ planoAlimentarItemId: itemId });

        const resPaciente = await request(app.getHttpServer())
          .get(`/api/plano-alimentar/itens/${itemId}/comentarios`)
          .set(asPaciente())
          .expect(200);

        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/itens/${itemId}/comentarios`)
          .set(asProfissionalDono())
          .expect(200);

        expect(resPaciente.body).toHaveLength(1);
      });

      it('permite que o admin veja os comentários de qualquer item', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);

        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/itens/${itemId}/comentarios`)
          .set(asAdmin())
          .expect(200);
      });

      it('rejeita outro profissional vendo os comentários do item (BOLA)', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);

        await request(app.getHttpServer())
          .get(`/api/plano-alimentar/itens/${itemId}/comentarios`)
          .set(asOutroProfissional())
          .expect(403);
      });
    });

    describe('DELETE /api/plano-alimentar/itens/:itemId', () => {
      it('permite que o profissional dono remova item sem histórico', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);

        await request(app.getHttpServer())
          .delete(`/api/plano-alimentar/itens/${itemId}`)
          .set(asProfissionalDono())
          .expect(200);

        expect(prisma.planoAlimentarItens.has(itemId)).toBe(false);
      });

      it('rejeita remover item com checklist ou comentário do paciente', async () => {
        const planoAlimentarId = await criarPlano();
        const itemComChecklist = await criarItem(planoAlimentarId);
        const itemComComentario = await criarItem(planoAlimentarId, {
          ...itemValido,
          tipoRefeicao: TipoRefeicao.jantar,
        });
        prisma.checklists.push({ planoAlimentarItemId: itemComChecklist });
        prisma.comentarios.push({ planoAlimentarItemId: itemComComentario });

        await request(app.getHttpServer())
          .delete(`/api/plano-alimentar/itens/${itemComChecklist}`)
          .set(asProfissionalDono())
          .expect(409);

        await request(app.getHttpServer())
          .delete(`/api/plano-alimentar/itens/${itemComComentario}`)
          .set(asProfissionalDono())
          .expect(409);

        expect(prisma.planoAlimentarItens.has(itemComChecklist)).toBe(true);
      });

      it('rejeita quem não é profissional, outro profissional (BOLA) e item inexistente', async () => {
        const planoAlimentarId = await criarPlano();
        const itemId = await criarItem(planoAlimentarId);

        await request(app.getHttpServer())
          .delete(`/api/plano-alimentar/itens/${itemId}`)
          .set(asPaciente())
          .expect(403);

        await request(app.getHttpServer())
          .delete(`/api/plano-alimentar/itens/${itemId}`)
          .set(asOutroProfissional())
          .expect(404);

        await request(app.getHttpServer())
          .delete(`/api/plano-alimentar/itens/${randomUUID()}`)
          .set(asProfissionalDono())
          .expect(404);
      });
    });
  });
});
