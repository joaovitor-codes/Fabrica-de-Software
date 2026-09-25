import { BadRequestException, Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TipoUsuario } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PontosTransacaoService } from './pontos-transacao.service';
import { AjustePontosDto } from './dtos/ajuste-pontos';

const uuidPipe = (mensagem: string) => new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
});

@ApiTags('Pontos Transação')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(TipoUsuario.admin)
@Controller('api/pontos-transacao')
export class PontosTransacaoController {
    constructor(
        private readonly pontosTransacaoService: PontosTransacaoService,
    ){}

    @ApiOperation({ summary: 'Listar o histórico de transações de pontos de um profissional' })
    @ApiResponse({ description: 'Retorna o histórico paginado de transações de pontos do profissional.' })
    @Get('profissional/:profissionalId')
    async historicoTransacoes(
        @Param('profissionalId', uuidPipe('ID inválido')) profissionalId: string,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    ){
        await this.pontosTransacaoService.exigirProfissionalExistente(profissionalId);
        return this.pontosTransacaoService.historicoTransacoes(profissionalId, page, limit);
    }

    @ApiOperation({ summary: 'Obter o saldo de pontos de um profissional' })
    @ApiResponse({ description: 'Retorna o saldo de pontos de incentivo do profissional.' })
    @Get('profissional/:profissionalId/saldo')
    async getSaldo(@Param('profissionalId', uuidPipe('ID inválido')) profissionalId: string){
        await this.pontosTransacaoService.exigirProfissionalExistente(profissionalId);
        const saldo = await this.pontosTransacaoService.getSaldo(profissionalId);

        return { saldo };
    }

    @ApiOperation({ summary: 'Realizar um ajuste manual nos pontos de um profissional' })
    @ApiCreatedResponse({ description: 'Ajuste de pontos realizado com sucesso.' })
    @Post('ajuste')
    async ajusteManual(@Request() request, @Body() dto: AjustePontosDto){
        return this.pontosTransacaoService.ajusteManual(request.user.sub, dto);
    }
}
