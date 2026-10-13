import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AceiteTermosMarketplaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @ApiProperty({
    description: 'Versão dos termos que o usuário leu. Precisa ser a atual',
    example: '2026-10',
  })
  versaoDocumento!: string;
}
