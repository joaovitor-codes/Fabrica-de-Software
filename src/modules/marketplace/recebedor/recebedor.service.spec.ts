/// <reference types="jest" />

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { StatusRecebedor } from '@prisma/client';
import { CacheService } from '../../../common/cache/cache.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MercadoPagoOAuthClient } from './mercado-pago-oauth.client';
import { RecebedorService } from './recebedor.service';
import { TokenCriptoService } from './token-cripto.service';

/** Fake em memória da tabela contas_recebedor. */
class FakePrismaService {
  contas: any[] = [];

  private combina(conta: any, where: any): boolean {
    return Object.entries(where).every(([campo, valor]: [string, any]) => {
      if (campo === 'NOT') return !this.combina(conta, valor);
      if (valor && typeof valor === 'object' && 'lte' in valor) {
        return conta[campo] <= valor.lte;
      }
      return conta[campo] === valor;
    });
  }

  contaRecebedor = {
    findUnique: async ({ where }: any) =>
      this.contas.find((c) => this.combina(c, where)) ?? null,
    findFirst: async ({ where }: any) =>
      this.contas.find((c) => this.combina(c, where)) ?? null,
    findMany: async ({ where }: any) =>
      this.contas.filter((c) => this.combina(c, where)),
    upsert: async ({ where, create, update }: any) => {
      const existente = this.contas.find((c) => this.combina(c, where));
      if (existente) return Object.assign(existente, update);
      const conta = { id: `conta-${this.contas.length + 1}`, ...create };
      this.contas.push(conta);
      return conta;
    },
    update: async ({ where, data }: any) =>
      Object.assign(
        this.contas.find((c) => this.combina(c, where)),
        data,
      ),
  };
}

class FakeCacheService {
  valores = new Map<string, unknown>();
  get = async (chave: string) => this.valores.get(chave);
  set = async (chave: string, valor: unknown) => {
    this.valores.set(chave, valor);
  };
  del = async (chave: string) => {
    this.valores.delete(chave);
  };
}

const USUARIO_ID = 'usuario-1';

function tokens(userId = 123456, sufixo = '1') {
  return {
    access_token: `APP_USR-access-${sufixo}`,
    refresh_token: `TG-refresh-${sufixo}`,
    user_id: userId,
    expires_in: 15552000,
  };
}

describe('RecebedorService', () => {
  let prisma: FakePrismaService;
  let cache: FakeCacheService;
  let oauth: {
    urlAutorizacao: jest.Mock;
    trocarCodigo: jest.Mock;
    renovar: jest.Mock;
  };
  let cripto: TokenCriptoService;
  let service: RecebedorService;

  beforeEach(async () => {
    prisma = new FakePrismaService();
    cache = new FakeCacheService();
    oauth = {
      urlAutorizacao: jest.fn(
        (state: string) =>
          `https://auth.mercadopago.com.br/authorization?state=${state}`,
      ),
      trocarCodigo: jest.fn().mockResolvedValue(tokens()),
      renovar: jest.fn().mockResolvedValue(tokens(123456, '2')),
    };
    cripto = new TokenCriptoService({
      get: () => 'chave_de_teste_com_mais_de_32_caracteres',
    } as unknown as ConfigService);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecebedorService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: MercadoPagoOAuthClient, useValue: oauth },
        { provide: TokenCriptoService, useValue: cripto },
      ],
    }).compile();

    service = module.get<RecebedorService>(RecebedorService);
  });

  async function conectar(usuarioId = USUARIO_ID) {
    const { url } = await service.gerarUrlConexao(usuarioId);
    const state = new URL(url).searchParams.get('state')!;
    return service.concluirConexao({ code: 'TG-code', state });
  }

  describe('conexão', () => {
    it('gera um state aleatório ligado ao usuário', async () => {
      const a = await service.gerarUrlConexao(USUARIO_ID);
      const b = await service.gerarUrlConexao(USUARIO_ID);

      expect(a.url).not.toBe(b.url);
      expect([...cache.valores.values()]).toEqual([USUARIO_ID, USUARIO_ID]);
    });

    it('cria a conta ativa com os tokens cifrados', async () => {
      await expect(conectar()).resolves.toEqual({
        conectado: true,
        contaMercadoPagoId: '123456',
      });

      const [conta] = prisma.contas;
      expect(conta).toMatchObject({
        usuarioId: USUARIO_ID,
        gatewayRecebedorId: '123456',
        status: StatusRecebedor.ativo,
      });
      expect(conta.accessTokenCifrado).not.toContain('APP_USR');
      expect(cripto.decifrar(conta.accessTokenCifrado)).toBe(
        'APP_USR-access-1',
      );
      expect(cripto.decifrar(conta.refreshTokenCifrado)).toBe('TG-refresh-1');
    });

    it('não aceita o mesmo state duas vezes', async () => {
      const { url } = await service.gerarUrlConexao(USUARIO_ID);
      const state = new URL(url).searchParams.get('state')!;
      await service.concluirConexao({ code: 'TG-code', state });

      await expect(
        service.concluirConexao({ code: 'TG-code', state }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa state desconhecido sem chamar o Mercado Pago', async () => {
      await expect(
        service.concluirConexao({ code: 'TG-code', state: 'inventado' }),
      ).rejects.toThrow(BadRequestException);
      expect(oauth.trocarCodigo).not.toHaveBeenCalled();
    });

    it('recusa quando o vendedor nega a autorização', async () => {
      await expect(
        service.concluirConexao({ error: 'access_denied' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa conta do Mercado Pago já ligada a outro usuário', async () => {
      await conectar('usuario-1');

      await expect(conectar('usuario-2')).rejects.toThrow(ConflictException);
    });

    it('reativa uma conta desconectada', async () => {
      await conectar();
      await service.desconectar(USUARIO_ID);
      await conectar();

      expect(prisma.contas).toHaveLength(1);
      expect(prisma.contas[0].status).toBe(StatusRecebedor.ativo);
    });

    it('propaga a recusa do Mercado Pago', async () => {
      oauth.trocarCodigo.mockRejectedValueOnce(new BadGatewayException());

      await expect(conectar()).rejects.toThrow(BadGatewayException);
      expect(prisma.contas).toHaveLength(0);
    });
  });

  describe('consulta e desconexão', () => {
    it('informa quando não há conta', async () => {
      await expect(service.consultar(USUARIO_ID)).resolves.toEqual({
        conectado: false,
        status: null,
      });
    });

    it('nunca devolve tokens na consulta', async () => {
      await conectar();

      const resposta = await service.consultar(USUARIO_ID);
      expect(resposta).toMatchObject({ conectado: true, status: 'ativo' });
      expect(JSON.stringify(resposta)).not.toMatch(
        /token_|APP_USR|TG-|Cifrado/,
      );
    });

    it('desconecta e apaga os tokens', async () => {
      await conectar();
      await service.desconectar(USUARIO_ID);

      expect(prisma.contas[0]).toMatchObject({
        status: StatusRecebedor.desconectado,
        accessTokenCifrado: '',
        refreshTokenCifrado: '',
      });
    });

    it('responde 404 ao desconectar sem conta', async () => {
      await expect(service.desconectar(USUARIO_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('renovação', () => {
    const agora = new Date('2026-10-30T03:00:00Z');
    const dias = (n: number) => new Date(agora.getTime() + n * 86400000);

    it('renova só as contas ativas perto do vencimento, trocando os dois tokens', async () => {
      await conectar('usuario-1');
      prisma.contas[0].tokenExpiraEm = dias(10);
      prisma.contas.push({
        ...prisma.contas[0],
        id: 'conta-longe',
        usuarioId: 'usuario-3',
        tokenExpiraEm: dias(100),
      });

      await expect(service.renovarProximasDoVencimento(agora)).resolves.toEqual(
        {
          renovadas: 1,
          desconectadas: 0,
        },
      );
      expect(oauth.renovar).toHaveBeenCalledWith('TG-refresh-1');
      const renovada = prisma.contas[0];
      expect(cripto.decifrar(renovada.accessTokenCifrado)).toBe(
        'APP_USR-access-2',
      );
      expect(cripto.decifrar(renovada.refreshTokenCifrado)).toBe(
        'TG-refresh-2',
      );
      expect(renovada.tokenExpiraEm.getTime()).toBe(
        agora.getTime() + 15552000 * 1000,
      );
    });

    it('marca desconectada quando a renovação falha', async () => {
      await conectar();
      prisma.contas[0].tokenExpiraEm = dias(1);
      oauth.renovar.mockRejectedValueOnce(new BadGatewayException());

      await expect(service.renovarProximasDoVencimento(agora)).resolves.toEqual(
        {
          renovadas: 0,
          desconectadas: 1,
        },
      );
      expect(prisma.contas[0].status).toBe(StatusRecebedor.desconectado);
    });
  });
});
