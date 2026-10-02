import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateDiarioSintomasDto{
    @ApiProperty({ description: 'Observação livre sobre sintoma', example: 'Dor de cabeça leve após almoço', required: false })
    @IsOptional()
    @IsString()
    observacao?: string;

    @ApiProperty({ description: 'ID do checklist de refeição relacionado, se houver', example: '123e4567-e89b-12d3-a456-426614174000', required: false })
    @IsOptional()
    @IsUUID()
    checklistRefeicaoId?: string;

    @ApiProperty({ description: 'IDS das tags de sintoma', type: [String], required: false })
    @IsOptional()
    @IsArray()
    @IsUUID('4', {each: true})
    tagIds?: string[]
}