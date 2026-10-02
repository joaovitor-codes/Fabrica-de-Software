import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ReceitaIngredienteDTO } from '../../receita/dtos/receita-ingrediente';

export class AdaptarReceitaDto {
  @ApiProperty({
    description: 'Restrição alimentar para a qual a receita será adaptada',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  restricaoId!: string;
}

export class SugestoesAdaptacaoDto {
  @ApiProperty({
    description: 'Paciente do profissional para quem a receita será adaptada',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  pacienteId!: string;
}

export class TrocaDto {
  @ApiProperty({ description: 'Ingrediente da receita original' })
  @IsUUID()
  ingredienteOrigemId!: string;

  @ApiProperty({ enum: ['substituir', 'remover'] })
  @IsIn(['substituir', 'remover'])
  acao!: 'substituir' | 'remover';

  @ApiPropertyOptional({ description: 'Substituto (quando acao = substituir)' })
  @IsOptional()
  @IsUUID()
  ingredienteDestinoId?: string;
}

export class AdaptacaoProfissionalDto extends SugestoesAdaptacaoDto {
  @ApiProperty({
    type: [ReceitaIngredienteDTO],
    description: 'Lista final de ingredientes escolhida pelo profissional',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'A receita deve ter pelo menos um ingrediente' })
  @ValidateNested({ each: true })
  @Type(() => ReceitaIngredienteDTO)
  ingredientes!: ReceitaIngredienteDTO[];

  @ApiPropertyOptional({
    description: 'Modo de preparo adaptado; sem ele, mantém o da original',
  })
  @IsOptional()
  @IsString()
  modoPreparo?: string;

  @ApiPropertyOptional({
    type: [TrocaDto],
    description:
      'Qual ingrediente original virou qual (as substituições viram substitutos curados). ' +
      'Ingrediente original que saiu sem troca informada conta como removido.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrocaDto)
  trocas?: TrocaDto[];

  @ApiPropertyOptional({ description: 'Observação do profissional' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resumo?: string;
}
