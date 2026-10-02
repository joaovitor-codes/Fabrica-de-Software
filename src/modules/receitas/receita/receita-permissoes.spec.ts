/// <reference types="jest" />

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { TipoMidia, TipoRestricao, TipoUsuario } from '@prisma/client';
import { ReceitaService } from './receita.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { PontosTransacaoService } from '../pontos-transacao/pontos-transacao.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';

/** Fake em memória cobrindo só o que update/remove/upload/alertas usam. */
class FakePrismaService {
  receitas = new Map<string, any>();
  midias: any[] = [];

  async $transaction(fn: (tx: any) => Promise<any>) {
    return fn(this);
  }

  receita = {
    findUnique: async ({ where }: any) => this.receitas.get(where.id) ?? null,
    findFirst: async ({ where }: any) => this.receitas.get(where.id) ?? null,
    update: async ({ where, data }: any) => {
      const receita = { ...this.receitas.get(where.id), ...data };
      this.receitas.set(where.id, receita);
      return receita;
    },
    delete: async ({ where }: any) => this.receitas.delete(where.id),
  };

  receitaVersao = { create: async () => ({}) };
  receitaIngrediente = { deleteMany: async () => ({}) };
  receitaMidia = {
    deleteMany: async () => ({}),
    create: async ({ data }: any) => {
      this.midias.push(data);
      return data;
    },
  };
}

const usuario = (tipoUsuario: TipoUsuario): UsuarioAutenticado => {
  const id = randomUUID();
  return { id, sub: id, tipoUsuario } as UsuarioAutenticado;
};

describe('ReceitaService - autor ou admin e alertas', () => {
  let service: ReceitaService;
  let prisma: FakePrismaService;

  const autor = usuario(TipoUsuario.comum);
  const outro = usuario(TipoUsuario.comum);
  const profissional = usuario(TipoUsuario.profissional);
  const admin = usuario(TipoUsuario.admin);
  let receitaId: string;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReceitaService,
        { provide: PrismaService, useClass: FakePrismaService },
        { provide: CacheService, useValue: { del: async () => {} } },
        { provide: UsuarioService, useValue: {} },
        { provide: PontosTransacaoService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(ReceitaService);
    prisma = moduleRef.get(PrismaService);

    receitaId = randomUUID();
    prisma.receitas.set(receitaId, {
      id: receitaId,
      nome: 'Omelete',
      status: 'pendente',
      criadoPor: autor.id,
    });
  });

  describe('update', () => {
    it('rejeita usuário que não é o autor, inclusive profissional', async () => {
      for (const u of [outro, profissional]) {
        await expect(
          service.update(receitaId, { nome: 'Invadida' } as any, u),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(prisma.receitas.get(receitaId).nome).toBe('Omelete');
    });

    it('permite o autor e o admin', async () => {
      await service.update(receitaId, { nome: 'Pelo autor' } as any, autor);
      expect(prisma.receitas.get(receitaId).nome).toBe('Pelo autor');

      await service.update(receitaId, { nome: 'Pelo admin' } as any, admin);
      expect(prisma.receitas.get(receitaId).nome).toBe('Pelo admin');
    });
  });

  describe('remove', () => {
    it('rejeita usuário que não é o autor', async () => {
      await expect(service.remove(receitaId, outro)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.receitas.has(receitaId)).toBe(true);
    });

    it('permite o autor', async () => {
      await service.remove(receitaId, autor);
      expect(prisma.receitas.has(receitaId)).toBe(false);
    });

    it('permite o admin', async () => {
      await service.remove(receitaId, admin);
      expect(prisma.receitas.has(receitaId)).toBe(false);
    });

    it('responde 404 para receita inexistente', async () => {
      await expect(service.remove(randomUUID(), admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('uploadMedia', () => {
    const arquivo = () =>
      ({
        path: `/tmp/nao-existe-${randomUUID()}.png`,
        mimetype: 'image/png',
        size: 1024,
        fieldname: 'image',
        filename: 'foto.png',
      }) as Express.Multer.File;

    it('rejeita usuário que não é o autor e não grava a mídia', async () => {
      await expect(
        service.uploadMedia(receitaId, arquivo(), TipoMidia.capa, 0, outro),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.midias).toHaveLength(0);
    });

    it('permite o autor', async () => {
      await service.uploadMedia(receitaId, arquivo(), TipoMidia.capa, 0, autor);
      expect(prisma.midias).toHaveLength(1);
    });
  });

  describe('findAlerts', () => {
    it('agrupa as restrições dos ingredientes e não expõe pontos', async () => {
      const lactose = {
        id: randomUUID(),
        nome: 'Lactose',
        tipo: TipoRestricao.intolerancia,
      };
      const leite = { id: randomUUID(), nome: 'Leite' };
      const queijo = { id: randomUUID(), nome: 'Queijo' };
      const ovo = { id: randomUUID(), nome: 'Ovo' };
      prisma.receitas.set(receitaId, {
        ...prisma.receitas.get(receitaId),
        status: 'aprovada',
        avisoContaminacaoCruzada: true,
        pontosTransacoes: [{ pontos: 10 }],
        ingredientes: [
          { ingrediente: { ...leite, restricoes: [{ restricao: lactose }] } },
          { ingrediente: { ...queijo, restricoes: [{ restricao: lactose }] } },
          { ingrediente: { ...ovo, restricoes: [] } },
        ],
      });

      const alertas = await service.findAlerts(receitaId);

      expect(alertas).toEqual({
        avisoContaminacaoCruzada: true,
        restricoes: [{ ...lactose, ingredientes: [leite, queijo] }],
      });
    });
  });
});
