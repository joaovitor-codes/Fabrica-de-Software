import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const ALGORITMO = 'aes-256-gcm';
const VERSAO = 'v1';

/**
 * Cifra os tokens OAuth dos vendedores com AES-256-GCM. A chave vem de
 * RECEBEDOR_TOKEN_KEY e fica fora do banco. Formato gravado:
 * `v1:<iv>:<tag>:<conteudo>`, cada parte em base64url.
 */
@Injectable()
export class TokenCriptoService {
  constructor(private readonly configService: ConfigService) {}

  cifrar(texto: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITMO, this.chave(), iv);
    const conteudo = Buffer.concat([
      cipher.update(texto, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [VERSAO, iv, tag, conteudo]
      .map((parte) =>
        typeof parte === 'string' ? parte : parte.toString('base64url'),
      )
      .join(':');
  }

  decifrar(cifrado: string): string {
    const [versao, iv, tag, conteudo] = cifrado.split(':');
    if (versao !== VERSAO || !iv || !tag || !conteudo) {
      throw new Error('Token cifrado em formato desconhecido.');
    }

    const decipher = createDecipheriv(
      ALGORITMO,
      this.chave(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(conteudo, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Deriva 32 bytes da variável, que pode ter qualquer tamanho a partir de 32. */
  private chave(): Buffer {
    const segredo = this.configService.get<string>('RECEBEDOR_TOKEN_KEY');
    if (!segredo) {
      throw new ServiceUnavailableException(
        'RECEBEDOR_TOKEN_KEY não configurada.',
      );
    }
    return createHash('sha256').update(segredo).digest();
  }
}
