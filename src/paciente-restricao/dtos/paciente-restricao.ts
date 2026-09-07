import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { Gravidade } from '@prisma/client';

export class VincularPacienteRestricaoDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  restricaoId!: string;

  @ApiPropertyOptional({ enum: Gravidade, example: Gravidade.moderada, default: Gravidade.moderada })
  @IsOptional()
  @IsEnum(Gravidade)
  gravidade?: Gravidade;

  @ApiPropertyOptional({ example: 'Reação alérgica confirmada em exame' })
  @IsOptional()
  @IsString()
  observacao?: string;
}

export class UpdatePacienteRestricaoDto extends PartialType(
  OmitType(VincularPacienteRestricaoDto, ['restricaoId'] as const),
) {}
