import { ConflictException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createAnamnesePerguntaDto, updateAnamnesePerguntaDto } from './dtos/anamnese';
import { mapPrismaNotFound } from './anamnese-resposta.util';

@Injectable()
export class AnamnesePerguntaService {
    private readonly logger = new Logger(AnamnesePerguntaService.name);

    constructor(private readonly prismaService: PrismaService) {}

    async createAnamnesePergunta(data: createAnamnesePerguntaDto){
        try{
            const pergunta = await this.prismaService.anamnesePergunta.create({
                data: {
                    texto: data.texto,
                    tipoResposta: data.tipoResposta,
                    categoria: data.categoria,
                    ordem: data.ordem,
                    ativa: true,
                }
            });
            return pergunta;
        }catch(error){
            this.logger.error('Erro ao criar pergunta da anamnese:', error);
            throw error;
        }
    }

    async patchAnamnesePergunta(id: string, data: updateAnamnesePerguntaDto){
        try{
            const pergunta = await this.prismaService.anamnesePergunta.update({
                where: { id },
                data: {
                    texto: data.texto,
                    tipoResposta: data.tipoResposta,
                    categoria: data.categoria,
                    ordem: data.ordem,
                }
            });
            return pergunta;
        }catch(error){
            this.logger.error('Erro ao atualizar pergunta da anamnese:', error);
            mapPrismaNotFound(error, 'Pergunta não encontrada');
        }
    }

    async desativarAnamnesePergunta(id: string){
        try{
            await this.prismaService.anamnesePergunta.update({
                where: { id },
                data: {
                    ativa: false,
                }
            })
        }catch(error){
            this.logger.error('Erro ao desativar pergunta da anamnese:', error);
            mapPrismaNotFound(error, 'Pergunta não encontrada');
        }
    }

    async ativarAnamnesePergunta(id: string){
        try{
            await this.prismaService.anamnesePergunta.update({
                where: { id },
                data: {
                    ativa: true,
                }
            })
        }catch(error){
            this.logger.error('Erro ao ativar pergunta da anamnese:', error);
            mapPrismaNotFound(error, 'Pergunta não encontrada');
        }
    }

    async deleteAnamnesePergunta(id: string){
        try{
            const [opcoes, respostas] = await Promise.all([
                this.prismaService.anamneseOpcao.count({ where: { perguntaId: id } }),
                this.prismaService.anamneseResposta.count({ where: { perguntaId: id } }),
            ]);

            if(opcoes > 0 || respostas > 0){
                throw new ConflictException(
                    'Não é possível excluir uma pergunta que já possui opções ou respostas vinculadas. Desative-a em vez de excluir.',
                );
            }

            await this.prismaService.anamnesePergunta.delete({
                where: { id }
            });
        }catch(error){
            this.logger.error('Erro ao deletar pergunta da anamnese:', error);
            if(error instanceof ConflictException){
                throw error;
            }
            mapPrismaNotFound(error, 'Pergunta não encontrada');
        }
    }

    async getAllAnamnesePerguntas(page: number, limit: number){
        try{
            const perguntas = await this.prismaService.anamnesePergunta.findMany({
                skip: (page - 1) * limit,
                take: limit,
                where: {
                    ativa: true
                },
                orderBy: {
                    ordem: 'asc',
                    categoria: 'asc'
                }
            });
            return perguntas;
        }catch(error){
            this.logger.error('Erro ao buscar perguntas da anamnese:', error);
            throw error;
        }
    }

    async getAnamnesePerguntaById(id: string){
        try{
            const pergunta = await this.prismaService.anamnesePergunta.findUnique({
                where: { id }
            });

            if(!pergunta){
                throw new NotFoundException('Pergunta não encontrada');
            }

            return pergunta;
        }catch(error){
            this.logger.error('Erro ao buscar pergunta da anamnese:', error);
            throw error;
        }
    }
}
