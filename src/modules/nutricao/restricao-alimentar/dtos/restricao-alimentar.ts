import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TipoRestricao } from '@prisma/client';

export class CreateRestricaoAlimentarDto {
  @ApiProperty({ example: 'Lactose' })
  @IsString()
  @MaxLength(255)
  nome!: string;

  @ApiProperty({ enum: TipoRestricao, example: TipoRestricao.intolerancia })
  @IsEnum(TipoRestricao)
  tipo!: TipoRestricao;

  @ApiPropertyOptional({ example: 'Intolerância à lactose presente em laticínios' })
  @IsOptional()
  @IsString()
  descricao?: string;
}

export class UpdateRestricaoAlimentarDto extends PartialType(CreateRestricaoAlimentarDto) {}
