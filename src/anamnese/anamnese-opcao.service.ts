import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createAnamneseOpcaoalDto, updateAnamneseOpcaoalDto } from './dtos/anamnese';
import { mapPrismaNotFound } from './anamnese-resposta.util';

@Injectable()
export class AnamneseOpcaoService {
    constructor(private readonly prismaService: PrismaService) {}

    async createAnamneseOpcao(data: createAnamneseOpcaoalDto){
        try{
            const opcao = await this.prismaService.anamneseOpcao.create({
                data: {
                    perguntaId: data.perguntaId,
                    textoOpcao: data.textoOpcao
                }
            })
            return opcao;
        }catch(error){
            console.error('Erro ao criar opção da anamnese:', error);
            throw error;
        }
    }

    async patchAnamneseOpcao(id: string, data: updateAnamneseOpcaoalDto){
        try{
            const opcao = await this.prismaService.anamneseOpcao.update({
                where: { id },
                data: {
                    textoOpcao: data.textoOpcao
                }
            })
            return opcao;
        }catch(error){
            console.error('Erro ao atualizar opção da anamnese:', error);
            mapPrismaNotFound(error, 'Opção não encontrada');
        }
    }

    async getAllOpcoes(perguntaId: string){
        try {
            const pergunta = await this.prismaService.anamnesePergunta.findUnique({
                where: { id: perguntaId },
            });

            if(!pergunta){
                throw new NotFoundException('Pergunta não encontrada');
            }

            return await this.prismaService.anamneseOpcao.findMany({
                where: { perguntaId: perguntaId }
            });
        } catch (error) {
            console.error('Erro ao buscar opções da anamnese:', error);
            throw error;
        }
    }

    async deleteAnamneseOpcao(id: string){
        try {
            await this.prismaService.anamneseOpcao.delete({
                where: { id }
            })
        } catch (error) {
            console.error('Erro ao deletar opção da anamnese:', error);
            mapPrismaNotFound(error, 'Opção não encontrada');
        }
    }
}
