import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListarProdutosQuery {
  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ description: 'ID da categoria.' })
  categoria?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'UF, com duas letras.' })
  estado?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  cidade?: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ description: 'ID da restrição alimentar.' })
  publicoAlvo?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Trecho do título do produto.' })
  q?: string;
}
