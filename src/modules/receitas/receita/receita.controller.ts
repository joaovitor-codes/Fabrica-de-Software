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
import { ReceitaComOfertaDto, ReceitaDto } from './dtos/receita';
import { UpdateReceitaOfertaDto } from './dtos/receita-oferta';
import { AuthGuard } from '../../../auth/auth.guard';
import { OptionalAuthGuard } from '../../../auth/optional-auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { UpdateReceitaDto } from './dtos/update-receita';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiUnprocessableEntityResponse,
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

const seguraParaPipe = new ParseUUIDPipe({
  version: '4',
  optional: true,
  exceptionFactory: () =>
    new BadRequestException('seguraPara deve ser o ID de uma restrição'),
});

const publicoAlvoPipe = new ParseUUIDPipe({
  version: '4',
  optional: true,
  exceptionFactory: () =>
    new BadRequestException('publicoAlvo deve ser o ID de uma restrição'),
});

const seguraParaQuery = ApiQuery({
  name: 'seguraPara',
  required: false,
  description:
    'ID de uma restrição alimentar: devolve só as receitas seguras para ela.',
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

  @ApiOperation({ summary: 'Cria uma receita já paga, com a oferta' })
  @ApiCreatedResponse({
    description:
      'Receita criada como pendente, com a oferta. Vai à venda depois de aprovada.',
  })
  @ApiForbiddenResponse({
    description: 'O profissional não vende receitas (código de ética do CRN).',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Sem o aceite dos termos, sem conta Mercado Pago ativa, preço abaixo do mínimo ou público-alvo inseguro. Nada é gravado.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.comum, TipoUsuario.paciente, TipoUsuario.admin)
  @Post('paga')
  async createComOferta(
    @Body() receita: ReceitaComOfertaDto,
    @Request() req: RequestAutenticado,
  ) {
    return await this.receitaService.createComOferta(receita, req.user.sub);
  }

  @ApiOperation({ summary: 'Retorna uma receita pelo nome' })
  @ApiOkResponse({ description: 'Objeto da receita.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @seguraParaQuery
  @Get('/nome')
  async findByName(
    @Query('q') nome: string,
    @Request() req: RequestOpcional,
    @Query('seguraPara', seguraParaPipe) seguraPara?: string,
  ) {
    return await this.receitaService.findByName(nome, req.user, seguraPara);
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
  @seguraParaQuery
  @Get('all')
  async findAll(
    @Request() req: RequestOpcional,
    @Query('seguraPara', seguraParaPipe) seguraPara?: string,
  ) {
    return await this.receitaService.findAll(req.user, seguraPara);
  }

  @ApiOperation({ summary: 'Retorna uma lista de sugestões de receitas' })
  @ApiOkResponse({ description: 'Array com receitas sugeridas.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @Get('sugestoes')
  async findSuggestions(@Request() req: RequestOpcional) {
    return await this.receitaService.findSuggestions(req.user);
  }

  @ApiOperation({ summary: 'Retorna todas as receitas validadas' })
  @ApiOkResponse({ description: 'Array com as receitas validadas.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @Get('validadas')
  async findValidated(@Request() req: RequestOpcional) {
    return await this.receitaService.findValidated(req.user);
  }

  @ApiOperation({
    summary: 'Retorna as receitas à venda, como prévia',
    description:
      'Só as que estão à venda: oferta ativa, receita aprovada e vendedor com o Mercado Pago ativo. ' +
      'Para o paciente com restrição estrita, a receita insegura some da lista.',
  })
  @ApiOkResponse({
    description:
      'Lista de prévias, cada uma com oferta (preço e público-alvo).',
  })
  @ApiQuery({
    name: 'publicoAlvo',
    required: false,
    description:
      'ID de uma restrição: só as ofertas marcadas para ela e que continuam seguras para ela.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Trecho do nome.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  // Rota fixa: precisa vir antes de GET :id.
  @Get('a-venda')
  async findAVenda(
    @Request() req: RequestOpcional,
    @Query('publicoAlvo', publicoAlvoPipe) publicoAlvo?: string,
    @Query('q') q?: string,
  ) {
    return await this.receitaService.findAVenda(req.user, { publicoAlvo, q });
  }

  @ApiOperation({
    summary: 'Retorna uma receita pelo ID',
    description:
      'Receita paga devolve só a prévia (sem modo de preparo, ingredientes nem mídias de passo a passo) ' +
      'para quem não é o autor, o admin ou o curador com a receita pendente.',
  })
  @ApiOkResponse({ description: 'Objeto da receita, ou a prévia se for paga.' })
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
  @ApiForbiddenResponse({
    description:
      'Receita paga: só o autor, o admin e o curador (receita pendente) veem os ingredientes.',
  })
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
      'Objeto com avisoContaminacaoCruzada, as restrições com os ingredientes que as disparam ' +
      'e os ingredientes ainda não revisados por um curador.',
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

  @ApiOperation({
    summary: 'Altera preço, público-alvo ou pausa a oferta (autor)',
    description:
      'A oferta nunca é removida: pausar (`ativa: false`) tira da vitrine e mantém o conteúdo fechado.',
  })
  @ApiOkResponse({ description: 'Oferta atualizada.' })
  @ApiForbiddenResponse({ description: 'O usuário não é o autor da receita.' })
  @ApiUnprocessableEntityResponse({
    description:
      'Sem termos ou Mercado Pago ativo (exceto para só pausar), preço abaixo do mínimo ou público-alvo inseguro.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch(':id/oferta')
  async atualizarOferta(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Body() oferta: UpdateReceitaOfertaDto,
    @Request() req: RequestAutenticado,
  ) {
    return await this.receitaService.atualizarOferta(id, oferta, req.user);
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
