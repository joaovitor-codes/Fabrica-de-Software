import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { DiaSemana, TipoRefeicao, TipoUsuario } from '@prisma/client';
import { PlanoAlimentarModule } from './plano-alimentar.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../auth/auth.guard';

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
    planosAlimentares = new Map<string, any>();
    planoAlimentarItens = new Map<string, any>();

    profissional = {
        findUnique: async ({ where }: any) => {
            if (where.id) return this.profissionais.get(where.id) ?? null;
            if (where.usuarioId) {
                return [...this.profissionais.values()].find((p) => p.usuarioId === where.usuarioId) ?? null;
            }
            return null;
        },
    };

    paciente = {
        findUnique: async ({ where }: any) => {
            if (where.id) return this.pacientes.get(where.id) ?? null;
            if (where.usuarioId) {
                return [...this.pacientes.values()].find((p) => p.usuarioId === where.usuarioId) ?? null;
            }
            return null;
        },
    };

    planoAlimentar = {
        create: async ({ data }: any) => {
            const planoAlimentar = { id: randomUUID(), ...data };
            this.planosAlimentares.set(planoAlimentar.id, planoAlimentar);
            return planoAlimentar;
        },
        findUnique: async ({ where }: any) => this.planosAlimentares.get(where.id) ?? null,
    };

    planoAlimentarItem = {
        create: async ({ data }: any) => {
            const item = { id: randomUUID(), ...data };
            this.planoAlimentarItens.set(item.id, item);
            return item;
        },
    };
}

describe('PlanoAlimentar (integration)', () => {
    let app: INestApplication;
    let prisma: FakePrismaService;

    const profissionalDono = { id: randomUUID(), usuarioId: randomUUID() };
    const outroProfissional = { id: randomUUID(), usuarioId: randomUUID() };
    const paciente = { id: randomUUID(), usuarioId: randomUUID(), profissionalId: profissionalDono.id };
    const pacienteSemVinculo = { id: randomUUID(), usuarioId: randomUUID(), profissionalId: null };

    const asAdmin = () => ({ 'x-user-sub': randomUUID(), 'x-user-tipo': TipoUsuario.admin });
    const asProfissionalDono = () => ({ 'x-user-sub': profissionalDono.usuarioId, 'x-user-tipo': TipoUsuario.profissional });
    const asOutroProfissional = () => ({ 'x-user-sub': outroProfissional.usuarioId, 'x-user-tipo': TipoUsuario.profissional });
    const asPaciente = () => ({ 'x-user-sub': paciente.usuarioId, 'x-user-tipo': TipoUsuario.paciente });

    const itemValido = {
        receitaId: randomUUID(),
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

        prisma = moduleRef.get(PrismaService) as unknown as FakePrismaService;
        prisma.profissionais.set(profissionalDono.id, profissionalDono);
        prisma.profissionais.set(outroProfissional.id, outroProfissional);
        prisma.pacientes.set(paciente.id, paciente);
        prisma.pacientes.set(pacienteSemVinculo.id, pacienteSemVinculo);
    });

    afterAll(async () => {
        await app.close();
    });

    describe('POST /api/plano-alimentar/pacientes/:pacienteId', () => {
        const body = { nome: 'Plano de emagrecimento', dataInicio: '2026-01-01', dataFim: '2026-01-31' };

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

            it('permite que o profissional dono adicione itens à grade dia x refeição', async () => {
                const res = await request(app.getHttpServer())
                    .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
                    .set(asProfissionalDono())
                    .send(itemValido)
                    .expect(201);

                expect(res.body.planoAlimentarId).toBe(planoAlimentarId);
                expect(res.body.diaSemana).toBe(DiaSemana.segunda);
                expect(res.body.tipoRefeicao).toBe(TipoRefeicao.cafe_da_manha);

                const outroItem = { ...itemValido, diaSemana: DiaSemana.terca, tipoRefeicao: TipoRefeicao.almoco };
                await request(app.getHttpServer())
                    .post(`/api/plano-alimentar/${planoAlimentarId}/itens`)
                    .set(asProfissionalDono())
                    .send(outroItem)
                    .expect(201);

                expect(prisma.planoAlimentarItens.size).toBe(2);
            });
        });
    });
});
