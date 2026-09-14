import { IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { TipoResposta} from '@prisma/client';
import { ApiProperty, PartialType } from "@nestjs/swagger";
import { Decimal } from "@prisma/client/runtime/library";

export class createAnamneseRespostaDto {
    @ApiProperty({ description: 'ID da pergunta respondida', example: '123e4567-e89b-12d3-a456-426614174002' })
    @IsUUID()
    perguntaId!: string;

    @ApiProperty({ description: 'Resposta em formato de texto livre, usada para perguntas do tipo texto ou booleano', example: 'Sinto dores após consumir laticínios', required: false })
    @IsOptional()
    @IsString()
    respostaTexto?: string;

    @ApiProperty({ description: 'Resposta em formato numérico, usada para perguntas do tipo número', example: 70.5, required: false })
    @IsOptional()
    respostaNumero?: Decimal;

    @ApiProperty({ description: 'ID da opção selecionada, usada para perguntas de escolha única ou múltipla', example: '123e4567-e89b-12d3-a456-426614174003', required: false })
    @IsOptional()
    @IsUUID()
    opcaoId?: string;
}

export class createAnamneseDto {
    @ApiProperty({ description: 'ID do paciente ao qual a anamnese pertence', example: '123e4567-e89b-12d3-a456-426614174001' })
    @IsUUID()
    pacienteId!: string;

    @ApiProperty({ description: 'Observações gerais registradas pelo profissional sobre a anamnese', example: 'Paciente relata intolerância à lactose', required: false })
    @IsOptional()
    @IsString()
    observacoesGerais?: string;

    @ApiProperty({ description: 'Respostas fornecidas pelo paciente', type: [createAnamneseRespostaDto], required: false })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => createAnamneseRespostaDto)
    respostas?: createAnamneseRespostaDto[];
}

export class createAnamneseOpcaoalDto {
    @ApiProperty({ description: 'ID da pergunta à qual a opção pertence', example: '123e4567-e89b-12d3-a456-426614174002' })
    @IsUUID()
    @IsOptional()
    perguntaId!: string;

    @ApiProperty({ description: 'Texto exibido para a opção de resposta', example: 'Sim' })
    @IsString()
    @IsNotEmpty()
    textoOpcao!: string;
}

export class createAnamnesePerguntaDto {
    @ApiProperty({ description: 'Texto da pergunta apresentada ao paciente', example: 'Você possui alguma restrição alimentar?' })
    @IsString()
    @IsNotEmpty()
    texto!: string;

    @ApiProperty({ enum: TipoResposta, example: TipoResposta.escolha_unica })
    @IsEnum(TipoResposta)
    tipoResposta!: TipoResposta;

    @ApiProperty({ description: 'Categoria à qual a pergunta pertence', example: 'Hábitos alimentares', required: false })
    @IsOptional()
    @IsString()
    categoria?: string;

    @ApiProperty({ description: 'Posição da pergunta na ordem de exibição do formulário', example: 1, required: false })
    @IsOptional()
    @IsInt()
    @Min(0)
    ordem?: number;

}

export class updateAnamneseDto extends PartialType(createAnamneseDto) {}

export class updateAnamneseOpcaoalDto extends PartialType(createAnamneseOpcaoalDto) {}

export class updateAnamnesePerguntaDto extends PartialType(createAnamnesePerguntaDto) {}

export class updateAnamneseRespostaDto extends PartialType(createAnamneseRespostaDto) {}
