/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { StatusAprovacao, TipoTransacaoPontos } from '@prisma/client';
import { ReceitaService } from './receita.service';
import { PontosTransacaoService } from '../pontos-transacao/pontos-transacao.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioService } from '../usuario/usuario.service';
import { CacheService } from '../cache/cache.service';

/**
 * Fake em memória com rollback no $transaction, cobrindo só o que a
 * aprovação/rejeição de receita e a criação de pontos usam.
 */
class FakePrismaService {
    profissionais = new Map<string, any>();
    receitas = new Map<string, any>();
    transacoes = new Map<string, any>();
    transactionCalls = 0;

    async $transaction(fn: (tx: any) => Promise<any>) {
        this.transactionCalls++;
        const snapshot = {
            profissionais: structuredClone([...this.profissionais]),
            receitas: structuredClone([...this.receitas]),
            transacoes: structuredClone([...this.transacoes]),
        };

        try {
            return await fn(this);
        } catch (error) {
            this.profissionais = new Map(snapshot.profissionais);
            this.receitas = new Map(snapshot.receitas);
            this.transacoes = new Map(snapshot.transacoes);
            throw error;
        }
    }

    profissional = {
        findUnique: async ({ where }: any) =>
            [...this.profissionais.values()].find((p) => p.usuarioId === where.usuarioId) ?? null,
        update: async ({ where, data }: any) => {
            const profissional = this.profissionais.get(where.id);
            profissional.pontosIncentivo += data.pontosIncentivo.increment;
            return profissional;
        },
    };

    receita = {
        findUnique: async ({ where }: any) => this.receitas.get(where.id) ?? null,
        update: async ({ where, data }: any) => {
            const receita = { ...this.receitas.get(where.id), ...data };
            this.receitas.set(where.id, receita);
            return receita;
        },
    };

    pontosTransacao = {
        create: async ({ data }: any) => {
            const transacao = { id: randomUUID(), ...data };
            this.transacoes.set(transacao.id, transacao);
            return transacao;
        },
    };
}

describe('ReceitaService - pontos na aprovação/rejeição', () => {
    let service: ReceitaService;
    let pontosService: PontosTransacaoService;
    let prisma: FakePrismaService;

    const profissional = { id: randomUUID(), usuarioId: randomUUID(), statusAprovacao: StatusAprovacao.aprovado };
    let receitaId: string;

    beforeEach(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                ReceitaService,
                PontosTransacaoService,
                { provide: PrismaService, useClass: FakePrismaService },
                { provide: UsuarioService, useValue: {} },
                { provide: CacheService, useValue: {} },
            ],
        }).compile();

        service = moduleRef.get(ReceitaService);
        pontosService = moduleRef.get(PontosTransacaoService);
        prisma = moduleRef.get(PrismaService) as unknown as FakePrismaService;

        prisma.profissionais.set(profissional.id, { ...profissional, pontosIncentivo: 0 });
        receitaId = randomUUID();
        prisma.receitas.set(receitaId, { id: receitaId, nome: 'Omelete', status: 'pendente' });
    });

    it('aprova a receita e credita 10 pontos na mesma transação', async () => {
        await service.aprovarReceita(receitaId, profissional.usuarioId);

        expect(prisma.receitas.get(receitaId).status).toBe('aprovada');
        expect(prisma.profissionais.get(profissional.id).pontosIncentivo).toBe(10);
        expect([...prisma.transacoes.values()]).toEqual([
            expect.objectContaining({ tipo: TipoTransacaoPontos.ganho_aprovacao, pontos: 10 }),
        ]);
        expect(prisma.transactionCalls).toBe(1);
    });

    it('rejeita a receita e credita 5 pontos na mesma transação', async () => {
        await service.rejeitarReceita(receitaId, profissional.usuarioId);

        expect(prisma.receitas.get(receitaId).status).toBe('rejeitada');
        expect(prisma.profissionais.get(profissional.id).pontosIncentivo).toBe(5);
        expect([...prisma.transacoes.values()]).toEqual([
            expect.objectContaining({ tipo: TipoTransacaoPontos.ganho_rejeicao, pontos: 5 }),
        ]);
        expect(prisma.transactionCalls).toBe(1);
    });

    it('desfaz a aprovação da receita se a criação dos pontos falhar', async () => {
        jest.spyOn(pontosService, 'createPontoTransacao').mockRejectedValueOnce(new Error('falha nos pontos'));

        await expect(service.aprovarReceita(receitaId, profissional.usuarioId)).rejects.toThrow('falha nos pontos');

        expect(prisma.receitas.get(receitaId).status).toBe('pendente');
        expect(prisma.profissionais.get(profissional.id).pontosIncentivo).toBe(0);
    });

    it('desfaz os pontos se a transação da aprovação falhar depois de creditá-los', async () => {
        const original = pontosService.createPontoTransacao.bind(pontosService);
        jest.spyOn(pontosService, 'createPontoTransacao').mockImplementationOnce(async (...args) => {
            await original(...args);
            throw new Error('falha depois dos pontos');
        });

        await expect(service.aprovarReceita(receitaId, profissional.usuarioId)).rejects.toThrow('falha depois dos pontos');

        expect(prisma.transacoes.size).toBe(0);
        expect(prisma.profissionais.get(profissional.id).pontosIncentivo).toBe(0);
        expect(prisma.receitas.get(receitaId).status).toBe('pendente');
    });
});
