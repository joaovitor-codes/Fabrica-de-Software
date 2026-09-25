/// <reference types="jest" />

import { BadRequestException, NotFoundException } from '@nestjs/common';
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
        findMany: async ({ where, skip = 0, take }: any) =>
            this.transacoesDo(where.profissionalId)
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(skip, take === undefined ? undefined : skip + take),
        count: async ({ where }: any) => this.transacoesDo(where.profissionalId).length,
        aggregate: async ({ where }: any) => {
            const transacoes = this.transacoesDo(where.profissionalId);
            return { _sum: { pontos: transacoes.length ? transacoes.reduce((soma, t) => soma + t.pontos, 0) : null } };
        },
    };

    private transacoesDo(profissionalId: string) {
        return [...this.transacoes.values()].filter((t) => t.profissionalId === profissionalId);
    }

    profissional = {
        findUnique: async ({ where }: any) => this.profissionais.get(where.id) ?? null,
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

    describe('exigirProfissionalExistente', () => {
        it('retorna o profissional quando ele existe', async () => {
            await expect(service.exigirProfissionalExistente(profissionalId)).resolves.toMatchObject({ id: profissionalId });
        });

        it('lança NotFoundException quando o profissional não existe', async () => {
            await expect(service.exigirProfissionalExistente(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('getSaldo', () => {
        it('soma os pontos de todas as transações do profissional', async () => {
            await service.createPontoTransacao(profissionalId, TipoTransacaoPontos.ganho_aprovacao, 10, 'Aprovação');
            await service.createPontoTransacao(profissionalId, TipoTransacaoPontos.ganho_rejeicao, 5, 'Rejeição');
            await service.createPontoTransacao(profissionalId, TipoTransacaoPontos.resgate_desconto, -3, 'Resgate');

            await expect(service.getSaldo(profissionalId)).resolves.toBe(12);
        });

        it('retorna 0 quando o profissional não tem transações', async () => {
            await expect(service.getSaldo(profissionalId)).resolves.toBe(0);
        });
    });

    describe('historicoTransacoes', () => {
        const criarTransacao = (pontos: number, createdAt: string, dono = profissionalId) => {
            const transacao = { id: randomUUID(), profissionalId: dono, pontos, createdAt: new Date(createdAt) };
            prisma.transacoes.set(transacao.id, transacao);
            return transacao;
        };

        it('retorna as transações do profissional da mais recente para a mais antiga', async () => {
            const antiga = criarTransacao(5, '2026-01-01');
            const recente = criarTransacao(10, '2026-02-01');
            criarTransacao(1, '2026-03-01', randomUUID());

            const resultado = await service.historicoTransacoes(profissionalId);

            expect(resultado.data.map((t) => t.id)).toEqual([recente.id, antiga.id]);
            expect(resultado.meta).toEqual({ total: 2, page: 1, last_page: 1, limit: 10 });
        });

        it('pagina o resultado', async () => {
            const transacoes = [1, 2, 3, 4, 5].map((dia) => criarTransacao(dia, `2026-01-0${dia}`));

            const resultado = await service.historicoTransacoes(profissionalId, 2, 2);

            expect(resultado.data.map((t) => t.id)).toEqual([transacoes[2].id, transacoes[1].id]);
            expect(resultado.meta).toEqual({ total: 5, page: 2, last_page: 3, limit: 2 });
        });

        it('retorna lista vazia quando o profissional não tem transações', async () => {
            const resultado = await service.historicoTransacoes(profissionalId);

            expect(resultado).toEqual({ data: [], meta: { total: 0, page: 1, last_page: 0, limit: 10 } });
        });
    });

    describe('ajusteManual', () => {
        const adminId = randomUUID();

        it('cria uma transação de ajuste_manual e atualiza o saldo', async () => {
            const transacao = await service.ajusteManual(adminId, { profissionalId, pontos: 15, descricao: 'Bônus de campanha' });

            expect(transacao).toMatchObject({ tipo: TipoTransacaoPontos.ajuste_manual, pontos: 15 });
            expect(prisma.profissionais.get(profissionalId).pontosIncentivo).toBe(15);
        });

        it('registra o admin responsável na descrição', async () => {
            const transacao = await service.ajusteManual(adminId, { profissionalId, pontos: 15, descricao: 'Bônus de campanha' });

            expect(transacao.descricao).toBe(`Bônus de campanha (ajuste realizado pelo admin ${adminId})`);
        });

        it('permite debitar pontos enquanto o saldo continuar não negativo', async () => {
            prisma.profissionais.get(profissionalId).pontosIncentivo = 10;

            await service.ajusteManual(adminId, { profissionalId, pontos: -10, descricao: 'Correção' });

            expect(prisma.profissionais.get(profissionalId).pontosIncentivo).toBe(0);
        });

        it('rejeita o ajuste e desfaz tudo quando o saldo ficaria negativo', async () => {
            prisma.profissionais.get(profissionalId).pontosIncentivo = 5;

            await expect(
                service.ajusteManual(adminId, { profissionalId, pontos: -10, descricao: 'Correção' }),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(prisma.transacoes.size).toBe(0);
            expect(prisma.profissionais.get(profissionalId).pontosIncentivo).toBe(5);
        });

        it('usa uma única transação para o ajuste e a checagem de saldo', async () => {
            await service.ajusteManual(adminId, { profissionalId, pontos: 15, descricao: 'Bônus' });

            expect(prisma.transactionCalls).toBe(1);
        });

        it('lança NotFoundException quando o profissional não existe', async () => {
            await expect(
                service.ajusteManual(adminId, { profissionalId: randomUUID(), pontos: 15, descricao: 'Bônus' }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
