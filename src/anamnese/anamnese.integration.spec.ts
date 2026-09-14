import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { TipoResposta, TipoUsuario } from '@prisma/client';
import { AnamneseModule } from './anamnese.module';
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
 * módulo de anamnese, permitindo um teste de integração real (controller +
 * guards + services + validação de DTO) sem depender de um banco Postgres.
 */
class FakePrismaService {
    pacientes = new Map<string, any>();
    profissionais = new Map<string, any>();
    perguntas = new Map<string, any>();
    opcoes = new Map<string, any>();
    anamneses = new Map<string, any>();
    respostas = new Map<string, any>();

    paciente = {
        findUnique: async ({ where }: any) => {
            if (where.id) return this.pacientes.get(where.id) ?? null;
            if (where.usuarioId) {
                return [...this.pacientes.values()].find((p) => p.usuarioId === where.usuarioId) ?? null;
            }
            return null;
        },
        findMany: async ({ where }: any) => {
            let result = [...this.pacientes.values()];
            if (where?.profissionalId !== undefined) result = result.filter((p) => p.profissionalId === where.profissionalId);
            return result;
        },
    };

    profissional = {
        findUnique: async ({ where }: any) => {
            if (where.id) return this.profissionais.get(where.id) ?? null;
            if (where.usuarioId) {
                return [...this.profissionais.values()].find((p) => p.usuarioId === where.usuarioId) ?? null;
            }
            return null;
        },
    };

    anamnesePergunta = {
        create: async ({ data }: any) => {
            const pergunta = { id: randomUUID(), ...data };
            this.perguntas.set(pergunta.id, pergunta);
            return pergunta;
        },
        findUnique: async ({ where }: any) => this.perguntas.get(where.id) ?? null,
        findMany: async ({ where }: any) => {
            let result = [...this.perguntas.values()];
            if (where?.ativa !== undefined) result = result.filter((p) => p.ativa === where.ativa);
            if (where?.id?.in) result = result.filter((p) => where.id.in.includes(p.id));
            return result;
        },
        count: async ({ where }: any) => [...this.perguntas.values()].filter((p) => p.perguntaId === where.perguntaId).length,
    };

    anamneseOpcao = {
        create: async ({ data }: any) => {
            const opcao = { id: randomUUID(), ...data };
            this.opcoes.set(opcao.id, opcao);
            return opcao;
        },
        findMany: async ({ where }: any) => [...this.opcoes.values()].filter((o) => o.perguntaId === where.perguntaId),
        count: async ({ where }: any) => [...this.opcoes.values()].filter((o) => o.perguntaId === where.perguntaId).length,
    };

    anamnese = {
        create: async ({ data }: any) => {
            const id = randomUUID();
            const respostas = (data.respostas?.create ?? []).map((r: any) => ({ id: randomUUID(), anamneseId: id, ...r }));
            const anamnese = {
                id,
                pacienteId: data.pacienteId,
                profissionalId: data.profissionalId,
                observacoesGerais: data.observacoesGerais ?? null,
                respostas,
            };
            respostas.forEach((r: any) => this.respostas.set(r.id, r));
            this.anamneses.set(id, anamnese);
            return anamnese;
        },
        findUnique: async ({ where }: any) => {
            const anamnese = this.anamneses.get(where.id);
            if (!anamnese) return null;
            return { ...anamnese, respostas: [...this.respostas.values()].filter((r) => r.anamneseId === anamnese.id) };
        },
    };

    anamneseResposta = {
        create: async ({ data }: any) => {
            const resposta = { id: randomUUID(), ...data };
            this.respostas.set(resposta.id, resposta);
            return resposta;
        },
        findUnique: async ({ where }: any) => {
            const resposta = this.respostas.get(where.id);
            if (!resposta) return null;
            return {
                ...resposta,
                pergunta: this.perguntas.get(resposta.perguntaId),
                anamnese: this.anamneses.get(resposta.anamneseId),
            };
        },
    };
}

describe('Anamnese (integration)', () => {
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

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [PrismaModule, AnamneseModule],
        })
            .overrideProvider(PrismaService)
            .useClass(FakePrismaService)
            .overrideGuard(AuthGuard)
            .useClass(FakeAuthGuard)
            .compile();

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new ValidationPipe());
        await app.init();

        prisma = moduleRef.get(PrismaService) as unknown as FakePrismaService;
        prisma.pacientes.set(paciente.id, paciente);
        prisma.pacientes.set(pacienteSemVinculo.id, pacienteSemVinculo);
        prisma.profissionais.set(profissionalDono.id, profissionalDono);
        prisma.profissionais.set(outroProfissional.id, outroProfissional);
    });

    afterAll(async () => {
        await app.close();
    });

    it('rejeita quem não é admin ao tentar criar pergunta', async () => {
        await request(app.getHttpServer())
            .post('/api/anamnese/perguntas')
            .set(asProfissionalDono())
            .send({ texto: 'Possui alergias?', tipoResposta: TipoResposta.escolha_unica })
            .expect(403);
    });

    it('rejeita ID de pergunta com formato inválido', async () => {
        await request(app.getHttpServer())
            .get('/api/anamnese/perguntas/id-invalido')
            .set(asAdmin())
            .expect(400);
    });

    let perguntaEscolhaId: string;
    let opcaoSimId: string;

    it('permite que o admin crie uma pergunta e uma opção, visível para outros papéis', async () => {
        const perguntaRes = await request(app.getHttpServer())
            .post('/api/anamnese/perguntas')
            .set(asAdmin())
            .send({ texto: 'Possui alergias?', tipoResposta: TipoResposta.escolha_unica, categoria: 'Alergias', ordem: 1 })
            .expect(201);
        perguntaEscolhaId = perguntaRes.body.id;

        const opcaoRes = await request(app.getHttpServer())
            .post(`/api/anamnese/perguntas/${perguntaEscolhaId}/opcoes`)
            .set(asAdmin())
            .send({ perguntaId: perguntaEscolhaId, textoOpcao: 'Sim' })
            .expect(201);
        opcaoSimId = opcaoRes.body.id;

        const listagem = await request(app.getHttpServer())
            .get('/api/anamnese/perguntas/page/1/limit/10')
            .set(asProfissionalDono())
            .expect(200);
        expect(listagem.body.map((p: any) => p.id)).toContain(perguntaEscolhaId);
    });

    let anamneseId: string;

    it('permite que o profissional crie uma anamnese com resposta válida para o paciente', async () => {
        const res = await request(app.getHttpServer())
            .post('/api/anamnese')
            .set(asProfissionalDono())
            .send({
                pacienteId: paciente.id,
                observacoesGerais: 'Paciente relata intolerância à lactose',
                respostas: [{ perguntaId: perguntaEscolhaId, opcaoId: opcaoSimId }],
            })
            .expect(201);

        anamneseId = res.body.id;
        expect(res.body.profissionalId).toBe(profissionalDono.id);
        expect(res.body.respostas).toHaveLength(1);
    });

    it('rejeita resposta com campo incompatível com o tipo da pergunta', async () => {
        await request(app.getHttpServer())
            .post('/api/anamnese')
            .set(asProfissionalDono())
            .send({
                pacienteId: paciente.id,
                respostas: [{ perguntaId: perguntaEscolhaId, respostaTexto: 'Sim' }],
            })
            .expect(400);
    });

    it('rejeita criação de anamnese para paciente inexistente', async () => {
        await request(app.getHttpServer())
            .post('/api/anamnese')
            .set(asProfissionalDono())
            .send({ pacienteId: randomUUID() })
            .expect(404);
    });

    it('rejeita profissional criando anamnese para paciente que não é dele (BOLA)', async () => {
        await request(app.getHttpServer())
            .post('/api/anamnese')
            .set(asOutroProfissional())
            .send({ pacienteId: paciente.id })
            .expect(403);

        await request(app.getHttpServer())
            .post('/api/anamnese')
            .set(asProfissionalDono())
            .send({ pacienteId: pacienteSemVinculo.id })
            .expect(403);
    });

    it('permite que o profissional dono e o paciente dono leiam a anamnese', async () => {
        await request(app.getHttpServer())
            .get(`/api/anamnese/${anamneseId}`)
            .set(asProfissionalDono())
            .expect(200);

        await request(app.getHttpServer())
            .get(`/api/anamnese/${anamneseId}`)
            .set(asPaciente())
            .expect(200);
    });

    it('bloqueia leitura da anamnese por outro profissional', async () => {
        await request(app.getHttpServer())
            .get(`/api/anamnese/${anamneseId}`)
            .set(asOutroProfissional())
            .expect(403);
    });

    it('bloqueia outro profissional de registrar resposta em anamnese que não é sua', async () => {
        await request(app.getHttpServer())
            .post(`/api/anamnese/${anamneseId}/respostas`)
            .set(asOutroProfissional())
            .send({ perguntaId: perguntaEscolhaId, opcaoId: opcaoSimId })
            .expect(403);
    });

    it('permite que o profissional dono registre uma nova resposta na anamnese', async () => {
        const res = await request(app.getHttpServer())
            .post(`/api/anamnese/${anamneseId}/respostas`)
            .set(asProfissionalDono())
            .send({ perguntaId: perguntaEscolhaId, opcaoId: opcaoSimId })
            .expect(201);

        expect(res.body.anamneseId).toBe(anamneseId);
    });
});
