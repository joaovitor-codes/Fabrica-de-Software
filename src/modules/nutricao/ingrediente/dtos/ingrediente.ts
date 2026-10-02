import { IsNotEmpty } from 'class-validator';

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
  fonteDados!: string;
}
