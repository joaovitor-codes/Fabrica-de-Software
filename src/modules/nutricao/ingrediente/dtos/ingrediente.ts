import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class IngredienteDTO {
  @IsNotEmpty()
  nome!: string;
  @IsNotEmpty()
  caloriasKcal!: number;
  @IsNotEmpty()
  proteinasG!: number;
  @IsNotEmpty()
  carboidratosG!: number;
  @IsNotEmpty()
  gordurasG!: number;
  @IsNotEmpty()
  fibrasG!: number;
  @IsNotEmpty()
  sodioMg!: number;
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fonteDados?: string;
}
