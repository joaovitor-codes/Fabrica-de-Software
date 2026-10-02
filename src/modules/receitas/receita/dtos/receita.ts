import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { NivelDificuldade } from '@prisma/client';
import { ReceitaIngredienteDTO } from './receita-ingrediente';

/**
 * O que quem cria a receita informa. Status, autor, aprovação e versão são
 * do sistema e não entram aqui.
 */
export class ReceitaDto {
  @ApiProperty({ example: 'Arroz com feijão' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nome!: string;

  @ApiPropertyOptional({ example: 'Clássico do dia a dia' })
  @IsOptional()
  @IsString()
  descricao?: string;

  @ApiPropertyOptional({ example: 'Cozinhe o arroz e o feijão separados.' })
  @IsOptional()
  @IsString()
  modoPreparo?: string;

  @ApiPropertyOptional({ example: 40 })
  @IsOptional()
  @IsInt()
  @Min(1)
  tempoPreparoMin?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  porcoes?: number;

  @ApiPropertyOptional({
    enum: NivelDificuldade,
    default: NivelDificuldade.medio,
  })
  @IsOptional()
  @IsEnum(NivelDificuldade)
  nivelDificuldade?: NivelDificuldade;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  avisoContaminacaoCruzada?: boolean;

  @ApiProperty({ type: [ReceitaIngredienteDTO] })
  @IsArray()
  @ArrayNotEmpty({ message: 'A receita deve ter pelo menos um ingrediente' })
  @ValidateNested({ each: true })
  @Type(() => ReceitaIngredienteDTO)
  ingredientes!: ReceitaIngredienteDTO[];
}
