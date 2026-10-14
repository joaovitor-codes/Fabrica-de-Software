import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

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
