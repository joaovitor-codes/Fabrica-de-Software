import {
  BadRequestException,
  Controller,
  Delete,
  Body,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { ReceitaService } from './receita.service';
import { ReceitaDto } from './dtos/receita';
import { AuthGuard } from '../../../auth/auth.guard';
import { OptionalAuthGuard } from '../../../auth/optional-auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { UpdateReceitaDto } from './dtos/update-receita';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { TipoMidia, TipoUsuario } from '@prisma/client';

import type {
  RequestAutenticado,
  RequestOpcional,
} from '../../../auth/auth.types';
const uploadDirectory = join(process.cwd(), 'uploads', 'receitas');
const receitaStorage = diskStorage({
  destination: (_req, file, callback) => {
    const subdirectory = file.fieldname === 'image' ? 'images' : 'videos';
    const destination = join(uploadDirectory, subdirectory);
    mkdirSync(destination, { recursive: true });
    callback(null, destination);
  },
  filename: (_req, file, callback) => {
    callback(null, `${randomUUID()}-${Date.now()}-${file.originalname}`);
  },
});

const uuidPipe = (mensagem: string) =>
  new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
  });

@Controller('api/receita')
export class ReceitaController {
  constructor(private readonly receitaService: ReceitaService) {}

  @ApiOperation({ summary: 'Cria uma nova receita' })
  @ApiCreatedResponse({ description: 'Receita criada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post()
  async create(
    @Body() receita: ReceitaDto,
    @Request() req: RequestAutenticado,
  ) {
    return await this.receitaService.create(receita, req.user.sub);
  }

  @ApiOperation({ summary: 'Retorna uma receita pelo nome' })
  @ApiOkResponse({ description: 'Objeto da receita.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @Get('/nome')
  async findByName(@Query('q') nome: string, @Request() req: RequestOpcional) {
    return await this.receitaService.findByName(nome, req.user);
  }

  @ApiOperation({
    summary: 'Envia uma mídia para uma receita (autor ou admin)',
  })
  @ApiCreatedResponse({ description: 'Mídia enviada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post(':id/midias')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'image', maxCount: 1 },
        { name: 'video', maxCount: 1 },
      ],
      { storage: receitaStorage },
    ),
  )
  async uploadMedia(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @UploadedFiles()
    files: { image?: Express.Multer.File[]; video?: Express.Multer.File[] },
    @Body('tipo') tipo: TipoMidia,
    @Request() req: RequestAutenticado,
    @Body('ordem') ordem = 0,
  ) {
    const file = files.image?.[0] ?? files.video?.[0];
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return await this.receitaService.uploadMedia(
      id,
      file,
      tipo,
      Number(ordem),
      req.user,
    );
  }

  @ApiOperation({ summary: 'Retorna todas as receitas' })
  @ApiOkResponse({ description: 'Retorna uma lista de receitas.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @Get('all')
  async findAll(@Request() req: RequestOpcional) {
    return await this.receitaService.findAll(req.user);
  }

  @ApiOperation({ summary: 'Retorna uma lista de sugestões de receitas' })
  @ApiOkResponse({ description: 'Array com receitas sugeridas.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @Get('sugestoes')
  async findSuggestions(@Request() req: RequestOpcional) {
    return await this.receitaService.findSuggestions(req.user);
  }

  @ApiOperation({
    summary: 'Retorna as receitas favoritas do usuário autenticado',
  })
  @ApiOkResponse({ description: 'Lista de receitas favoritas.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('favoritos')
  async findFavorites(@Request() request: RequestAutenticado) {
    return await this.receitaService.findFavorites(request.user.sub);
  }

  @ApiOperation({ summary: 'Adiciona uma receita aos favoritos' })
  @ApiCreatedResponse({ description: 'Receita favoritada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post(':id/favorito')
  async addFavorite(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() request: RequestAutenticado,
  ) {
    return await this.receitaService.addFavorite(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Remove uma receita dos favoritos' })
  @ApiOkResponse({ description: 'Receita removida dos favoritos com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Delete(':id/favorito')
  async removeFavorite(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() request: RequestAutenticado,
  ) {
    return await this.receitaService.removeFavorite(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Retorna todas as receitas validadas' })
  @ApiOkResponse({ description: 'Array com as receitas validadas.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @Get('validadas')
  async findValidated(@Request() req: RequestOpcional) {
    return await this.receitaService.findValidated(req.user);
  }

  @ApiOperation({ summary: 'Lista as receitas pendentes de curadoria' })
  @ApiOkResponse({ description: 'Receitas pendentes, mais antigas primeiro.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin, TipoUsuario.profissional)
  @Get('pendentes')
  async findPendentes() {
    return await this.receitaService.findPendentes();
  }

  @ApiOperation({ summary: 'Retorna uma receita pelo ID' })
  @ApiOkResponse({ description: 'Objeto da receita.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @Get(':id')
  async findOne(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() req: RequestOpcional,
  ) {
    return await this.receitaService.findOne(id, req.user);
  }

  @ApiOperation({ summary: 'Retorna os ingredientes de uma receita pelo ID' })
  @ApiOkResponse({ description: 'Array de ingredientes da receita.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @Get(':id/ingredientes')
  async findIngredients(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() req: RequestOpcional,
  ) {
    return await this.receitaService.findIngredients(id, req.user);
  }

  @ApiOperation({
    summary:
      'Retorna os alertas de restrição alimentar da receita (restrições ligadas aos ingredientes e aviso de contaminação cruzada)',
  })
  @ApiOkResponse({
    description:
      'Objeto com avisoContaminacaoCruzada e as restrições com os ingredientes que as disparam.',
  })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @Get(':id/alertas')
  async findAlerts(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() req: RequestOpcional,
  ) {
    return await this.receitaService.findAlerts(id, req.user);
  }

  @ApiOperation({ summary: 'Retorna todos os feedbacks de uma receita' })
  @ApiOkResponse({ description: 'Feedbacks de determinada receita.' })
  @Get(':id/feedback')
  async findFeedback(@Param('id', uuidPipe('ID inválido')) id: string) {
    return await this.receitaService.findFeedbacks(id);
  }

  @ApiOperation({ summary: 'Atualiza uma receita pelo ID (autor ou admin)' })
  @ApiOkResponse({ description: 'Receita atualizada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Body() receita: UpdateReceitaDto,
    @Request() request: RequestAutenticado,
  ) {
    return await this.receitaService.update(id, receita, request.user);
  }

  @ApiOperation({ summary: 'Aprova uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita aprovada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch(':id/aprovar')
  async aprovarReceita(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() request: RequestAutenticado,
  ) {
    return await this.receitaService.aprovarReceita(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Rejeita uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita rejeitada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch(':id/rejeitar')
  async rejeitarReceita(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() request: RequestAutenticado,
  ) {
    return await this.receitaService.rejeitarReceita(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Remove uma receita pelo ID (autor ou admin)' })
  @ApiOkResponse({ description: 'Receita removida com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Delete(':id')
  async remove(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() request: RequestAutenticado,
  ) {
    return await this.receitaService.remove(id, request.user);
  }
}
