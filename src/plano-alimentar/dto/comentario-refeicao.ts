import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class CreateComentarioRefeicaoDto {
    @ApiProperty({ description: 'Texto do comentário', example: 'troquei o arroz por quinoa'})
    @IsString()
    @IsNotEmpty()
    comentario!: string;
}