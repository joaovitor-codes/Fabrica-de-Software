import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  ValidateIf,
} from 'class-validator';

/**
 * Preço e público-alvo da receita paga. O preço mínimo
 * (MARKETPLACE_PRECO_MINIMO) e a segurança do público-alvo dependem de
 * configuração e dos ingredientes, então são conferidos no service (422).
 */
export class ReceitaOfertaDto {
  @ApiProperty({
    example: 12.9,
    description: 'Preço de venda, em reais (até duas casas decimais)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  // receita_ofertas.preco é Decimal(10, 2).
  @Max(99999999.99)
  preco!: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    description:
      'Restrições alimentares para as quais a receita é oferecida. A receita precisa ser segura para cada uma',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  restricaoIds?: string[];
}

/** O que o autor muda numa oferta que já existe. Campos ausentes ficam. */
export class UpdateReceitaOfertaDto {
  @ApiPropertyOptional({
    example: 14.9,
    description: 'Novo preço. Não altera compras já feitas',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(99999999.99)
  preco?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Substitui o público-alvo inteiro; [] limpa',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  restricaoIds?: string[];

  @ApiPropertyOptional({
    description:
      '`false` pausa a venda; o conteúdo continua fechado. `true` reativa',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  ativa?: boolean;
}
