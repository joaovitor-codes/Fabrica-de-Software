export class SugestaoSubstituto {
    nome!: string;
    justificativa!: string;
    caloriasKcal!: string;
    proteinasG!: string;
    carboidratosG!: string;
    gordurasG!: string;
    fibrasG!: string;
    sodioMg!: string;
    nutrientesVerificados!: boolean;
}

export class RespostaSubstituto{
    opcoes!: SugestaoSubstituto[];
}