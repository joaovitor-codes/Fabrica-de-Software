import { DiaSemana, TipoRefeicao } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';

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
  @IsNotEmpty()
  @IsUUID('4', { message: 'receitaId deve ser um UUID válido' })
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
}

export class UpdatePlanoAlimentarDto {
  @IsOptional()
  @IsNotEmpty()
  nome?: string;
  @IsOptional()
  @IsDateString()
  dataInicio?: string;
  @IsOptional()
  @IsDateString()
  dataFim?: string;
}

export class UpdatePlanoAlimentarItemDto {
  @IsOptional()
  @IsUUID('4', { message: 'receitaId deve ser um UUID válido' })
  receitaId?: string;
  @IsOptional()
  @IsEnum(DiaSemana)
  diaSemana?: DiaSemana;
  @IsOptional()
  @IsEnum(TipoRefeicao)
  tipoRefeicao?: TipoRefeicao;
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'horarioSugerido deve estar no formato HH:mm ou HH:mm:ss',
  })
  horarioSugerido?: string;
}
