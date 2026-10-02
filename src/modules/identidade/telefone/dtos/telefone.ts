import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TipoContato } from '@prisma/client';

export class CreateTelefoneDto {
  @ApiPropertyOptional({ example: '+55' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  ddi?: string;

  @ApiPropertyOptional({ example: '11987654321' })
  @IsString()
  @MaxLength(20)
  numero!: string;

  @ApiPropertyOptional({ enum: TipoContato, default: TipoContato.celular })
  @IsOptional()
  @IsEnum(TipoContato)
  tipo?: TipoContato;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  principal?: boolean;

  @ApiPropertyOptional({
    description: 'ID do usuário dono do telefone (exclusivo com clinicaId — informe apenas um dos dois)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  usuarioId?: string;

  @ApiPropertyOptional({
    description: 'ID da clínica dona do telefone (exclusivo com usuarioId — informe apenas um dos dois)',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsOptional()
  @IsUUID()
  clinicaId?: string;
}

export class UpdateTelefoneDto extends PartialType(CreateTelefoneDto) {}
