import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional } from "class-validator";

export class CreatePacienteDto {
    @ApiPropertyOptional({
        description: 'ID do usuário associado ao paciente',
        example: '123e4567-e89b-12d3-a456-426614174000',
    })
    @IsNotEmpty()
    userId!: string;
    @ApiPropertyOptional({
        description: 'ID do profissional associado ao paciente',
        example: '123e4567-e89b-12d3-a456-426614174001',})
    @IsNotEmpty()
    profissionalId!: string;
}

export class UpdatePacienteDto {
    @ApiPropertyOptional({
        description: 'ID do profissional associado ao paciente',
        example: '123e4567-e89b-12d3-a456-426614174001',
    })
    @IsOptional()
    profissionalId?: string;
}