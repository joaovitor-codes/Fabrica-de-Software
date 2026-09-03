import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PorteClinica } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class CreateClinicaDto {
  @ApiProperty({ example: 'Clínica Nutrir Bem' })
  @IsNotEmpty()
  @IsString()
  nome!: string;

  @ApiPropertyOptional({ example: '12345678000199' })
  @IsOptional()
  @IsString()
  @Length(14, 14, { message: 'CNPJ deve conter 14 dígitos (somente números)' })
  cnpj?: string;

  @ApiPropertyOptional({ enum: PorteClinica, example: PorteClinica.pequeno })
  @IsOptional()
  @IsEnum(PorteClinica)
  porte?: PorteClinica;
}

export class UpdateClinicaDto {
  @ApiPropertyOptional({ example: 'Clínica Nutrir Bem' })
  @IsOptional()
  @IsString()
  nome?: string;

  @ApiPropertyOptional({ example: '12345678000199' })
  @IsOptional()
  @IsString()
  @Length(14, 14, { message: 'CNPJ deve conter 14 dígitos (somente números)' })
  cnpj?: string;

  @ApiPropertyOptional({ enum: PorteClinica })
  @IsOptional()
  @IsEnum(PorteClinica)
  porte?: PorteClinica;
}