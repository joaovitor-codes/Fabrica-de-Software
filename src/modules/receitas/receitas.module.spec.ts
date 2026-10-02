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
import { ReceitasModule } from './receitas.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { IaService } from '../ia/ia.service';
import { UsuarioService } from '../identidade/usuario/usuario.service';
import { AuthGuard } from '../../auth/auth.guard';
import { OptionalAuthGuard } from '../../auth/optional-auth.guard';

/** Prisma e cache falsos no lugar dos módulos globais da aplicação. */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useValue: {
        favorito: { findMany: async () => [] },
        receita: { findMany: async () => [] },
      },
    },
    { provide: CacheService, useValue: { get: async () => null } },
  ],
  exports: [PrismaService, CacheService],
})
class InfraFalsaModule {}

class ProfissionalLogado implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    req.user = { id: 'p', sub: 'p', tipoUsuario: TipoUsuario.profissional };
    return true;
  }
}

/**
 * Os módulos de receita dividem o prefixo `api/receita`. As rotas fixas
 * (`GET favoritos`, `GET pendentes`) só funcionam se forem registradas antes
 * de `GET :id`, e isso depende da ordem dos imports em ReceitasModule.
 */
describe('ReceitasModule - ordem das rotas', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InfraFalsaModule, ReceitasModule],
    })
      .overrideProvider(IaService)
      .useValue({})
      .overrideProvider(UsuarioService)
      .useValue({})
      .overrideGuard(AuthGuard)
      .useClass(ProfissionalLogado)
      .overrideGuard(OptionalAuthGuard)
      .useClass(ProfissionalLogado)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET favoritos vai para o FavoritoController, não para GET :id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/receita/favoritos')
      .expect(404);
    expect(res.body.message).toBe('Nenhuma receita favorita encontrada');
  });

  it('GET pendentes vai para o CuradoriaReceitaController', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/receita/pendentes')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('as rotas do ReceitaController continuam respondendo', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/receita/all')
      .expect(404);
    expect(res.body.message).toBe('Nenhuma receita encontrada');

    await request(app.getHttpServer())
      .get('/api/receita/nao-e-uuid')
      .expect(400);
  });
});
