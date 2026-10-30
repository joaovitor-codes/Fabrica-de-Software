import { ApiProperty } from '@nestjs/swagger';
import { StatusProduto } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// `removido` é só da moderação; o vendedor não entra nem sai dele.
export const STATUS_DO_VENDEDOR = [
  StatusProduto.ativo,
  StatusProduto.pausado,
  StatusProduto.vendido,
] as const;

export class CreateProduto {
  @IsUUID()
  @ApiProperty({ description: 'Categoria do produto' })
  categoriaId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @ApiProperty({ example: 'Pão sem glúten' })
  titulo!: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  descricao?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @ApiProperty({
    required: false,
    description: 'Ausente = "a combinar"',
    example: 15.9,
  })
  preco?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiProperty({ required: false, example: 'Goiânia' })
  cidade?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @ApiProperty({ required: false, example: 'GO' })
  estado?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @ApiProperty({
    required: false,
    type: [String],
    description: 'Restrições alimentares que o produto atende (público-alvo)',
  })
  restricaoIds?: string[];
}

// Campos ausentes ficam como estão. `descricao`, `preco`, `cidade` e `estado`
// aceitam null para limpar; os demais não, porque são obrigatórios no banco.
export class UpdateProduto {
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  @ApiProperty({ required: false, description: 'Categoria do produto' })
  categoriaId?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @ApiProperty({ required: false, example: 'Pão sem glúten' })
  titulo?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, nullable: true })
  descricao?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'null = "a combinar"',
    example: 15.9,
  })
  preco?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiProperty({ required: false, nullable: true, example: 'Goiânia' })
  cidade?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @ApiProperty({ required: false, nullable: true, example: 'GO' })
  estado?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  @ApiProperty({
    required: false,
    description: 'Telefone do próprio vendedor exibido como contato',
  })
  telefoneContatoId?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @ApiProperty({
    required: false,
    type: [String],
    description: 'Substitui o público-alvo inteiro; [] limpa',
  })
  restricaoIds?: string[];

  @ValidateIf((_, v) => v !== undefined)
  @IsIn(STATUS_DO_VENDEDOR)
  @ApiProperty({ required: false, enum: STATUS_DO_VENDEDOR })
  status?: (typeof STATUS_DO_VENDEDOR)[number];
}
