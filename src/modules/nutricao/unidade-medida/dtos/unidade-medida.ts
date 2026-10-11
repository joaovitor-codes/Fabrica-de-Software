import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UnidadeMedidaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  codigo!: string;
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  nome!: string;
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
