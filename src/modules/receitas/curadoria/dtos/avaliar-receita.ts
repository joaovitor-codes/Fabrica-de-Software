import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/**
 * A revisão que o curador viu (campo `revisao` de `GET /:id` ou de
 * `/pendentes`). Se o autor mudou a receita depois, a avaliação é recusada
 * com 409 e o curador revisa o conteúdo novo.
 */
export class AvaliarReceitaDto {
  @ApiProperty({
    description: 'Revisão da receita que o curador avaliou',
    example: 3,
  })
  @IsInt()
  @Min(1)
  revisao!: number;
}
