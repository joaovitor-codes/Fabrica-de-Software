import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MarcarCheckListDto } from "./dto/checklist-refeicao";
import { TipoUsuario } from "@prisma/client";

@Injectable()
export class ChecklistRefeicaoService {
    constructor(
        private readonly prismaService: PrismaService
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

    async marcarCheckList(itemId: string, pacienteId: string, dto: MarcarCheckListDto){
        await this.verificarItemPaciente(itemId, pacienteId);

        return this.prismaService.checklistRefeicao.upsert({
            where: {
                planoAlimentarItemId_dataReferencia: {
                    planoAlimentarItemId: itemId,
                    dataReferencia: new Date(dto.dataReferencial)
                },
            },
            create: {
                planoAlimentarItemId: itemId,
                pacienteId,
                dataReferencia: new Date(dto.dataReferencial),
                concluido: dto.concluido,
                concluidoEm: dto.concluido ? new Date() : null
            },
            update: {
                concluido: dto.concluido,
                concluidoEm: dto.concluido ? new Date() : null
            },
        })
    }

    async findAll(itemId: string, usuarioId: string, tipoUsuario: TipoUsuario){
        const item = await this.prismaService.planoAlimentarItem.findUnique({
            where: { id: itemId },
            include: { planoAlimentar: true },
        });

        if(!item){
            throw new NotFoundException(`Item do plano alimentar não encontrado`);
        }
        
        if(tipoUsuario !== TipoUsuario.admin){
            const [profissional, paciente] = await Promise.all([
                this.prismaService.profissional.findUnique({ where: { usuarioId } }),
                this.prismaService.paciente.findUnique({ where: { usuarioId } })
            ]);

            const ehProfissionalDono = profissional?.id === item.planoAlimentar.profissionalId;
            const ehPacienteDono = paciente?.id === item.planoAlimentar.pacienteId;

            if(!ehProfissionalDono && !ehPacienteDono){
                throw new ForbiddenException(`Item do plano alimentar não pertence ao usuário`);
            }

            return this.prismaService.checklistRefeicao.findMany({
                where: { planoAlimentarItemId: itemId },
                orderBy: { dataReferencia: 'desc' }
            })
        }
    }

}