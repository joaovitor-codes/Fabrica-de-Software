import { ChecklistRefeicao, ComentarioRefeicao, DiaSemana, Notificacao, TipoRefeicao } from "@prisma/client";
import { IsDateString, IsNotEmpty, Matches } from "class-validator";

export class PlanoAlimentarDto {
    @IsNotEmpty()
    nome!: string;
    @IsDateString()
    @IsNotEmpty()
    dataInicio!: string;
    @IsDateString()
    @IsNotEmpty()
    dataFim!: string;
}

export class PlanoAlimentarItemDto {
    receitaId!: string;
    @IsNotEmpty()
    diaSemana!: DiaSemana;
    @IsNotEmpty()
    tipoRefeicao!: TipoRefeicao;
    @IsNotEmpty()
    @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
        message: 'horarioSugerido deve estar no formato HH:mm ou HH:mm:ss',
    })
    horarioSugerido!: string;

    checklistRefeicoes?: ChecklistRefeicao[]
    comentarios?: ComentarioRefeicao[];
    notificacoes?: Notificacao[];
}