import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TipoConsentimento } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TermosService {
  private readonly versaoAtual: string;

  constructor(
    private readonly prismaService: PrismaService,
    configService: ConfigService,
  ) {
    this.versaoAtual = configService.getOrThrow<string>(
      'MARKETPLACE_TERMOS_VERSAO',
    );
  }

  async consultar(usuarioId: string) {
    const aceite = await this.buscarAceiteAtual(usuarioId);

    return {
      versaoAtual: this.versaoAtual,
      aceito: !!aceite,
      aceitoEm: aceite?.createdAt ?? null,
    };
  }

  async aceitar(usuarioId: string, versaoDocumento: string, ipAddress?: string,) {
    if (versaoDocumento !== this.versaoAtual) {
      throw new UnprocessableEntityException('A versão enviada não é a atual.');
    }

    const existente = await this.buscarAceiteAtual(usuarioId);
    if (existente) return existente;

    return this.prismaService.consentimentoLgpd.create({
      data: {
        usuarioId,
        tipoConsentimento: TipoConsentimento.termos_marketplace,
        aceito: true,
        versaoDocumento: this.versaoAtual,
        ipAddress,
      },
    });
  }

  async garantirAceite(usuarioId: string): Promise<void> {
    if (!(await this.buscarAceiteAtual(usuarioId))) {
      throw new UnprocessableEntityException(
        'É preciso aceitar a versão atual dos termos do marketplace.',
      );
    }
  }

  private buscarAceiteAtual(usuarioId: string) {
    return this.prismaService.consentimentoLgpd.findFirst({
      where: {
        usuarioId,
        tipoConsentimento: TipoConsentimento.termos_marketplace,
        aceito: true,
        versaoDocumento: this.versaoAtual,
      },
    });
  }

}
