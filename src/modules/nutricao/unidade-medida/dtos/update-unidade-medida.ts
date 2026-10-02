import { PartialType } from '@nestjs/swagger';
import { UnidadeMedidaDto } from './unidade-medida';

export class UpdateUnidadeMedidaDto extends PartialType(UnidadeMedidaDto) {
  codigo!: string;
  nome!: string;
  ativo!: boolean;
}
