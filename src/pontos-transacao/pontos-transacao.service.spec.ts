/// <reference types="jest" />

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Prisma, TipoTransacaoPontos } from '@prisma/client';
import { PontosTransacaoService } from './pontos-transacao.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Fake em memória do PrismaService com suporte a rollback: o $transaction tira
 * um snapshot dos dados e restaura tudo se a callback lançar erro, imitando o
 * comportamento "tudo ou nada" do banco.
 */
class FakePrismaService {
    profissionais = new Map<string, any>();
    transacoes = new Map<string, any>();
    transactionCalls = 0;

    async $transaction(fn: (tx: any) => Promise<any>) {
        this.transactionCalls++;
        const snapshot = {
            profissionais: structuredClone([...this.profissionais]),
            transacoes: structuredClone([...this.transacoes]),
        };

        try {
            return await fn(this);
        } catch (error) {
            this.profissionais = new Map(snapshot.profissionais);
            this.transacoes = new Map(snapshot.transacoes);
            throw error;
        }
    }

    pontosTransacao = {
        create: async ({ data }: any) => {
            if (!this.profissionais.has(data.profissionalId)) {
                throw new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
                    code: 'P2003',
                    clientVersion: 'test',
                });
            }
            const transacao = { id: randomUUID(), createdAt: new Date(), ...data };
            this.transacoes.set(transacao.id, transacao);
            return transacao;
        },
        findMany: async ({ where }: any) =>
            [...this.transacoes.values()]
                .filter((t) => t.profissionalId === where.profissionalId)
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    };

    profissional = {
        update: async ({ where, data }: any) => {
            const profissional = this.profissionais.get(where.id);
            if (!profissional) {
                throw new Prisma.PrismaClientKnownRequestError('Record not found', {
                    code: 'P2025',
                    clientVersion: 'test',
                });
            }
            profissional.pontosIncentivo += data.pontosIncentivo.increment;
            return profissional;
        },
    };
}

describe('PontosTransacaoService', () => {
    let service: PontosTransacaoService;
    let prisma: FakePrismaService;
    let profissionalId: string;

    beforeEach(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [PontosTransacaoService, { provide: PrismaService, useClass: FakePrismaService }],
        }).compile();

        service = moduleRef.get(PontosTransacaoService);
        prisma = moduleRef.get(PrismaService) as unknown as FakePrismaService;

        profissionalId = randomUUID();
        prisma.profissionais.set(profissionalId, { id: profissionalId, pontosIncentivo: 0 });
    });

    describe('createPontoTransacao', () => {
        it('cria a transação e incrementa os pontos do profissional', async () => {
            const transacao = await service.createPontoTransacao(
                profissionalId,
                TipoTransacaoPontos.ganho_aprovacao,
                10,
                'Aprovação da receita: Omelete',
            );

            expect(transacao).toMatchObject({
                profissionalId,
                tipo: TipoTransacaoPontos.ganho_aprovacao,
                pontos: 10,
                descricao: 'Aprovação da receita: Omelete',
            });
            expect(prisma.transacoes.size).toBe(1);
            expect(prisma.profissionais.get(profissionalId).pontosIncentivo).toBe(10);
        });

        it('decrementa os pontos quando o valor é negativo (resgate)', async () => {
            prisma.profissionais.get(profissionalId).pontosIncentivo = 30;

            await service.createPontoTransacao(profissionalId, TipoTransacaoPontos.resgate_desconto, -20, 'Resgate');

            expect(prisma.profissionais.get(profissionalId).pontosIncentivo).toBe(10);
        });

        it('abre a própria transação quando nenhum tx é informado', async () => {
            await service.createPontoTransacao(profissionalId, TipoTransacaoPontos.ajuste_manual, 5, 'Ajuste');

            expect(prisma.transactionCalls).toBe(1);
        });

        it('usa o tx recebido sem abrir uma nova transação', async () => {
            await prisma.$transaction(async (tx) => {
                await service.createPontoTransacao(profissionalId, TipoTransacaoPontos.ganho_aprovacao, 10, 'Aprovação', tx);
            });

            expect(prisma.transactionCalls).toBe(1);
            expect(prisma.profissionais.get(profissionalId).pontosIncentivo).toBe(10);
        });

        it('lança NotFoundException quando o profissional não existe e não grava nada', async () => {
            await expect(
                service.createPontoTransacao(randomUUID(), TipoTransacaoPontos.ganho_aprovacao, 10, 'Aprovação'),
            ).rejects.toBeInstanceOf(NotFoundException);

            expect(prisma.transacoes.size).toBe(0);
        });

        it('desfaz a criação da transação se a atualização dos pontos falhar', async () => {
            jest.spyOn(prisma.profissional, 'update').mockRejectedValueOnce(new Error('falha no update'));

            await expect(
                service.createPontoTransacao(profissionalId, TipoTransacaoPontos.ganho_aprovacao, 10, 'Aprovação'),
            ).rejects.toThrow('falha no update');

            expect(prisma.transacoes.size).toBe(0);
            expect(prisma.profissionais.get(profissionalId).pontosIncentivo).toBe(0);
        });

        it('relança erros desconhecidos sem convertê-los', async () => {
            const erro = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                code: 'P2002',
                clientVersion: 'test',
            });
            jest.spyOn(prisma.pontosTransacao, 'create').mockRejectedValueOnce(erro);

            await expect(
                service.createPontoTransacao(profissionalId, TipoTransacaoPontos.ganho_aprovacao, 10, 'Aprovação'),
            ).rejects.toBe(erro);
        });
    });

    describe('getPontosTransacaoById', () => {
        it('retorna as transações do profissional da mais recente para a mais antiga', async () => {
            const antiga = { id: randomUUID(), profissionalId, pontos: 5, createdAt: new Date('2026-01-01') };
            const recente = { id: randomUUID(), profissionalId, pontos: 10, createdAt: new Date('2026-02-01') };
            const deOutro = { id: randomUUID(), profissionalId: randomUUID(), pontos: 1, createdAt: new Date() };
            [antiga, recente, deOutro].forEach((t) => prisma.transacoes.set(t.id, t));

            const transacoes = await service.getPontosTransacaoById(profissionalId);

            expect(transacoes.map((t) => t.id)).toEqual([recente.id, antiga.id]);
        });

        it('lança NotFoundException quando o profissional não tem transações', async () => {
            await expect(service.getPontosTransacaoById(profissionalId)).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
