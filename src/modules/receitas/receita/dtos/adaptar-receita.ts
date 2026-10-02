import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AdaptarReceitaDto {
  @ApiProperty({
    description: 'Restrição alimentar para a qual a receita será adaptada',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  restricaoId!: string;
}
