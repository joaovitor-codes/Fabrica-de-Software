import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { StatusRecebedor } from '@prisma/client';
import { randomBytes } from 'crypto';
import { CacheService } from '../../../common/cache/cache.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  MercadoPagoOAuthClient,
  TokensMercadoPago,
} from './mercado-pago-oauth.client';
import { TokenCriptoService } from './token-cripto.service';

const GATEWAY = 'mercado_pago';
// O `code` do Mercado Pago vale 10 minutos; o state não precisa durar mais.
const STATE_TTL_MS = 10 * 60 * 1000;
// O job renova as contas que vencem dentro desta janela (o token vale 180 dias).
const JANELA_RENOVACAO_DIAS = 30;

export interface CallbackOAuth {
  code?: string;
  state?: string;
  error?: string;
}

@Injectable()
export class RecebedorService {
  private readonly logger = new Logger(RecebedorService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly oauthClient: MercadoPagoOAuthClient,
    private readonly tokenCripto: TokenCriptoService,
  ) {}

  /** URL de autorização com um state aleatório, de uso único, ligado ao usuário. */
  async gerarUrlConexao(usuarioId: string) {
    const state = randomBytes(32).toString('base64url');
    await this.cacheService.set(
      this.chaveState(state),
      usuarioId,
      STATE_TTL_MS,
    );

    return { url: this.oauthClient.urlAutorizacao(state) };
  }

  async concluirConexao({ code, state, error }: CallbackOAuth) {
    if (error) {
      throw new BadRequestException(
        'A conexão com o Mercado Pago não foi autorizada.',
      );
    }
    if (!state || !code) {
      throw new BadRequestException(
        'Parâmetros code e state são obrigatórios.',
      );
    }

    const usuarioId = await this.consumirState(state);
    const tokens = await this.oauthClient.trocarCodigo(code);
    const gatewayRecebedorId = String(tokens.user_id);

    const ligadaAOutro = await this.prismaService.contaRecebedor.findFirst({
      where: {
        gateway: GATEWAY,
        gatewayRecebedorId,
        NOT: { usuarioId },
      },
    });
    if (ligadaAOutro) {
      throw new ConflictException(
        'Esta conta do Mercado Pago já está conectada a outro usuário.',
      );
    }

    const dadosTokens = this.dadosTokens(tokens);
    await this.prismaService.contaRecebedor.upsert({
      where: { usuarioId },
      create: {
        usuarioId,
        gateway: GATEWAY,
        gatewayRecebedorId,
        ...dadosTokens,
      },
      update: { gatewayRecebedorId, ...dadosTokens },
    });

    return { conectado: true, contaMercadoPagoId: gatewayRecebedorId };
  }

  async consultar(usuarioId: string) {
    const conta = await this.prismaService.contaRecebedor.findUnique({
      where: { usuarioId },
    });
    if (!conta) {
      return { conectado: false, status: null };
    }

    return {
      conectado: conta.status === StatusRecebedor.ativo,
      status: conta.status,
      contaMercadoPagoId: conta.gatewayRecebedorId,
      tokenExpiraEm: conta.tokenExpiraEm,
    };
  }

  async desconectar(usuarioId: string) {
    const conta = await this.prismaService.contaRecebedor.findUnique({
      where: { usuarioId },
    });
    if (!conta) {
      throw new NotFoundException('Nenhuma conta do Mercado Pago conectada.');
    }

    // Os tokens são apagados: uma conta desconectada não deve guardar acesso.
    await this.prismaService.contaRecebedor.update({
      where: { usuarioId },
      data: {
        status: StatusRecebedor.desconectado,
        accessTokenCifrado: '',
        refreshTokenCifrado: '',
      },
    });
  }

  /** Renova pelo refresh token as contas ativas perto do vencimento. */
  async renovarProximasDoVencimento(agora = new Date()) {
    const limite = new Date(
      agora.getTime() + JANELA_RENOVACAO_DIAS * 24 * 60 * 60 * 1000,
    );
    const contas = await this.prismaService.contaRecebedor.findMany({
      where: { status: StatusRecebedor.ativo, tokenExpiraEm: { lte: limite } },
    });

    let renovadas = 0;
    let desconectadas = 0;
    for (const conta of contas) {
      try {
        const tokens = await this.oauthClient.renovar(
          this.tokenCripto.decifrar(conta.refreshTokenCifrado),
        );
        // Os dois tokens mudam juntos: o refresh token antigo deixa de valer.
        await this.prismaService.contaRecebedor.update({
          where: { id: conta.id },
          data: this.dadosTokens(tokens, agora),
        });
        renovadas++;
      } catch {
        this.logger.warn(`Falha ao renovar a conta recebedora ${conta.id}.`);
        await this.prismaService.contaRecebedor.update({
          where: { id: conta.id },
          data: { status: StatusRecebedor.desconectado },
        });
        desconectadas++;
      }
    }

    return { renovadas, desconectadas };
  }

  /** Busca o token de acesso do vendedor. */
  async tokenDoVendedor(usuarioId: string): Promise<string> {
    const conta = await this.prismaService.contaRecebedor.findUnique({
      where: { usuarioId },
    });
    if (!conta || conta.status !== StatusRecebedor.ativo) {
      throw new UnprocessableEntityException(
        'Nenhuma conta do Mercado Pago conectada a este usuário.',
      );
    }
    return this.tokenCripto.decifrar(conta.accessTokenCifrado);
  }

  /** Busca o token de acesso de uma conta específica do Mercado Pago. */
  async tokenPorContaMercadoPago(gatewayRecebedorId: string): Promise<string> {
    const conta = await this.prismaService.contaRecebedor.findUnique({
      where: {
        gateway_gatewayRecebedorId: { gateway: GATEWAY, gatewayRecebedorId },
      },
    });
    if (!conta?.accessTokenCifrado) {
      throw new UnprocessableEntityException(
        'A conta do Mercado Pago não está conectada ou não possui token válido.',
      );
    }
    return this.tokenCripto.decifrar(conta.accessTokenCifrado);
  }

  private async consumirState(state: string): Promise<string> {
    const chave = this.chaveState(state);
    const usuarioId = await this.cacheService.get<string>(chave);
    if (!usuarioId) {
      throw new BadRequestException(
        'Link de conexão inválido ou expirado. Gere um novo.',
      );
    }
    await this.cacheService.del(chave);
    return usuarioId;
  }

  private dadosTokens(tokens: TokensMercadoPago, agora = new Date()) {
    return {
      accessTokenCifrado: this.tokenCripto.cifrar(tokens.access_token),
      refreshTokenCifrado: this.tokenCripto.cifrar(tokens.refresh_token),
      tokenExpiraEm: new Date(agora.getTime() + tokens.expires_in * 1000),
      status: StatusRecebedor.ativo,
    };
  }

  private chaveState(state: string) {
    return `recebedor:oauth-state:${state}`;
  }
}
