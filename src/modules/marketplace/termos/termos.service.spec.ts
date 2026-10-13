/// <reference types="jest" />

import { UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TipoConsentimento } from '@prisma/client';
import { TermosService } from './termos.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/** Fake em memória da tabela consentimentos_lgpd. */
class FakePrismaService {
  consentimentos: any[] = [];

  consentimentoLgpd = {
    findFirst: async ({ where }: any) =>
      this.consentimentos.find((c) =>
        Object.entries(where).every(([campo, valor]) => c[campo] === valor),
      ) ?? null,
    create: async ({ data }: any) => {
      const registro = {
        id: `c${this.consentimentos.length + 1}`,
        createdAt: new Date(),
        ...data,
      };
      this.consentimentos.push(registro);
      return registro;
    },
  };
}

const USUARIO_ID = 'usuario-1';

async function criarService(prisma: FakePrismaService, versao: string) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TermosService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: ConfigService,
        useValue: { getOrThrow: () => versao },
      },
    ],
  }).compile();

  return module.get<TermosService>(TermosService);
}

describe('TermosService', () => {
  let prisma: FakePrismaService;
  let service: TermosService;

  beforeEach(async () => {
    prisma = new FakePrismaService();
    service = await criarService(prisma, '1.0');
  });

  it('informa que o usuário ainda não aceitou', async () => {
    await expect(service.consultar(USUARIO_ID)).resolves.toEqual({
      versaoAtual: '1.0',
      aceito: false,
      aceitoEm: null,
    });
  });

  it('registra o aceite da versão atual como termos_marketplace', async () => {
    await service.aceitar(USUARIO_ID, '1.0', '127.0.0.1');

    expect(prisma.consentimentos).toHaveLength(1);
    expect(prisma.consentimentos[0]).toMatchObject({
      usuarioId: USUARIO_ID,
      tipoConsentimento: TipoConsentimento.termos_marketplace,
      aceito: true,
      versaoDocumento: '1.0',
      ipAddress: '127.0.0.1',
    });
    await expect(service.consultar(USUARIO_ID)).resolves.toMatchObject({
      aceito: true,
    });
  });

  it('recusa versão diferente da atual com 422', async () => {
    await expect(service.aceitar(USUARIO_ID, '0.9')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(prisma.consentimentos).toHaveLength(0);
  });

  it('não duplica o aceite da mesma versão', async () => {
    const primeiro = await service.aceitar(USUARIO_ID, '1.0');
    const segundo = await service.aceitar(USUARIO_ID, '1.0');

    expect(segundo).toBe(primeiro);
    expect(prisma.consentimentos).toHaveLength(1);
  });

  it('não conta consentimento de outro tipo', async () => {
    prisma.consentimentos.push({
      usuarioId: USUARIO_ID,
      tipoConsentimento: TipoConsentimento.marketing,
      aceito: true,
      versaoDocumento: '1.0',
    });

    await expect(service.garantirAceite(USUARIO_ID)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('garantirAceite libera com o aceite da versão atual', async () => {
    await service.aceitar(USUARIO_ID, '1.0');

    await expect(service.garantirAceite(USUARIO_ID)).resolves.toBeUndefined();
  });

  it('troca de versão volta a exigir aceite e mantém o histórico', async () => {
    await service.aceitar(USUARIO_ID, '1.0');

    const novaVersao = await criarService(prisma, '2.0');
    await expect(novaVersao.garantirAceite(USUARIO_ID)).rejects.toThrow(
      UnprocessableEntityException,
    );

    await novaVersao.aceitar(USUARIO_ID, '2.0');
    await expect(
      novaVersao.garantirAceite(USUARIO_ID),
    ).resolves.toBeUndefined();
    expect(prisma.consentimentos.map((c) => c.versaoDocumento)).toEqual([
      '1.0',
      '2.0',
    ]);
  });
});
