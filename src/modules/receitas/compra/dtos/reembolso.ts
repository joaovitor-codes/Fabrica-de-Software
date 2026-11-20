import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReembolsoDto {
  @ApiPropertyOptional({
    description:
      'Por que o comprador quer o reembolso. Ajuda o admin quando o pedido vai para análise',
    example: 'Comprei por engano',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  motivo?: string;
}

export class ResolverReembolsoDto {
  @ApiProperty({
    description: '`true` estorna a compra; `false` a devolve para `paga`',
    example: true,
  })
  @IsBoolean()
  aprovado!: boolean;
}
