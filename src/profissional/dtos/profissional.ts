import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class createProfissionalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @ApiProperty({
    description: 'Registro do profissional',
    example: 'CRN-6 12345',
  })
  registroProfissional!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiPropertyOptional({
    description: 'Especialidade do profissional',
    example: 'Nutricionista',
  })
  especialidade?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Biografia do profissional',
    example: 'Sou um nutricionista apaixonado por ajudar as pessoas a alcançarem seus objetivos de saúde e bem-estar.',
  })
  bio?: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    description: 'ID da clínica associada ao profissional',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  clinicaId?: string;
}

export class UpdateProfissionalDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiPropertyOptional({
    description: 'Especialidade do profissional',
    example: 'Nutricionista',
  })
  especialidade?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Biografia do profissional',
    example: 'Sou um nutricionista apaixonado por ajudar as pessoas a alcançarem seus objetivos de saúde e bem-estar.',
  })
  bio?: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    description: 'ID da clínica associada ao profissional. Envie null para desassociar.',
    example: '123e4567-e89b-12d3-a456-426614174000',
    nullable: true,
  })
  clinicaId?: string | null;
}