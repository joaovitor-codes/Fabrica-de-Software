import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class CreateTagSintomaDto {
    @ApiProperty({
            description: 'ID do usuário associado ao paciente',
            example: '123e4567-e89b-12d3-a456-426614174000',
        })
    @IsString()
    nome!: string;
}

export class UpdateTagSintomaDto {
    @ApiProperty({
            description: 'ID do usuário associado ao paciente',
            example: '123e4567-e89b-12d3-a456-426614174000',
        })
    @IsString()
    nome!: string;
}