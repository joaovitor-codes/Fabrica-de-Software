import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export class CreateEnderecoDto {
  @ApiPropertyOptional({ example: '01310-100' })
  @IsOptional()
  @IsString()
  @MaxLength(9)
  cep?: string;

  @ApiPropertyOptional({ example: 'Av. Paulista' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  logradouro?: string;

  @ApiPropertyOptional({ example: '1000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  numero?: string;

  @ApiPropertyOptional({ example: 'Apto 101' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  complemento?: string;

  @ApiPropertyOptional({ example: 'Bela Vista' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bairro?: string;

  @ApiPropertyOptional({ example: 'São Paulo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cidade?: string;

  @ApiPropertyOptional({ example: 'SP', description: 'Sigla do estado (UF)' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  estado?: string;

  @ApiPropertyOptional({ example: 'Brasil', default: 'Brasil' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  pais?: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  principal?: boolean;

  @ApiPropertyOptional({
    description: 'ID do usuário dono do endereço (exclusivo com clinicaId — informe apenas um dos dois)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  usuarioId?: string;

  @ApiPropertyOptional({
    description: 'ID da clínica dona do endereço (exclusivo com usuarioId — informe apenas um dos dois)',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsOptional()
  @IsUUID()
  clinicaId?: string;
}

export class UpdateEnderecoDto extends PartialType(CreateEnderecoDto) {}
