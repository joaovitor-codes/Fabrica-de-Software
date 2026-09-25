import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PontosTransacao, Prisma, TipoTransacaoPontos } from '@prisma/client';
import { AjustePontosDto } from './dtos/ajuste-pontos';

@Injectable()
export class PontosTransacaoService {
    constructor(
        private readonly prismaService: PrismaService,
    ){}

    async createPontoTransacao(profissionalId: string, tipoTransacao: TipoTransacaoPontos, pontos: number, descricao: string, tx?: Prisma.TransactionClient): Promise<PontosTransacao>{
        if (!tx) {
            return this.prismaService.$transaction((novaTx) =>
                this.createPontoTransacao(profissionalId, tipoTransacao, pontos, descricao, novaTx),
            );
        }

        try {
            const transacaoCriada = await tx.pontosTransacao.create({
                data: {
                    profissionalId,
                    tipo: tipoTransacao,
                    pontos,
                    descricao
                }
            });

            await tx.profissional.update({
                where: {
                    id: profissionalId
                },
                data: {
                    pontosIncentivo: {
                        increment: pontos
                    }
                }
            });

            return transacaoCriada;
        } catch (error) {
            if(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'){
                throw new NotFoundException('Profissional não encontrado');
            }
            throw error;
        }
    }

    async exigirProfissionalExistente(profissionalId: string){
        const profissional = await this.prismaService.profissional.findUnique({
            where: { id: profissionalId }
        });

        if(!profissional){
            throw new NotFoundException('Profissional não encontrado');
        }

        return profissional;
    }

    async getSaldo(profissionalId: string): Promise<number>{
        const saldo = await this.prismaService.pontosTransacao.aggregate({
            where: { profissionalId },
            _sum: { pontos: true },
        });

        return saldo._sum.pontos || 0;
    }

    async historicoTransacoes(profissionalId: string, page: number = 1, limit: number = 10){
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.prismaService.pontosTransacao.findMany({
                where: { profissionalId },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            this.prismaService.pontosTransacao.count({
                where: { profissionalId },
            }),
        ]);

        return {
            data,
            meta: { total, page, last_page: Math.ceil(total / limit), limit },
        };
    }

    async ajusteManual(adminId: string, dto: AjustePontosDto): Promise<PontosTransacao>{
        return this.prismaService.$transaction(async (tx) => {
            const transacao = await this.createPontoTransacao(
                dto.profissionalId,
                TipoTransacaoPontos.ajuste_manual,
                dto.pontos,
                `${dto.descricao} (ajuste realizado pelo admin ${adminId})`,
                tx,
            );

            const profissional = await tx.profissional.findUnique({
                where: { id: dto.profissionalId },
                select: { pontosIncentivo: true },
            });

            // lançar erro aqui desfaz a transação criada e o update do saldo
            if(profissional!.pontosIncentivo < 0){
                throw new BadRequestException('O ajuste deixaria o saldo do profissional negativo');
            }

            return transacao;
        });
    }
}
