import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TagSintomasService } from './tag-sintomas.service';
import { CreateTagSintomaDto, UpdateTagSintomaDto } from './dtos/tag-sintoma';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';

@ApiTags('Tag Sintomas')
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/tag-sintomas')
export class TagSintomasController {
    constructor(private readonly tagSintomasService: TagSintomasService) {}

    @ApiOperation({ summary: 'Cria uma nova tag de sintoma' })
    @ApiCreatedResponse({ description: 'Tag de sintoma criada com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Post()
    async create(@Body() createTagSintomaDto: CreateTagSintomaDto) {
        return this.tagSintomasService.create(createTagSintomaDto);
    }

    @ApiOperation({ summary: 'Obtém a lista de tags de sintoma' })
    @ApiOkResponse({ description: 'Lista de tags de sintoma.' })
    @Roles(TipoUsuario.admin, TipoUsuario.profissional)
    @Get()
    async findAll() {
        return this.tagSintomasService.findAll();
    }

    @ApiOperation({ summary: 'Retorna uma tag de sintoma específica pelo ID' })
    @ApiOkResponse({ description: 'Tag de sintoma retornada com sucesso.' })
    @Roles(TipoUsuario.admin, TipoUsuario.profissional)
    @Get(':id')
    async findOne(@Param('id', new ParseUUIDPipe({
        version: '4',
        errorHttpStatusCode: 400,
        exceptionFactory: () => new BadRequestException('ID inválido'),
    })) id: string) {
        return this.tagSintomasService.findOne(id);
    }

    @ApiOperation({ summary: 'Atualiza uma tag de sintoma específica pelo ID' })
    @ApiOkResponse({ description: 'Tag de sintoma atualizada com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Patch(':id')
    async update(
        @Param('id', new ParseUUIDPipe({
            version: '4',
            errorHttpStatusCode: 400,
            exceptionFactory: () => new BadRequestException('ID inválido'),
        })) id: string,
        @Body() updateTagSintomaDto: UpdateTagSintomaDto,
    ) {
        return this.tagSintomasService.update(id, updateTagSintomaDto);
    }

    @ApiOperation({ summary: 'Remove uma tag de sintoma específica pelo ID' })
    @ApiOkResponse({ description: 'Tag de sintoma removida com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Delete(':id')
    async delete(@Param('id', new ParseUUIDPipe({
        version: '4',
        errorHttpStatusCode: 400,
        exceptionFactory: () => new BadRequestException('ID inválido'),
    })) id: string) {
        return this.tagSintomasService.delete(id);
    }
}
