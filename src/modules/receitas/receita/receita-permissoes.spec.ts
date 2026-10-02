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
  favoritos: any[] = [];
  versoes: any[] = [];
  itensPlano: any[] = [];
  profissionais: any[] = [];

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

  receitaVersao = {
    create: async ({ data }: any) => {
      this.versoes.push(data);
      return data;
    },
    deleteMany: async ({ where }: any) => {
      this.versoes = this.versoes.filter(
        (v) => v.receitaId !== where.receitaId,
      );
    },
  };
  favorito = {
    deleteMany: async ({ where }: any) => {
      this.favoritos = this.favoritos.filter(
        (f) => f.receitaId !== where.receitaId,
      );
    },
  };
  planoAlimentarItem = {
    count: async ({ where }: any) =>
      this.itensPlano.filter((i) => i.receitaId === where.receitaId).length,
  };
  profissional = {
    findUnique: async ({ where }: any) =>
      this.profissionais.find((p) => p.usuarioId === where.usuarioId) ?? null,
  };
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
      versaoAtual: 1,
      deletedAt: null,
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

    it('receita aprovada editada volta para pendente e guarda a versão', async () => {
      prisma.receitas.set(receitaId, {
        ...prisma.receitas.get(receitaId),
        status: 'aprovada',
        profissionalAprovadorId: randomUUID(),
        dataAprovacao: new Date(),
      });

      await service.update(receitaId, { nome: 'Nova versão' } as any, autor);

      const receita = prisma.receitas.get(receitaId);
      expect(receita.status).toBe('pendente');
      expect(receita.profissionalAprovadorId).toBeNull();
      expect(receita.dataAprovacao).toBeNull();
      expect(prisma.versoes).toEqual([
        expect.objectContaining({ receitaId, nome: 'Omelete', versao: 1 }),
      ]);
    });

    it('receita pendente editada continua pendente, sem nova versão', async () => {
      await service.update(receitaId, { nome: 'Ajuste' } as any, autor);

      expect(prisma.receitas.get(receitaId).status).toBe('pendente');
      expect(prisma.versoes).toHaveLength(0);
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

    it('apaga de vez receita fora de planos, junto com favoritos e versões', async () => {
      prisma.favoritos.push({ receitaId, usuarioId: outro.id });
      prisma.versoes.push({ receitaId, versao: 1 });

      await service.remove(receitaId, autor);

      expect(prisma.receitas.has(receitaId)).toBe(false);
      expect(prisma.favoritos).toHaveLength(0);
      expect(prisma.versoes).toHaveLength(0);
    });

    it('mantém receita usada em plano (exclusão lógica) e remove favoritos', async () => {
      prisma.itensPlano.push({ receitaId });
      prisma.favoritos.push({ receitaId, usuarioId: outro.id });

      await service.remove(receitaId, autor);

      expect(prisma.receitas.get(receitaId).deletedAt).toBeInstanceOf(Date);
      expect(prisma.favoritos).toHaveLength(0);
    });

    it('não permite editar nem apagar de novo uma receita já excluída', async () => {
      prisma.itensPlano.push({ receitaId });
      await service.remove(receitaId, autor);

      await expect(service.remove(receitaId, autor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.update(receitaId, { nome: 'x' } as any, autor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('responde 404 para receita inexistente', async () => {
      await expect(service.remove(randomUUID(), admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('aprovar / rejeitar', () => {
    it('profissional não pode aprovar nem rejeitar a própria receita', async () => {
      const autorProfissional = usuario(TipoUsuario.profissional);
      prisma.profissionais.push({
        id: randomUUID(),
        usuarioId: autorProfissional.id,
        statusAprovacao: 'aprovado',
      });
      prisma.receitas.set(receitaId, {
        ...prisma.receitas.get(receitaId),
        criadoPor: autorProfissional.id,
      });

      await expect(
        service.aprovarReceita(receitaId, autorProfissional.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.rejeitarReceita(receitaId, autorProfissional.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.receitas.get(receitaId).status).toBe('pendente');
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
    const revisado = new Date('2026-10-01T00:00:00Z');

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
          {
            ingrediente: {
              ...leite,
              restricoesRevisadasEm: revisado,
              restricoes: [{ restricao: lactose }],
            },
          },
          {
            ingrediente: {
              ...queijo,
              restricoesRevisadasEm: revisado,
              restricoes: [{ restricao: lactose }],
            },
          },
          {
            ingrediente: {
              ...ovo,
              restricoesRevisadasEm: revisado,
              restricoes: [],
            },
          },
        ],
      });

      const alertas = await service.findAlerts(receitaId);

      expect(alertas).toEqual({
        avisoContaminacaoCruzada: true,
        restricoes: [{ ...lactose, ingredientes: [leite, queijo] }],
        ingredientesNaoRevisados: [],
      });
    });

    it('lista os ingredientes que ninguém revisou', async () => {
      const queijoCaseiro = { id: randomUUID(), nome: 'Queijo caseiro' };
      const ovo = { id: randomUUID(), nome: 'Ovo' };
      prisma.receitas.set(receitaId, {
        ...prisma.receitas.get(receitaId),
        status: 'aprovada',
        avisoContaminacaoCruzada: false,
        ingredientes: [
          {
            ingrediente: {
              ...queijoCaseiro,
              restricoesRevisadasEm: null,
              restricoes: [],
            },
          },
          {
            ingrediente: {
              ...ovo,
              restricoesRevisadasEm: revisado,
              restricoes: [],
            },
          },
        ],
      });

      const alertas = await service.findAlerts(receitaId);

      expect(alertas.ingredientesNaoRevisados).toEqual([queijoCaseiro]);
    });
  });
});
