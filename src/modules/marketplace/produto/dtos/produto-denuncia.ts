import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateProdutoDenunciaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @ApiProperty({
    description: 'Por que o produto deve sair da vitrine',
    example:
      'Anuncia como sem glúten, mas a foto do rótulo lista farinha de trigo',
  })
  motivo!: string;
}

export class ResolverProdutoDenunciaDto {
  @IsBoolean()
  @ApiProperty({ description: '`true` remove o produto da vitrine' })
  procedente!: boolean;
}
