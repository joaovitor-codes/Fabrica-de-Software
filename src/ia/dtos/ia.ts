import { ApiProperty } from '@nestjs/swagger';

export class SugestaoSubstituto {
    @ApiProperty({ description: 'Nome do ingrediente substituto sugerido', example: 'Farinha de amêndoas' })
    nome!: string;

    @ApiProperty({
        description: 'Justificativa da sugestão, explicando por que o substituto atende à restrição informada',
        example: 'Sem glúten e mantém a mesma função de ligação da farinha de trigo',
    })
    justificativa!: string;

    @ApiProperty({ description: 'Estimativa de calorias por 100g, em kcal', example: '608' })
    caloriasKcal!: string;

    @ApiProperty({ description: 'Estimativa de proteínas por 100g, em gramas', example: '21.4' })
    proteinasG!: string;

    @ApiProperty({ description: 'Estimativa de carboidratos por 100g, em gramas', example: '19.4' })
    carboidratosG!: string;

    @ApiProperty({ description: 'Estimativa de gorduras por 100g, em gramas', example: '53.7' })
    gordurasG!: string;

    @ApiProperty({ description: 'Estimativa de fibras por 100g, em gramas', example: '10.6' })
    fibrasG!: string;

    @ApiProperty({ description: 'Estimativa de sódio por 100g, em miligramas', example: '1' })
    sodioMg!: string;

    @ApiProperty({
        description:
            'Indica se os valores nutricionais foram verificados por uma fonte confiável. ' +
            'Sugestões geradas pela IA vêm sempre como estimativas não verificadas.',
        example: false,
    })
    nutrientesVerificados!: boolean;
}

export class RespostaSubstituto {
    @ApiProperty({
        description: 'Lista de opções de substitutos sugeridas pela IA para o ingrediente e restrição informados',
        type: () => SugestaoSubstituto,
        isArray: true,
    })
    opcoes!: SugestaoSubstituto[];
}
