/// <reference types="jest" />

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Gravidade, Prisma, TipoUsuario } from '@prisma/client';
import { PacienteRestricaoController } from './paciente-restricao.controller';
import { PacienteRestricaoService } from './paciente-restricao.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthGuard } from '../../../auth/auth.guard';

/** Substitui o AuthGuard real (JWT + banco) por headers; RolesGuard segue real. */
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const id = req.headers['x-user-id'];
    const tipoUsuario = req.headers['x-user-tipo'];
    if (!id || !tipoUsuario) throw new UnauthorizedException();
    req.user = { id, sub: id, tipoUsuario };
    return true;
  }
}

const erroPrisma = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: 'test',
  });

class FakePrismaService {
  pacientes: any[] = [];
  restricoes: any[] = [];
  vinculos: any[] = [];

  private chave = (w: any) => w.pacienteId_restricaoId;
  private achar = (w: any) =>
    this.vinculos.findIndex(
      (v) =>
        v.pacienteId === this.chave(w).pacienteId &&
        v.restricaoId === this.chave(w).restricaoId,
    );

  paciente = {
    findUnique: async ({ where }: any) =>
      this.pacientes.find((p) =>
        where.id ? p.id === where.id : p.usuarioId === where.usuarioId,
      ) ?? null,
  };

  restricaoAlimentar = {
    findUnique: async ({ where }: any) =>
      this.restricoes.find((r) => r.id === where.id) ?? null,
  };

  pacienteRestricao = {
    create: async ({ data }: any) => {
      if (this.achar({ pacienteId_restricaoId: data }) >= 0) {
        throw erroPrisma('P2002');
      }
      this.vinculos.push(data);
      return data;
    },
    findMany: async ({ where }: any) =>
      this.vinculos
        .filter((v) => v.pacienteId === where.pacienteId)
        .map((v) => ({
          ...v,
          restricao: this.restricoes.find((r) => r.id === v.restricaoId),
        })),
    update: async ({ where, data }: any) => {
      const i = this.achar(where);
      if (i < 0) throw erroPrisma('P2025');
      this.vinculos[i] = { ...this.vinculos[i], ...data };
      return this.vinculos[i];
    },
    delete: async ({ where }: any) => {
      const i = this.achar(where);
      if (i < 0) throw erroPrisma('P2025');
      return this.vinculos.splice(i, 1)[0];
    },
  };
}

describe('PacienteRestricao - rotas me/restricoes (integration)', () => {
  let app: INestApplication;
  let prisma: FakePrismaService;

  const usuarioPaciente = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const outroPaciente = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const pacienteSemCadastro = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const comum = { id: randomUUID(), tipo: TipoUsuario.comum };

  const paciente = { id: randomUUID(), usuarioId: usuarioPaciente.id };
  const outro = { id: randomUUID(), usuarioId: outroPaciente.id };
  const leite = { id: randomUUID(), nome: 'Leite' };
  const ovo = { id: randomUUID(), nome: 'Ovo' };

  const como = (u: { id: string; tipo: TipoUsuario }) => ({
    'x-user-id': u.id,
    'x-user-tipo': u.tipo,
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PacienteRestricaoController],
      providers: [
        PacienteRestricaoService,
        { provide: PrismaService, useClass: FakePrismaService },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleRef.get(PrismaService);
    prisma.pacientes.push(paciente, outro);
    prisma.restricoes.push(leite, ovo);
    prisma.vinculos.push({
      pacienteId: outro.id,
      restricaoId: ovo.id,
      gravidade: Gravidade.leve,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('paciente cadastra restrição própria (rota "me" não cai no :pacienteId)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/pacientes/me/restricoes')
      .set(como(usuarioPaciente))
      .send({ restricaoId: leite.id, gravidade: Gravidade.grave })
      .expect(201);

    expect(res.body).toMatchObject({
      pacienteId: paciente.id,
      restricaoId: leite.id,
      gravidade: Gravidade.grave,
    });
  });

  it('não aceita a mesma restrição duas vezes', async () => {
    await request(app.getHttpServer())
      .post('/api/pacientes/me/restricoes')
      .set(como(usuarioPaciente))
      .send({ restricaoId: leite.id })
      .expect(409);
  });

  it('lista só as restrições do próprio paciente', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/pacientes/me/restricoes')
      .set(como(usuarioPaciente))
      .expect(200);

    expect(res.body.map((v: any) => v.restricaoId)).toEqual([leite.id]);
    expect(res.body[0].restricao.nome).toBe('Leite');
  });

  it('atualiza a gravidade da restrição própria', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/pacientes/me/restricoes/${leite.id}`)
      .set(como(usuarioPaciente))
      .send({ gravidade: Gravidade.leve })
      .expect(200);

    expect(res.body.gravidade).toBe(Gravidade.leve);
  });

  it('não remove restrição de outro paciente pela rota "me"', async () => {
    await request(app.getHttpServer())
      .delete(`/api/pacientes/me/restricoes/${ovo.id}`)
      .set(como(usuarioPaciente))
      .expect(409);

    expect(prisma.vinculos).toContainEqual(
      expect.objectContaining({ pacienteId: outro.id, restricaoId: ovo.id }),
    );
  });

  it('remove a restrição própria', async () => {
    await request(app.getHttpServer())
      .delete(`/api/pacientes/me/restricoes/${leite.id}`)
      .set(como(usuarioPaciente))
      .expect(200);

    expect(prisma.vinculos.some((v) => v.pacienteId === paciente.id)).toBe(
      false,
    );
  });

  it('usuário paciente sem cadastro de Paciente recebe 404', async () => {
    await request(app.getHttpServer())
      .get('/api/pacientes/me/restricoes')
      .set(como(pacienteSemCadastro))
      .expect(404);
  });

  it('usuário comum não usa as rotas "me"', async () => {
    await request(app.getHttpServer())
      .get('/api/pacientes/me/restricoes')
      .set(como(comum))
      .expect(403);
  });

  it('paciente continua sem acesso às rotas por :pacienteId', async () => {
    await request(app.getHttpServer())
      .get(`/api/pacientes/${outro.id}/restricoes`)
      .set(como(usuarioPaciente))
      .expect(403);
  });
});
