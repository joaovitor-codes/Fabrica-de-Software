import { PartialType } from '@nestjs/swagger';
import { IngredienteDTO } from './ingrediente';

export class UpdateIngredienteDto extends PartialType(IngredienteDTO) {
  nome!: string;
  caloriasKcal!: number;
  proteinasG!: number;
  carboidratosG!: number;
  gordurasG!: number;
  fibrasG!: number;
  sodioMg!: number;
  fonteDados!: string;
}
