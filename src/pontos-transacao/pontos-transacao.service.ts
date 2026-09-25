import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PontosTransacao, Prisma, TipoTransacaoPontos } from '@prisma/client';

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

    async getPontosTransacaoById(profissionalId: string): Promise<PontosTransacao[]>{
        const transacoes = await this.prismaService.pontosTransacao.findMany({
            where: {
                profissionalId
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        if(transacoes.length === 0){
            throw new NotFoundException('Nenhuma transação encontrada para o profissional informado');
        }

        return transacoes;
    }
}
