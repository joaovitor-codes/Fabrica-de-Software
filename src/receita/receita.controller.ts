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
import { ReceitaDto } from './dto/receita';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateReceitaDto } from './dto/update.receita';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { IngredienteDTO } from '../ingrediente/dto/ingrediente';
import { TipoMidia } from '@prisma/client';

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

@Controller('api/receita')
export class ReceitaController {
  constructor(private readonly receitaService: ReceitaService) {}
  
  @ApiOperation({ summary: 'Cria uma nova receita' })
  @ApiCreatedResponse({ description: 'Receita criada com sucesso.' })
  @UseGuards(AuthGuard)
  @Post()
  async create(
    @Body() receita: ReceitaDto,
    @Request() req,
    @Body('ingredientes') ingredientes: IngredienteDTO[],
  ) {
    return await this.receitaService.create(receita, req.user.sub);
  }
  
  @ApiOperation({ summary: 'Retorna uma receita pelo nome' })
  @ApiOkResponse({ description: 'Objeto da receita.' })
  @Get('/nome')
  async findByName(@Query('q') nome: string) {
    return await this.receitaService.findByName(nome);
  }

  @ApiOperation({ summary: 'Envia uma mídia para uma receita' })
  @ApiCreatedResponse({ description: 'Mídia enviada com sucesso.' })
  @UseGuards(AuthGuard)
  @Post(':id/midias')
  @UseInterceptors(FileFieldsInterceptor(
    [
      { name: 'image', maxCount: 1 },
      { name: 'video', maxCount: 1 },
    ],
    { storage: receitaStorage },
  ))
  async uploadMedia(
    @Param('id', new ParseUUIDPipe({ version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID inválido')
    })) id: string,
    @UploadedFiles()
    files: { image?: Express.Multer.File[], video?: Express.Multer.File[] },
    @Body('tipo') tipo: TipoMidia,
    @Body('ordem') ordem = 0,
  ) {
    const file = files.image?.[0] ?? files.video?.[0];
    if(!file) {
      throw new BadRequestException('file is required');
    }
    return await this.receitaService.uploadMedia(id, file, tipo, Number(ordem));
  }

  @ApiOperation({ summary: 'Retorna todas as receitas' })
  @ApiOkResponse({ description: 'Retorna uma lista de receitas.' })
  @Get('all')
  async findAll() {
    return await this.receitaService.findAll();
  }

  @ApiOperation({ summary: 'Retorna uma lista de sugestões de receitas' })
  @ApiOkResponse({ description: 'Array com receitas sugeridas.' })
  @Get('sugestoes')
  async findSuggestions() {
    return await this.receitaService.findSuggestions();
  }

  @ApiOperation({ summary: 'Retorna as receitas favoritas do usuário autenticado' })
  @ApiOkResponse({ description: 'Lista de receitas favoritas.' })
  @UseGuards(AuthGuard)
  @Get('favoritos')
  async findFavorites(@Request() request) {
    return await this.receitaService.findFavorites(request.user.sub);
  }

  @ApiOperation({ summary: 'Adiciona uma receita aos favoritos' })
  @ApiCreatedResponse({ description: 'Receita favoritada com sucesso.' })
  @UseGuards(AuthGuard)
  @Post(':id/favorito')
  async addFavorite(
    @Param('id', new ParseUUIDPipe({ version: '4', 
      errorHttpStatusCode: 400,
      exceptionFactory: () => new BadRequestException('ID inválido')
    })) id: string,
    @Request() request,
  ) {
    return await this.receitaService.addFavorite(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Remove uma receita dos favoritos' })
  @ApiOkResponse({ description: 'Receita removida dos favoritos com sucesso.' })
  @UseGuards(AuthGuard)
  @Delete(':id/favorito')
  async removeFavorite(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 400,
      exceptionFactory: () => new BadRequestException('ID inválido')
    })) id: string,
    @Request() request,
  ) {
    return await this.receitaService.removeFavorite(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Retorna uma receita pelo ID' })
  @ApiOkResponse({ description: 'Objeto da receita.' })
  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe({version: '4', 
    errorHttpStatusCode: 400, 
    exceptionFactory: () => new BadRequestException('ID inválido')})) 
    id: string) {
    return await this.receitaService.findOne(id);
  }


  @ApiOperation({ summary: 'Retorna os ingredientes de uma receita pelo ID' })
  @ApiOkResponse({ description: 'Array de ingredientes da receita.' })
  @Get(':id/ingredientes')
  async findIngredients(@Param('id') id: string) {
    return await this.receitaService.findIngredients(id);
  }

  @ApiOperation({
    summary: 'Retorna os ingredientes substitutos de uma receita pelo ID',
  })
  @ApiOkResponse({
    description: 'Array de ingredientes substitutos da receita.',
  })
  @Get(':ingredienteId/ingredientes/:restricaoId/restricao/substituicao')
  async findReplacementFor(@Param('ingredienteId') ingredienteId: string, @Param('restricaoId') restricaoId: string) {
    return await this.receitaService.encontrarSubstitutos(ingredienteId, restricaoId);
  }

  @ApiOperation({ summary: 'Retorna os alertas de uma receita pelo ID' })
  @ApiOkResponse({ description: 'Array de alertas da receita.' })
  @Get(':id/alertas')
  async findAlerts(@Param('id') id: string) {
    return await this.receitaService.findAlerts(id);
  }

  @ApiOperation({ summary: 'Retorna todas as receitas validadas' })
  @ApiOkResponse({ description: 'Array com as receitas validadas.' })
  @Get('validadas')
  async findValidated() {
    return await this.receitaService.findValidated();
  }

  @ApiOperation({ summary: 'Retorna todos os feedbacks de uma receita' })
  @ApiOkResponse({ description: 'Feedbacks de determinada receita.' })
  @Get(':id/feedback')
  async findFeedback() {
    return await this.receitaService.findFeedbacks();
  }

  @ApiOperation({ summary: 'Atualiza uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita atualizada com sucesso.' })
  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() receita: UpdateReceitaDto,
    @Request() request,
  ) {
    return await this.receitaService.update(id, receita, request.user.sub);
  }

  @ApiOperation({ summary: 'Aprova uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita aprovada com sucesso.' })
  @UseGuards(AuthGuard)
  @Patch(':id/aprovar')
  async aprovarReceita(@Param('id') id: string, @Request() request) {
    return await this.receitaService.aprovarReceita(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Rejeita uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita rejeitada com sucesso.' })
  @UseGuards(AuthGuard)
  @Patch(':id/rejeitar')
  async rejeitarReceita(@Param('id') id: string, @Request() request) {
    return await this.receitaService.rejeitarReceita(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Remove uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita removida com sucesso.' })
  @UseGuards(AuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.receitaService.remove(id);
  }
}
