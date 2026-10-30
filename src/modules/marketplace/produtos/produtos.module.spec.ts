/// <reference types="jest" />

import {
  CanActivate,
  ExecutionContext,
  Global,
  INestApplication,
  Module,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TipoUsuario } from '@prisma/client';
import { ProdutosModule } from './produtos.module';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TermosService } from '../termos/termos.service';
import { AuthGuard } from '../../../auth/auth.guard';
import { OptionalAuthGuard } from '../../../auth/optional-auth.guard';

/** Prisma falso no lugar do módulo global da aplicação. */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useValue: {
        produto: { findMany: async () => [] },
        produtoDenuncia: { findMany: async () => [] },
        categoriaProduto: { findMany: async () => [] },
      },
    },
  ],
  exports: [PrismaService],
})
class InfraFalsaModule {}

class AdminLogado implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    req.user = { id: 'a', sub: 'a', tipoUsuario: TipoUsuario.admin };
    return true;
  }
}

/**
 * Os módulos da vitrine dividem o prefixo `api/produto`. As rotas fixas
 * (`GET denuncias`, `GET meus`, `GET opcoes/*`) só funcionam se forem
 * registradas antes de `GET :id`, e isso depende da ordem dos imports em
 * ProdutosModule e dos controllers em ProdutoModule.
 */
describe('ProdutosModule - ordem das rotas', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InfraFalsaModule, ProdutosModule],
    })
      .overrideProvider(TermosService)
      .useValue({})
      .overrideGuard(AuthGuard)
      .useClass(AdminLogado)
      .overrideGuard(OptionalAuthGuard)
      .useClass(AdminLogado)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET denuncias vai para o ProdutoDenunciaController, não para GET :id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/produto/denuncias')
      .expect(404);
    expect(res.body.message).toBe('Não há denúncias abertas');
  });

  it('GET meus vai para o ProdutoController', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/produto/meus')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('GET opcoes/categorias vai para o ProdutoController', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/produto/opcoes/categorias')
      .expect(404);
    expect(res.body.message).toBe('Nenhuma categoria de produto encontrada');
  });

  it('GET :id continua respondendo', async () => {
    await request(app.getHttpServer())
      .get('/api/produto/nao-e-uuid')
      .expect(400);
  });
});
