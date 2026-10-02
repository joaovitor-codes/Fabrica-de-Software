import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional } from 'class-validator';
import { CampoNutricionalRegra, OperadorRegraNutricional } from '@prisma/client';

export class CreateRestricaoRegraNutricionalDto {
  @ApiProperty({ enum: CampoNutricionalRegra, example: CampoNutricionalRegra.sodio_mg })
  @IsEnum(CampoNutricionalRegra)
  campoNutricional!: CampoNutricionalRegra;

  @ApiProperty({ enum: OperadorRegraNutricional, example: OperadorRegraNutricional.maior_que })
  @IsEnum(OperadorRegraNutricional)
  operador!: OperadorRegraNutricional;

  @ApiPropertyOptional({
    example: 600,
    description:
      'Limiar numérico da regra (ex: 600 para sódio em mg/100g). Pode ficar null até haver ' +
      'validação clínica — nenhum job deve gerar vínculo automático a partir de uma regra sem valorLimite definido.',
  })
  @IsOptional()
  @IsNumber()
  valorLimite?: number;
}

export class UpdateRestricaoRegraNutricionalDto extends PartialType(CreateRestricaoRegraNutricionalDto) {}
