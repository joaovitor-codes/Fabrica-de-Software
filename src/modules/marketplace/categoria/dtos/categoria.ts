import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from "class-validator";

export class CreateCategoria {
    @IsString()
    @IsNotEmpty()
    @MaxLength(50)
    @Matches(/^[a-z0-9]+(_[a-z0-9]+)*$/, {
        message: 'codigo deve ser snake_case minúsculo',
    })
    @ApiProperty({
        description: 'Código estável da categoria (slug)',
        example: 'alimentos',
    })
    codigo!: string;
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    @ApiProperty({
        description: 'Nome exibido da categoria',
        example: 'Alimentos',
    })
    nome!: string;
}

export class UpdateCategoria {
    @ValidateIf((_, v) => v !== undefined)
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    @ApiProperty({
        description: 'Nome exibido da categoria',
        example: 'Alimentos',
    })
    nome!: string;

    @ValidateIf((_, v) => v !== undefined)
    @IsString()
    @MaxLength(50)
    @Matches(/^[a-z0-9]+(_[a-z0-9]+)*$/, {
        message: 'codigo deve ser snake_case minúsculo',
    })
    @ApiProperty({
        description: 'Código estável da categoria (slug)',
        example: 'alimentos',
    })
    codigo!: string;
}