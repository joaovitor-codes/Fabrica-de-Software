import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards, BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClinicasService } from './clinicas.service';
import { CreateClinicaDto, CreateClinicaEnderecoDto, UpdateClinicaDto } from './dtos/clinicas';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';
import { EnderecoService } from '../endereco/endereco.service';
import { TelefoneService } from '../telefone/telefone.service';
import { CreateTelefoneDto, UpdateTelefoneDto } from '../telefone/dtos/telefone';

const uuidPipe = (mensagem: string) => new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
});


@ApiTags('Clínicas')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/clinicas')
export class ClinicasController {
  constructor(
    private readonly clinicasService: ClinicasService,
    private readonly enderecoService: EnderecoService,
    private readonly telefoneService: TelefoneService,
  ) {}

  @ApiOperation({ summary: 'Cria uma nova clínica' })
  @ApiCreatedResponse({ description: 'Clínica criada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Post()
  async create(@Body() createClinicaDto: CreateClinicaDto) {
    return this.clinicasService.create(createClinicaDto);
  }

  @ApiOperation({ summary: 'Obtém uma lista paginada de clínicas' })
  @ApiOkResponse({ description: 'Lista de clínicas.' })
  @Roles(TipoUsuario.admin)
  @Get('page/:page/limit/:limit')
  async findAll(
    @Param('page', ParseIntPipe) page: number,
    @Param('limit', ParseIntPipe) limit: number,
  ) {
    return this.clinicasService.findAll(page, limit);
  }

  @ApiOperation({ summary: 'Obtém os profissionais de uma clínica específica' })
  @ApiOkResponse({ description: 'Lista de profissionais da clínica.' })
  @Roles(TipoUsuario.admin)
  @Get(':id/profissionais/page/:page/limit/:limit')
  async findProfissionais(@Param('id', uuidPipe('ID Clínica inválido')) id: string, @Param('page', ParseIntPipe) page: number, @Param('limit', ParseIntPipe) limit: number) {
    return this.clinicasService.findProfissionais(id, page, limit);
  }

  @ApiOperation({ summary: 'Remove uma clínica específica' })
  @ApiOkResponse({ description: 'Clínica removida com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Delete(':id')
  async remove(@Param('id', uuidPipe('ID Clínica inválido')) id: string) {
    return this.clinicasService.remove(id);
  }

  @ApiOperation({ summary: 'Obtém os dados de uma clínica específica' })
  @ApiOkResponse({ description: 'Dados da clínica.' })
  @Roles(TipoUsuario.admin)
  @Get(':id')
  async findOne(@Param('id', uuidPipe('ID Clínica inválido')) id: string) {
    return this.clinicasService.findOne(id);
  }

  @ApiOperation({ summary: 'Atualiza os dados de uma clínica específica' })
  @ApiOkResponse({ description: 'Clínica atualizada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Patch(':id')
  async update(@Param('id', uuidPipe('ID Clínica inválido')) id: string, @Body() updateClinicaDto: UpdateClinicaDto) {
    return this.clinicasService.update(id, updateClinicaDto);
  }

  @ApiOperation({ summary: 'Cria um endereço vinculado a uma clínica' })
  @ApiCreatedResponse({ description: 'Endereço da clínica criado com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Post(':id/endereco')
  async createEndereco(@Param('id', uuidPipe('ID Clínica inválido')) id: string, @Body() createClinicaEnderecoDto: CreateClinicaEnderecoDto,) {
    await this.clinicasService.findOne(id);

    return await this.enderecoService.create({
      ...createClinicaEnderecoDto,
      clinicaId: id,
    });
  }

  @ApiOperation({ summary: 'Lista os endereços de uma clínica' })
  @ApiOkResponse({ description: 'Lista de endereços da clínica.' })
  @Roles(TipoUsuario.admin)
  @Get(':id/endereco')
  async findEnderecos(@Param('id', uuidPipe('ID Clínica inválido')) id: string) {
    await this.clinicasService.findOne(id);
    return this.enderecoService.findByClinica(id);
  }

  @ApiOperation({ summary: 'Adicionar telefone a uma clinica especifica.' })
  @ApiCreatedResponse({ description: 'Telefone adicionado com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Post(':clinicaId/telefone')
  async adicionarTelefone(@Param('clinicaId', uuidPipe('ID Clínica inválido')) clinicaId: string, @Body() telefoneDto: CreateTelefoneDto) {
    await this.clinicasService.findOne(clinicaId);
    return await this.telefoneService.create({
      ...telefoneDto,
      clinicaId,
    });
  }

  @ApiOperation({ summary: 'Remover um telefone especifico de uma clinica especifica' })
  @ApiOkResponse({ description: 'Telefone removido com sucesso.'})
  @Roles(TipoUsuario.admin)
  @Delete(':clinicaId/telefone/remover/:telefoneId')
  async removerTelefone(@Param('clinicaId', uuidPipe('ID Clínica inválido')) clinicaId: string,
    @Param('telefoneId', uuidPipe('ID Telefone inválido')) telefoneId: string){
    const telefones = await this.telefoneService.findByClinica(clinicaId, telefoneId);
    if(telefones.length === 0){
      throw new BadRequestException('Não existe telefone associado a esta clinica')
    }

    return this.telefoneService.remove(telefoneId);
  }

  @ApiOperation({ summary: 'Remover um telefone especifico de uma clinica especifica' })
  @ApiOkResponse({ description: 'Telefone removido com sucesso.'})
  @Roles(TipoUsuario.admin)
  @Patch(':clinicaId/telefone/atualizar/:telefoneId')
  async updateTelefone(@Param('clinicaId', new ParseUUIDPipe({version: '4', 
    errorHttpStatusCode: 400, 
    exceptionFactory: () => new BadRequestException('ID Clinica inválido')})) clinicaId: string,@Param('telefoneId', new ParseUUIDPipe({version: '4', 
    errorHttpStatusCode: 400, 
    exceptionFactory: () => new BadRequestException('ID Telefone inválido')})) telefoneId: string,@Body() updateTelefoneDto: UpdateTelefoneDto){
    const telefones = await this.telefoneService.findByClinica(clinicaId, telefoneId);
    if(telefones.length === 0){
      throw new BadRequestException('Não existe telefone associado a esta clinica')
    }

    return this.telefoneService.update(telefoneId, updateTelefoneDto)
  }
}
