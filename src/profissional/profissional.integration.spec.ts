/// <reference types="jest" />

import { CanActivate, ExecutionContext, Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Prisma, StatusAprovacao, TipoTransacaoPontos, TipoUsuario } from '@prisma/client';
import { ProfissionalModule } from './profissional.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AuthGuard } from '../auth/auth.guard';

/**
 * Guard de teste: substitui o AuthGuard real (que depende de JWT + banco) por
 * uma leitura direta de headers, mantendo o RolesGuard real no pipeline.
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
 * Providers globais que o AppModule registra (JwtModule global e CacheModule)
 * e que o UsuarioService do módulo de profissional exige para ser instanciado.
 */
@Global()
@Module({
    providers: [
        { provide: JwtService, useValue: {} },
        { provide: CacheService, useValue: {} },
    ],
    exports: [JwtService, CacheService],
})
class FakeGlobalsModule {}

/**
 * Fake em memória do PrismaService cobrindo apenas os models usados pelo
 * módulo de profissional. O $transaction tira um snapshot e restaura tudo em
 * caso de erro, imitando o rollback do banco.
 */
class FakePrismaService {
    usuarios = new Map<string, any>();
    contas = new Map<string, any>();
    profissionais = new Map<string, any>();
    pacientes = new Map<string, any>();
    clinicas = new Map<string, any>();
    transacoes = new Map<string, any>();

    async $transaction(fn: (tx: any) => Promise<any>) {
        const nomes = ['usuarios', 'contas', 'profissionais', 'pacientes', 'clinicas', 'transacoes'] as const;
        const snapshot = Object.fromEntries(nomes.map((nome) => [nome, structuredClone([...this[nome]])]));

        try {
            return await fn(this);
        } catch (error) {
            nomes.forEach((nome) => (this[nome] = new Map(snapshot[nome] as any)));
            throw error;
        }
    }

    private comRelacoes(profissional: any) {
        return {
            ...profissional,
            usuario: this.usuarios.get(profissional.usuarioId) ?? null,
            clinica: profissional.clinicaId ? this.clinicas.get(profissional.clinicaId) ?? null : null,
        };
    }

    private naoEncontrado() {
        return new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'test' });
    }

    usuario = {
        findUnique: async ({ where }: any) => {
            const usuario = this.usuarios.get(where.id);
            if (!usuario) return null;
            const profissional = [...this.profissionais.values()].find((p) => p.usuarioId === usuario.id) ?? null;
            return { ...usuario, profissional };
        },
        update: async ({ where, data }: any) => {
            if (!this.usuarios.has(where.id)) throw this.naoEncontrado();
            const usuario = { ...this.usuarios.get(where.id), ...data };
            this.usuarios.set(where.id, usuario);
            return usuario;
        },
        create: async ({ data }: any) => {
            const { conta, ...dadosUsuario } = data;
            if ([...this.contas.values()].some((c) => c.email === conta.create.email)) {
                throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                    code: 'P2002',
                    clientVersion: 'test',
                    meta: { target: ['email'] },
                });
            }
            const usuario = { id: randomUUID(), ...dadosUsuario };
            const novaConta = { id: randomUUID(), usuarioId: usuario.id, ...conta.create };
            this.usuarios.set(usuario.id, usuario);
            this.contas.set(novaConta.id, novaConta);
            return { ...usuario, conta: novaConta };
        },
    };

    profissional = {
        findUnique: async ({ where, include }: any) => {
            const profissional = where.id
                ? this.profissionais.get(where.id)
                : [...this.profissionais.values()].find((p) => p.usuarioId === where.usuarioId);
            if (!profissional) return null;
            return include ? this.comRelacoes(profissional) : profissional;
        },
        create: async ({ data }: any) => {
            const profissional = { id: randomUUID(), createdAt: new Date(), pontosIncentivo: 0, ...data };
            this.profissionais.set(profissional.id, profissional);
            return profissional;
        },
        update: async ({ where, data, include }: any) => {
            if (!this.profissionais.has(where.id)) throw this.naoEncontrado();
            const dadosDefinidos = Object.fromEntries(Object.entries(data).filter(([, valor]) => valor !== undefined));
            const profissional = { ...this.profissionais.get(where.id), ...dadosDefinidos };
            this.profissionais.set(where.id, profissional);
            return include ? this.comRelacoes(profissional) : profissional;
        },
        findMany: async ({ where, skip = 0, take, orderBy, include }: any) => {
            const direcao = orderBy?.createdAt === 'desc' ? -1 : 1;
            return [...this.profissionais.values()]
                .filter((p) => !where.statusAprovacao || p.statusAprovacao === where.statusAprovacao)
                .sort((a, b) => direcao * (a.createdAt.getTime() - b.createdAt.getTime()))
                .slice(skip, skip + take)
                .map((p) => (include ? this.comRelacoes(p) : p));
        },
        count: async ({ where }: any) =>
            [...this.profissionais.values()].filter((p) => !where.statusAprovacao || p.statusAprovacao === where.statusAprovacao).length,
    };

    paciente = {
        findUnique: async ({ where }: any) => this.pacientes.get(where.id) ?? null,
        update: async ({ where, data }: any) => {
            if (!this.pacientes.has(where.id)) throw this.naoEncontrado();
            const paciente = { ...this.pacientes.get(where.id), ...data };
            this.pacientes.set(where.id, paciente);
            return paciente;
        },
        create: async ({ data }: any) => {
            const paciente = { id: randomUUID(), ...data };
            this.pacientes.set(paciente.id, paciente);
            return paciente;
        },
        findMany: async ({ where }: any) =>
            [...this.pacientes.values()]
                .filter((p) => p.profissionalId === where.profissionalId)
                .map((p) => ({ ...p, usuario: this.usuarios.get(p.usuarioId) ?? null }))
                .sort((a, b) => (a.usuario?.nome ?? '').localeCompare(b.usuario?.nome ?? '')),
    };

    clinica = {
        findUnique: async ({ where }: any) => (where.id ? this.clinicas.get(where.id) ?? null : null),
    };

    pontosTransacao = {
        aggregate: async ({ where }: any) => {
            const transacoes = [...this.transacoes.values()].filter((t) => t.profissionalId === where.profissionalId);
            return { _sum: { pontos: transacoes.length ? transacoes.reduce((soma, t) => soma + t.pontos, 0) : null } };
        },
        findMany: async ({ where, skip = 0, take }: any) =>
            [...this.transacoes.values()]
                .filter((t) => t.profissionalId === where.profissionalId)
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(skip, skip + take),
        count: async ({ where }: any) =>
            [...this.transacoes.values()].filter((t) => t.profissionalId === where.profissionalId).length,
    };
}

describe('Profissional (integration)', () => {
    let app: INestApplication;
    let prisma: FakePrismaService;

    const adminId = randomUUID();
    const clinica = { id: randomUUID(), nome: 'Clínica Central' };
    const outraClinica = { id: randomUUID(), nome: 'Clínica Norte' };

    const asAdmin = () => ({ 'x-user-sub': adminId, 'x-user-tipo': TipoUsuario.admin });
    const asComum = (usuarioId: string) => ({ 'x-user-sub': usuarioId, 'x-user-tipo': TipoUsuario.comum });
    const asProfissional = (usuarioId: string) => ({ 'x-user-sub': usuarioId, 'x-user-tipo': TipoUsuario.profissional });
    const asPaciente = () => ({ 'x-user-sub': randomUUID(), 'x-user-tipo': TipoUsuario.paciente });

    let createdAtSeq = 0;

    const criarUsuario = (tipoUsuario: TipoUsuario, nome = 'Usuário') => {
        const usuario = { id: randomUUID(), nome, tipoUsuario };
        prisma.usuarios.set(usuario.id, usuario);
        return usuario;
    };

    const criarProfissional = (dados: Partial<{ statusAprovacao: StatusAprovacao; clinicaId: string | null }> = {}) => {
        const usuario = criarUsuario(TipoUsuario.profissional, 'Dra. Ana');
        const profissional = {
            id: randomUUID(),
            usuarioId: usuario.id,
            registroProfissional: 'CRN-6 12345',
            statusAprovacao: StatusAprovacao.aprovado,
            clinicaId: null as string | null,
            pontosIncentivo: 0,
            createdAt: new Date(Date.UTC(2026, 0, 1) + createdAtSeq++ * 1000),
            ...dados,
        };
        prisma.profissionais.set(profissional.id, profissional);
        return { usuario, profissional };
    };

    const criarPaciente = (profissionalId: string | null, nome = 'Paciente') => {
        const usuario = criarUsuario(TipoUsuario.paciente, nome);
        const paciente = { id: randomUUID(), usuarioId: usuario.id, profissionalId };
        prisma.pacientes.set(paciente.id, paciente);
        return paciente;
    };

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [PrismaModule, FakeGlobalsModule, ProfissionalModule],
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

        prisma = moduleRef.get(PrismaService) as unknown as FakePrismaService;
    });

    beforeEach(() => {
        ['usuarios', 'contas', 'profissionais', 'pacientes', 'clinicas', 'transacoes'].forEach((nome) => prisma[nome].clear());
        prisma.clinicas.set(clinica.id, clinica);
        prisma.clinicas.set(outraClinica.id, outraClinica);
    });

    afterAll(async () => {
        await app.close();
    });

    it('rejeita requisições sem autenticação', async () => {
        await request(app.getHttpServer()).get('/api/profissionais/meus-pacientes').expect(403);
    });

    describe('POST /api/profissionais/solicitar', () => {
        const body = () => ({ registroProfissional: 'CRN-6 99999', especialidade: 'Nutrição esportiva', clinicaId: clinica.id });

        it('rejeita quem não é usuário comum', async () => {
            const { usuario } = criarProfissional();

            await request(app.getHttpServer())
                .post('/api/profissionais/solicitar')
                .set(asProfissional(usuario.id))
                .send(body())
                .expect(403);
        });

        it('rejeita corpo sem registroProfissional', async () => {
            const usuario = criarUsuario(TipoUsuario.comum);

            await request(app.getHttpServer())
                .post('/api/profissionais/solicitar')
                .set(asComum(usuario.id))
                .send({ clinicaId: clinica.id })
                .expect(400);
        });

        it('rejeita clínica inexistente', async () => {
            const usuario = criarUsuario(TipoUsuario.comum);

            await request(app.getHttpServer())
                .post('/api/profissionais/solicitar')
                .set(asComum(usuario.id))
                .send({ ...body(), clinicaId: randomUUID() })
                .expect(404);
        });

        it('rejeita usuário inexistente', async () => {
            await request(app.getHttpServer())
                .post('/api/profissionais/solicitar')
                .set(asComum(randomUUID()))
                .send(body())
                .expect(404);
        });

        it('cria a solicitação pendente e transforma o usuário em profissional', async () => {
            const usuario = criarUsuario(TipoUsuario.comum);

            const response = await request(app.getHttpServer())
                .post('/api/profissionais/solicitar')
                .set(asComum(usuario.id))
                .send(body())
                .expect(201);

            expect(response.body).toMatchObject({
                usuarioId: usuario.id,
                registroProfissional: 'CRN-6 99999',
                statusAprovacao: StatusAprovacao.pendente,
                clinicaId: clinica.id,
            });
            expect(prisma.usuarios.get(usuario.id).tipoUsuario).toBe(TipoUsuario.profissional);
        });

        it('cria a solicitação sem clínica quando clinicaId não é informado', async () => {
            const usuario = criarUsuario(TipoUsuario.comum);
            const clinicaExists = jest.spyOn(prisma.clinica, 'findUnique');

            const response = await request(app.getHttpServer())
                .post('/api/profissionais/solicitar')
                .set(asComum(usuario.id))
                .send({ registroProfissional: 'CRN-6 99999' })
                .expect(201);

            expect(response.body).toMatchObject({ statusAprovacao: StatusAprovacao.pendente });
            expect(response.body.clinicaId).toBeUndefined();
            expect(clinicaExists).not.toHaveBeenCalled();
            clinicaExists.mockRestore();
        });

        it('rejeita nova solicitação quando já existe uma pendente ou aprovada', async () => {
            const { usuario } = criarProfissional({ statusAprovacao: StatusAprovacao.pendente });

            await request(app.getHttpServer())
                .post('/api/profissionais/solicitar')
                .set(asComum(usuario.id))
                .send(body())
                .expect(409);
        });

        it('reabre uma solicitação rejeitada como pendente', async () => {
            const { usuario, profissional } = criarProfissional({ statusAprovacao: StatusAprovacao.rejeitado });

            const response = await request(app.getHttpServer())
                .post('/api/profissionais/solicitar')
                .set(asComum(usuario.id))
                .send(body())
                .expect(201);

            expect(response.body).toMatchObject({
                id: profissional.id,
                statusAprovacao: StatusAprovacao.pendente,
                aprovadoPor: null,
                aprovadoEm: null,
            });
            expect(prisma.profissionais.size).toBe(1);
        });
    });

    describe('GET /api/profissionais/pendentes', () => {
        it('rejeita quem não é admin', async () => {
            const { usuario } = criarProfissional();

            await request(app.getHttpServer())
                .get('/api/profissionais/pendentes')
                .set(asProfissional(usuario.id))
                .expect(403);
        });

        it('lista só os pendentes, do mais antigo para o mais recente, paginado', async () => {
            const primeiro = criarProfissional({ statusAprovacao: StatusAprovacao.pendente }).profissional;
            const segundo = criarProfissional({ statusAprovacao: StatusAprovacao.pendente }).profissional;
            criarProfissional({ statusAprovacao: StatusAprovacao.pendente });
            criarProfissional({ statusAprovacao: StatusAprovacao.aprovado });

            const response = await request(app.getHttpServer())
                .get('/api/profissionais/pendentes?page=1&limit=2')
                .set(asAdmin())
                .expect(200);

            expect(response.body.data.map((p: any) => p.id)).toEqual([primeiro.id, segundo.id]);
            expect(response.body.meta).toEqual({ total: 3, page: 1, last_page: 2, limit: 2 });
        });

        it('rejeita paginação não numérica', async () => {
            await request(app.getHttpServer())
                .get('/api/profissionais/pendentes?page=abc')
                .set(asAdmin())
                .expect(400);
        });
    });

    describe('POST /api/profissionais/:id/aprovar', () => {
        it('rejeita quem não é admin', async () => {
            const { usuario, profissional } = criarProfissional({ statusAprovacao: StatusAprovacao.pendente });

            await request(app.getHttpServer())
                .post(`/api/profissionais/${profissional.id}/aprovar`)
                .set(asProfissional(usuario.id))
                .expect(403);
        });

        it('rejeita id com formato inválido', async () => {
            await request(app.getHttpServer())
                .post('/api/profissionais/id-invalido/aprovar')
                .set(asAdmin())
                .expect(400);
        });

        it('rejeita profissional inexistente', async () => {
            await request(app.getHttpServer())
                .post(`/api/profissionais/${randomUUID()}/aprovar`)
                .set(asAdmin())
                .expect(404);
        });

        it('aprova a solicitação registrando o admin', async () => {
            const { profissional } = criarProfissional({ statusAprovacao: StatusAprovacao.pendente });

            const response = await request(app.getHttpServer())
                .post(`/api/profissionais/${profissional.id}/aprovar`)
                .set(asAdmin())
                .expect(201);

            expect(response.body).toMatchObject({ statusAprovacao: StatusAprovacao.aprovado, aprovadoPor: adminId });
            expect(response.body.aprovadoEm).toBeDefined();
        });

        it('rejeita solicitação que já foi avaliada', async () => {
            const { profissional } = criarProfissional({ statusAprovacao: StatusAprovacao.aprovado });

            await request(app.getHttpServer())
                .post(`/api/profissionais/${profissional.id}/aprovar`)
                .set(asAdmin())
                .expect(409);
        });
    });

    describe('POST /api/profissionais/:id/rejeitar', () => {
        it('rejeita a solicitação e volta o usuário para comum', async () => {
            const { usuario, profissional } = criarProfissional({ statusAprovacao: StatusAprovacao.pendente });

            const response = await request(app.getHttpServer())
                .post(`/api/profissionais/${profissional.id}/rejeitar`)
                .set(asAdmin())
                .expect(201);

            expect(response.body).toMatchObject({ statusAprovacao: StatusAprovacao.rejeitado, aprovadoPor: adminId });
            expect(prisma.usuarios.get(usuario.id).tipoUsuario).toBe(TipoUsuario.comum);
        });

        it('rejeita solicitação que já foi avaliada', async () => {
            const { profissional } = criarProfissional({ statusAprovacao: StatusAprovacao.rejeitado });

            await request(app.getHttpServer())
                .post(`/api/profissionais/${profissional.id}/rejeitar`)
                .set(asAdmin())
                .expect(409);
        });

        it('rejeita profissional inexistente', async () => {
            await request(app.getHttpServer())
                .post(`/api/profissionais/${randomUUID()}/rejeitar`)
                .set(asAdmin())
                .expect(404);
        });
    });

    describe('GET /api/profissionais/:id', () => {
        it('retorna o profissional com usuário e clínica', async () => {
            const { usuario, profissional } = criarProfissional({ clinicaId: clinica.id });

            const response = await request(app.getHttpServer())
                .get(`/api/profissionais/${profissional.id}`)
                .set(asAdmin())
                .expect(200);

            expect(response.body).toMatchObject({
                id: profissional.id,
                usuario: { id: usuario.id },
                clinica: { id: clinica.id },
            });
        });

        it('rejeita profissional inexistente', async () => {
            await request(app.getHttpServer())
                .get(`/api/profissionais/${randomUUID()}`)
                .set(asAdmin())
                .expect(404);
        });

        it('rejeita quem não é admin', async () => {
            const { usuario, profissional } = criarProfissional();

            await request(app.getHttpServer())
                .get(`/api/profissionais/${profissional.id}`)
                .set(asProfissional(usuario.id))
                .expect(403);
        });
    });

    describe('GET /api/profissionais/meus-pacientes', () => {
        it('rejeita quem não é profissional', async () => {
            await request(app.getHttpServer())
                .get('/api/profissionais/meus-pacientes')
                .set(asPaciente())
                .expect(403);
        });

        it('rejeita usuário sem cadastro profissional', async () => {
            await request(app.getHttpServer())
                .get('/api/profissionais/meus-pacientes')
                .set(asProfissional(randomUUID()))
                .expect(404);
        });

        it('lista apenas os pacientes do profissional autenticado, por nome', async () => {
            const { usuario, profissional } = criarProfissional();
            const outro = criarProfissional().profissional;
            const bruno = criarPaciente(profissional.id, 'Bruno');
            const alice = criarPaciente(profissional.id, 'Alice');
            criarPaciente(outro.id, 'Carla');
            criarPaciente(null, 'Diego');

            const response = await request(app.getHttpServer())
                .get('/api/profissionais/meus-pacientes')
                .set(asProfissional(usuario.id))
                .expect(200);

            expect(response.body.map((p: any) => p.id)).toEqual([alice.id, bruno.id]);
        });
    });

    describe('GET /api/profissionais/minha-clinica', () => {
        it('retorna a clínica do profissional', async () => {
            const { usuario } = criarProfissional({ clinicaId: clinica.id });

            const response = await request(app.getHttpServer())
                .get('/api/profissionais/minha-clinica')
                .set(asProfissional(usuario.id))
                .expect(200);

            expect(response.body).toEqual(clinica);
        });

        it('rejeita profissional sem clínica', async () => {
            const { usuario } = criarProfissional();

            await request(app.getHttpServer())
                .get('/api/profissionais/minha-clinica')
                .set(asProfissional(usuario.id))
                .expect(400);
        });
    });

    describe('POST /api/profissionais/clinica/associar/:id', () => {
        it('associa a clínica ao profissional', async () => {
            const { usuario, profissional } = criarProfissional();

            const response = await request(app.getHttpServer())
                .post(`/api/profissionais/clinica/associar/${clinica.id}`)
                .set(asProfissional(usuario.id))
                .expect(201);

            expect(response.body.clinica).toEqual(clinica);
            expect(prisma.profissionais.get(profissional.id).clinicaId).toBe(clinica.id);
        });

        it('rejeita quando o profissional já tem clínica', async () => {
            const { usuario, profissional } = criarProfissional({ clinicaId: clinica.id });

            await request(app.getHttpServer())
                .post(`/api/profissionais/clinica/associar/${outraClinica.id}`)
                .set(asProfissional(usuario.id))
                .expect(400);

            expect(prisma.profissionais.get(profissional.id).clinicaId).toBe(clinica.id);
        });

        it('rejeita clínica inexistente', async () => {
            const { usuario } = criarProfissional();

            await request(app.getHttpServer())
                .post(`/api/profissionais/clinica/associar/${randomUUID()}`)
                .set(asProfissional(usuario.id))
                .expect(404);
        });
    });

    describe('POST /api/profissionais/clinica/desassociar', () => {
        it('remove a clínica do profissional', async () => {
            const { usuario, profissional } = criarProfissional({ clinicaId: clinica.id });

            await request(app.getHttpServer())
                .post('/api/profissionais/clinica/desassociar')
                .set(asProfissional(usuario.id))
                .expect(201);

            expect(prisma.profissionais.get(profissional.id).clinicaId).toBeNull();
        });

        it('rejeita profissional sem clínica', async () => {
            const { usuario } = criarProfissional();

            await request(app.getHttpServer())
                .post('/api/profissionais/clinica/desassociar')
                .set(asProfissional(usuario.id))
                .expect(400);
        });
    });

    describe('POST /api/profissionais/paciente', () => {
        const body = () => ({ name: 'Maria Souza', email: `maria.${randomUUID()}@email.com`, password: 'senha-forte-123' });

        it('cria o usuário paciente vinculado ao profissional', async () => {
            const { usuario, profissional } = criarProfissional();
            const dados = body();

            const response = await request(app.getHttpServer())
                .post('/api/profissionais/paciente')
                .set(asProfissional(usuario.id))
                .send(dados)
                .expect(201);

            expect(response.body.usuario).toMatchObject({ nome: dados.name, tipoUsuario: TipoUsuario.paciente });
            expect(response.body.paciente).toMatchObject({ profissionalId: profissional.id });
            expect(response.body.usuario.conta.senhaHash).not.toBe(dados.password);
        });

        it('rejeita corpo sem email válido', async () => {
            const { usuario } = criarProfissional();

            await request(app.getHttpServer())
                .post('/api/profissionais/paciente')
                .set(asProfissional(usuario.id))
                .send({ ...body(), email: 'nao-e-email' })
                .expect(400);
        });

        it('rejeita email já em uso sem deixar usuário órfão', async () => {
            const { usuario } = criarProfissional();
            const dados = body();

            await request(app.getHttpServer()).post('/api/profissionais/paciente').set(asProfissional(usuario.id)).send(dados).expect(201);
            const usuariosAntes = prisma.usuarios.size;

            await request(app.getHttpServer())
                .post('/api/profissionais/paciente')
                .set(asProfissional(usuario.id))
                .send({ ...dados, name: 'Outra Maria' })
                .expect(409);

            expect(prisma.usuarios.size).toBe(usuariosAntes);
        });

        it('rejeita profissional ainda não aprovado', async () => {
            const { usuario } = criarProfissional({ statusAprovacao: StatusAprovacao.pendente });

            await request(app.getHttpServer())
                .post('/api/profissionais/paciente')
                .set(asProfissional(usuario.id))
                .send(body())
                .expect(401);

            expect(prisma.pacientes.size).toBe(0);
        });
    });

    describe('POST /api/profissionais/paciente/:pacienteId/associar', () => {
        it('vincula um paciente sem profissional', async () => {
            const { usuario, profissional } = criarProfissional();
            const paciente = criarPaciente(null);

            const response = await request(app.getHttpServer())
                .post(`/api/profissionais/paciente/${paciente.id}/associar`)
                .set(asProfissional(usuario.id))
                .expect(201);

            expect(response.body.profissionalId).toBe(profissional.id);
        });

        it('rejeita paciente que já tem outro profissional', async () => {
            const { usuario } = criarProfissional();
            const outro = criarProfissional().profissional;
            const paciente = criarPaciente(outro.id);

            await request(app.getHttpServer())
                .post(`/api/profissionais/paciente/${paciente.id}/associar`)
                .set(asProfissional(usuario.id))
                .expect(409);

            expect(prisma.pacientes.get(paciente.id).profissionalId).toBe(outro.id);
        });

        it('rejeita paciente inexistente', async () => {
            const { usuario } = criarProfissional();

            await request(app.getHttpServer())
                .post(`/api/profissionais/paciente/${randomUUID()}/associar`)
                .set(asProfissional(usuario.id))
                .expect(404);
        });

        it('rejeita profissional ainda não aprovado', async () => {
            const { usuario } = criarProfissional({ statusAprovacao: StatusAprovacao.pendente });
            const paciente = criarPaciente(null);

            await request(app.getHttpServer())
                .post(`/api/profissionais/paciente/${paciente.id}/associar`)
                .set(asProfissional(usuario.id))
                .expect(401);
        });
    });

    describe('GET /api/profissionais/pontos/saldo', () => {
        it('retorna o saldo somando as transações do profissional', async () => {
            const { usuario, profissional } = criarProfissional();
            const outro = criarProfissional().profissional;
            [
                { profissionalId: profissional.id, pontos: 10 },
                { profissionalId: profissional.id, pontos: 5 },
                { profissionalId: outro.id, pontos: 100 },
            ].forEach((t) => {
                const transacao = { id: randomUUID(), tipo: TipoTransacaoPontos.ganho_aprovacao, createdAt: new Date(), ...t };
                prisma.transacoes.set(transacao.id, transacao);
            });

            const response = await request(app.getHttpServer())
                .get('/api/profissionais/pontos/saldo')
                .set(asProfissional(usuario.id))
                .expect(200);

            expect(response.body).toEqual({ saldo: 15 });
        });

        it('retorna saldo 0 quando não há transações', async () => {
            const { usuario } = criarProfissional();

            const response = await request(app.getHttpServer())
                .get('/api/profissionais/pontos/saldo')
                .set(asProfissional(usuario.id))
                .expect(200);

            expect(response.body).toEqual({ saldo: 0 });
        });

        it('rejeita profissional ainda não aprovado', async () => {
            const { usuario } = criarProfissional({ statusAprovacao: StatusAprovacao.pendente });

            await request(app.getHttpServer())
                .get('/api/profissionais/pontos/saldo')
                .set(asProfissional(usuario.id))
                .expect(401);
        });

        it('rejeita quem não é profissional', async () => {
            await request(app.getHttpServer())
                .get('/api/profissionais/pontos/saldo')
                .set(asAdmin())
                .expect(403);
        });
    });

    describe('GET /api/profissionais/pontos/historico', () => {
        it('retorna o histórico paginado do profissional, mais recente primeiro', async () => {
            const { usuario, profissional } = criarProfissional();
            const outro = criarProfissional().profissional;
            const transacoes = [1, 2, 3].map((dia) => {
                const transacao = {
                    id: randomUUID(),
                    profissionalId: profissional.id,
                    tipo: TipoTransacaoPontos.ganho_aprovacao,
                    pontos: 10,
                    createdAt: new Date(`2026-01-0${dia}`),
                };
                prisma.transacoes.set(transacao.id, transacao);
                return transacao;
            });
            const deOutro = { id: randomUUID(), profissionalId: outro.id, pontos: 1, createdAt: new Date('2026-01-09') };
            prisma.transacoes.set(deOutro.id, deOutro);

            const response = await request(app.getHttpServer())
                .get('/api/profissionais/pontos/historico?page=1&limit=2')
                .set(asProfissional(usuario.id))
                .expect(200);

            expect(response.body.data.map((t: any) => t.id)).toEqual([transacoes[2].id, transacoes[1].id]);
            expect(response.body.meta).toEqual({ total: 3, page: 1, last_page: 2, limit: 2 });
        });

        it('rejeita profissional ainda não aprovado', async () => {
            const { usuario } = criarProfissional({ statusAprovacao: StatusAprovacao.pendente });

            await request(app.getHttpServer())
                .get('/api/profissionais/pontos/historico')
                .set(asProfissional(usuario.id))
                .expect(401);
        });
    });
});
