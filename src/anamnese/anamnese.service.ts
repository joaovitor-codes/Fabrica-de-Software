import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createAnamneseDto } from './dtos/anamnese';
import { TipoUsuario } from '@prisma/client';
import { AnamneseAcessoService } from './anamnese-acesso.service';
import { validarCamposPorTipoResposta } from './anamnese-resposta.util';

@Injectable()
export class AnamneseService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly anamneseAcessoService: AnamneseAcessoService,
    ) {}

    async createAnamnese(data: createAnamneseDto, usuarioId: string){
        try{
            const [paciente, profissional] = await Promise.all([
                this.prismaService.paciente.findUnique({ where: { id: data.pacienteId } }),
                this.anamneseAcessoService.resolverProfissionalPorUsuario(usuarioId),
            ]);

            if(!paciente){
                throw new NotFoundException('Paciente não encontrado');
            }

            if(paciente.profissionalId !== profissional.id){
                throw new ForbiddenException('Você não tem permissão para criar uma anamnese para este paciente.');
            }

            if(data.respostas?.length){
                const perguntas = await this.prismaService.anamnesePergunta.findMany({
                    where: { id: { in: data.respostas.map((resposta) => resposta.perguntaId) } },
                });
                const perguntaPorId = new Map(perguntas.map((pergunta) => [pergunta.id, pergunta]));

                for(const resposta of data.respostas){
                    const pergunta = perguntaPorId.get(resposta.perguntaId);
                    if(!pergunta){
                        throw new NotFoundException(`Pergunta ${resposta.perguntaId} não encontrada`);
                    }
                    validarCamposPorTipoResposta(pergunta.tipoResposta, resposta);
                }
            }

            const anamnese = await this.prismaService.anamnese.create({
                data: {
                    pacienteId: data.pacienteId,
                    profissionalId: profissional.id,
                    observacoesGerais: data.observacoesGerais,
                    respostas: data.respostas?.length
                        ? {
                            create: data.respostas.map((resposta) => ({
                                perguntaId: resposta.perguntaId,
                                respostaTexto: resposta.respostaTexto,
                                respostaNumero: resposta.respostaNumero,
                                opcaoId: resposta.opcaoId,
                            })),
                        }
                        : undefined
                },
                include: { respostas: true },
            });

            return anamnese;
        }catch(error){
            console.error('Erro ao criar anamnese:', error);
            throw error;
        }
    }

    async getAnamneseById(id: string, usuarioId: string, tipoUsuario: TipoUsuario){
        try{
            const anamnese = await this.prismaService.anamnese.findUnique({
                where: { id },
                include: { respostas: true },
            });

            if(!anamnese){
                throw new NotFoundException('Anamnese não encontrada');
            }

            if(tipoUsuario !== TipoUsuario.admin){
                const [profissional, paciente] = await Promise.all([
                    this.prismaService.profissional.findUnique({ where: { usuarioId } }),
                    this.prismaService.paciente.findUnique({ where: { usuarioId } }),
                ]);

                const ehProfissionalDono = profissional?.id === anamnese.profissionalId;
                const ehPacienteDono = paciente?.id === anamnese.pacienteId;

                if(!ehProfissionalDono && !ehPacienteDono){
                    throw new ForbiddenException('Você não tem permissão para acessar esta anamnese.');
                }
            }

            return anamnese;
        }catch(error){
            console.error('Erro ao buscar anamnese:', error);
            throw error;
        }
    }

}
