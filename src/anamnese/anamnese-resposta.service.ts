import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createAnamneseRespostaDto, updateAnamneseRespostaDto } from './dtos/anamnese';
import { AnamneseAcessoService } from './anamnese-acesso.service';
import { CamposResposta, mapPrismaNotFound, validarCamposPorTipoResposta } from './anamnese-resposta.util';

@Injectable()
export class AnamneseRespostaService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly anamneseAcessoService: AnamneseAcessoService,
    ) {}

    async createAnamneseResposta(anamneseId: string, data: createAnamneseRespostaDto, usuarioId: string){
        try{
            await this.anamneseAcessoService.resolverAnamneseDoProfissional(anamneseId, usuarioId);

            const pergunta = await this.prismaService.anamnesePergunta.findUnique({
                where: { id: data.perguntaId },
            });

            if(!pergunta){
                throw new NotFoundException('Pergunta não encontrada');
            }

            validarCamposPorTipoResposta(pergunta.tipoResposta, data);

            const resposta = await this.prismaService.anamneseResposta.create({
                data: {
                    anamneseId,
                    perguntaId: data.perguntaId,
                    respostaTexto: data.respostaTexto,
                    respostaNumero: data.respostaNumero,
                    opcaoId: data.opcaoId
                }
            })
            return resposta;
        }catch(error){
            console.error('Erro ao criar resposta da anamnese:', error);
            throw error;
        }
    }

    async patchAnamneseResposta(id: string, data: updateAnamneseRespostaDto, usuarioId: string){
        try{
            const respostaExistente = await this.prismaService.anamneseResposta.findUnique({
                where: { id },
                include: { pergunta: true, anamnese: true },
            });

            if(!respostaExistente){
                throw new NotFoundException('Resposta não encontrada');
            }

            const profissional = await this.anamneseAcessoService.resolverProfissionalPorUsuario(usuarioId);
            if(respostaExistente.anamnese.profissionalId !== profissional.id){
                throw new ForbiddenException('Você só pode alterar respostas de anamneses que você criou.');
            }

            const camposMesclados: CamposResposta = {
                respostaTexto: data.respostaTexto !== undefined ? data.respostaTexto : respostaExistente.respostaTexto,
                respostaNumero: data.respostaNumero !== undefined ? data.respostaNumero : respostaExistente.respostaNumero,
                opcaoId: data.opcaoId !== undefined ? data.opcaoId : respostaExistente.opcaoId,
            };

            validarCamposPorTipoResposta(respostaExistente.pergunta.tipoResposta, camposMesclados);

            const resposta = await this.prismaService.anamneseResposta.update({
                where: { id },
                data: {
                    respostaTexto: camposMesclados.respostaTexto,
                    respostaNumero: camposMesclados.respostaNumero,
                    opcaoId: camposMesclados.opcaoId,
                }
            })
            return resposta;
        }catch(error){
            console.error('Erro ao atualizar resposta da anamnese:', error);
            if(error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException){
                throw error;
            }
            mapPrismaNotFound(error, 'Resposta não encontrada');
        }
    }

    async deleteAnamneseResposta(id: string, usuarioId: string){
        try{
            const respostaExistente = await this.prismaService.anamneseResposta.findUnique({
                where: { id },
                include: { anamnese: true },
            });

            if(!respostaExistente){
                throw new NotFoundException('Resposta não encontrada');
            }

            const profissional = await this.anamneseAcessoService.resolverProfissionalPorUsuario(usuarioId);
            if(respostaExistente.anamnese.profissionalId !== profissional.id){
                throw new ForbiddenException('Você só pode remover respostas de anamneses que você criou.');
            }

            await this.prismaService.anamneseResposta.delete({
                where: { id }
            })
        }catch(error){
            console.error('Erro ao deletar resposta da anamnese:', error);
            if(error instanceof NotFoundException || error instanceof ForbiddenException){
                throw error;
            }
            mapPrismaNotFound(error, 'Resposta não encontrada');
        }
    }
}
