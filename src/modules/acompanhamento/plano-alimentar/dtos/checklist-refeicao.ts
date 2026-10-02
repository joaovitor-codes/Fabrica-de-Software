import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsDateString } from "class-validator";

export class MarcarCheckListDto{
    @ApiProperty({ description: 'Data referencial do checklist no formato YYYY-MM-DD' , example: '2023-01-01'})
    @IsDateString()
    dataReferencial!: string;
    @ApiProperty({ description: 'Indica se o checklist foi concluído ou não', example: true})
    @IsBoolean()
    concluido!: boolean;
}