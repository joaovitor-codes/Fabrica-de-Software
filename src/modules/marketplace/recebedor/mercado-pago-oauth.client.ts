import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const AUTORIZACAO_URL = 'https://auth.mercadopago.com.br/authorization';
const TOKEN_URL = 'https://api.mercadopago.com/oauth/token';

/** Resposta de POST /oauth/token. Os tokens nunca vão para log nem resposta. */
export interface TokensMercadoPago {
  access_token: string;
  refresh_token: string;
  user_id: number | string;
  expires_in: number;
  scope?: string;
}

interface ConfigOAuth {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

@Injectable()
export class MercadoPagoOAuthClient {
  private readonly logger = new Logger(MercadoPagoOAuthClient.name);

  constructor(private readonly configService: ConfigService) {}

  urlAutorizacao(state: string): string {
    const { clientId, redirectUri } = this.config();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      platform_id: 'mp',
      state,
      redirect_uri: redirectUri,
    });
    return `${AUTORIZACAO_URL}?${params.toString()}`;
  }

  trocarCodigo(code: string): Promise<TokensMercadoPago> {
    const { redirectUri } = this.config();
    return this.solicitarToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
  }

  renovar(refreshToken: string): Promise<TokensMercadoPago> {
    return this.solicitarToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  private async solicitarToken(
    campos: Record<string, string>,
  ): Promise<TokensMercadoPago> {
    const { clientId, clientSecret } = this.config();

    const resposta = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        ...campos,
      }),
    });

    if (!resposta.ok) {
      // Só o status e o código do erro: o corpo pode ecoar dados da requisição.
      const erro = (await resposta.json().catch(() => ({}))) as {
        error?: string;
      };
      this.logger.warn(
        `OAuth ${campos.grant_type} recusado: ${resposta.status} ${erro.error ?? ''}`,
      );
      throw new BadGatewayException(
        'O Mercado Pago recusou a autorização. Tente conectar novamente.',
      );
    }

    return (await resposta.json()) as TokensMercadoPago;
  }

  private config(): ConfigOAuth {
    const clientId = this.configService.get<string>('MP_CLIENT_ID');
    const clientSecret = this.configService.get<string>('MP_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('MP_REDIRECT_URI');

    if (!clientId || !clientSecret || !redirectUri) {
      throw new ServiceUnavailableException(
        'Integração com o Mercado Pago não configurada.',
      );
    }
    return { clientId, clientSecret, redirectUri };
  }
}
