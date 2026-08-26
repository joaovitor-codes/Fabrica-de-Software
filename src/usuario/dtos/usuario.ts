import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDate, IsOptional, IsUrl } from "class-validator";

export class UpdateUsuarioDto {
    @ApiPropertyOptional({
        description: 'URL da foto de perfil do usuário',
        example: 'https://exemplo.com/fotos/perfil.jpg',
    })
    @IsUrl()
    @IsOptional()
    fotoPerfilUrl?: string;

    @ApiPropertyOptional({
        description: 'Data de nascimento do usuário no formato ISO',
        example: '1995-05-12T00:00:00.000Z',
        type: String, 
    })
    @IsDate()
    @IsOptional()
    @Type(() => Date)
    dataNascimento?: Date;
}