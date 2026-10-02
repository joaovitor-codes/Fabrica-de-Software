import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsUUID, Max } from 'class-validator';

export class ReceitaIngredienteDTO {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  ingredienteId!: string;

  @ApiProperty({
    example: 200,
    description: 'Quantidade na unidade informada (até duas casas decimais)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  // receita_ingredientes.quantidade é Decimal(8, 2).
  @Max(999999.99)
  quantidade!: number;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001' })
  @IsUUID()
  unidadeMedidaId!: string;
}
