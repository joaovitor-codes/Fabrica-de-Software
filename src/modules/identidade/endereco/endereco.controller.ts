import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EnderecoService } from './endereco.service';
import { CreateEnderecoDto, UpdateEnderecoDto } from './dtos/endereco';
import { AuthGuard } from '../../../auth/auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';

const uuidPipe = (mensagem: string) =>
  new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
  });

// Rotas genéricas, sem checagem de dono: só admin. Usuário e clínica
// gerenciam os próprios dados pelas rotas de usuario/me e clinicas.
@ApiTags('Endereço')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(TipoUsuario.admin)
@Controller('api/endereco')
export class EnderecoController {
  constructor(private readonly enderecoService: EnderecoService) {}

  @ApiOperation({ summary: 'Cria um novo endereço a um usuario ou clinica' })
  @ApiCreatedResponse({ description: 'Endereço criado com sucesso.' })
  @Post()
  async create(@Body() createEnderecoDto: CreateEnderecoDto) {
    return this.enderecoService.create(createEnderecoDto);
  }

  @ApiOperation({ summary: 'Obtém uma lista paginada de endereços' })
  @ApiOkResponse({ description: 'Lista de endereços.' })
  @Get('page/:page/limit/:limit')
  async findAll(
    @Param('page', ParseIntPipe) page: number,
    @Param('limit', ParseIntPipe) limit: number,
  ) {
    return this.enderecoService.findAll(page, limit);
  }

  @ApiOperation({ summary: 'Retorna um endereço específico pelo ID' })
  @ApiOkResponse({ description: 'Endereço retornado com sucesso.' })
  @Get(':id')
  async findOne(@Param('id', uuidPipe('ID Endereço inválido')) id: string) {
    return this.enderecoService.findOne(id);
  }

  @ApiOperation({ summary: 'Atualiza um endereço específico pelo ID' })
  @ApiOkResponse({ description: 'Endereço atualizado com sucesso.' })
  @Patch(':id')
  async update(
    @Param('id', uuidPipe('ID Endereço inválido')) id: string,
    @Body() updateEnderecoDto: UpdateEnderecoDto,
  ) {
    return this.enderecoService.update(id, updateEnderecoDto);
  }

  @ApiOperation({ summary: 'Remove um endereço específico pelo ID' })
  @ApiOkResponse({ description: 'Endereço removido com sucesso.' })
  @Delete(':id')
  async remove(@Param('id', uuidPipe('ID Endereço inválido')) id: string) {
    return this.enderecoService.remove(id);
  }
}
