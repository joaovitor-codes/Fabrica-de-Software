import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateComentarioRefeicaoDto } from "./dto/comentario-refeicao";
import { TipoUsuario } from "@prisma/client";

@Injectable()
export class ComentarioRefeicaoService {
    constructor(
        private readonly prismaService: PrismaService,
    ){}

    private async verificarItemPaciente(itemId: string, pacienteId: string){
        const item = await this.prismaService.planoAlimentarItem.findUnique({
            where: { id: itemId },
            include: { planoAlimentar: true }
        });
        
        if(!item){
            throw new NotFoundException(`Item do plano alimentar não encontrado`);
        }

        if(item.planoAlimentar.pacienteId !== pacienteId){
            throw new ForbiddenException(`Item do plano alimentar não pertence ao paciente`);
        }

        return item;
    }

    async criarComentario(itemId: string, pacienteId: string, autorId: string, dto: CreateComentarioRefeicaoDto){
        await this.verificarItemPaciente(itemId, pacienteId);

        return this.prismaService.comentarioRefeicao.create({
            data: {
                planoAlimentarItemId: itemId,
                autorId,
                comentario: dto.comentario
            },
        });
    }

    async findAll(itemId: string, usuarioId: string, tipoUsuario: TipoUsuario){
        const item = await this.prismaService.planoAlimentarItem.findUnique({
            where: { id: itemId },
            include: { planoAlimentar: true }
        });

        if(!item){
            throw new NotFoundException(`Item do plano alimentar não encontrado`);
        }

        if(tipoUsuario !== TipoUsuario.admin){
            const [profissional, paciente] = await Promise.all([
                this.prismaService.profissional.findUnique({ where: { id: usuarioId } }),
                this.prismaService.paciente.findUnique({ where: { id: usuarioId } })
            ]);

            const ehProfissionalDono = profissional?.id === item.planoAlimentar.profissionalId;
            const ehPacienteDono = paciente?.id === item.planoAlimentar.pacienteId;

            if(!ehProfissionalDono && !ehPacienteDono){
                throw new ForbiddenException(`Usuário não tem permissão para acessar os comentários deste item do plano alimentar`);
            }
        }

        return this.prismaService.comentarioRefeicao.findMany({
            where: { planoAlimentarItemId: itemId },
            orderBy: { createdAt: 'desc' },
            include: { autor: true }
        });
    }

}