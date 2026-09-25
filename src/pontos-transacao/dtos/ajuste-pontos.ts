import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, NotEquals } from "class-validator";

export class AjustePontosDto {
  @IsUUID()
  @ApiProperty({
    description: 'ID do profissional que terá os pontos ajustados',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  profissionalId!: string;

  @IsInt()
  @NotEquals(0)
  @ApiProperty({
    description: 'Quantidade de pontos do ajuste (positivo credita, negativo debita)',
    example: -10,
  })
  pontos!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  @ApiProperty({
    description: 'Motivo do ajuste',
    example: 'Correção de pontos creditados em duplicidade',
  })
  descricao!: string;
}
