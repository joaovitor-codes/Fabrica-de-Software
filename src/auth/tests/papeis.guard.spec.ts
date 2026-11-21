/// <reference types="jest" />

import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TipoUsuario } from '@prisma/client';
import { AuthGuard } from '../auth.guard';
import { RolesGuard } from '../roles.guard';
import { PrismaService } from '../../common/prisma/prisma.service';

const { comum, paciente, profissional, admin } = TipoUsuario;

function contexto(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('Papéis derivados dos registros', () => {
  describe('AuthGuard', () => {
    const usuarioDoBanco = (
      tipoUsuario: TipoUsuario,
      temPaciente: boolean,
    ) => ({
      id: 'u1',
      nome: 'Ana',
      tipoUsuario,
      paciente: temPaciente ? { id: 'pac1' } : null,
    });

    async function autenticar(tipoUsuario: TipoUsuario, temPaciente: boolean) {
      const findUnique = jest.fn(async () =>
        usuarioDoBanco(tipoUsuario, temPaciente),
      );
      const guard = new AuthGuard(
        {
          verifyAsync: async () => ({ sub: 'u1', tokenType: 'access' }),
        } as unknown as JwtService,
        { get: () => 'segredo' } as unknown as ConfigService,
        { usuario: { findUnique } } as unknown as PrismaService,
      );
      const request: Record<string, any> = {
        headers: { authorization: 'Bearer token' },
      };
      await guard.canActivate(contexto(request));
      return { user: request.user, findUnique };
    }

    it.each([
      [comum, false, [comum]],
      [paciente, true, [paciente]],
      [profissional, false, [profissional]],
      [profissional, true, [profissional, paciente]],
      [admin, false, [admin]],
    ])(
      '%s com registro de paciente = %s tem os papéis %j',
      async (tipo, temPaciente, papeis) => {
        const { user } = await autenticar(tipo, temPaciente);
        expect(user.papeis).toEqual(papeis);
        expect(user).toMatchObject({ id: 'u1', sub: 'u1', tipoUsuario: tipo });
        expect(user).not.toHaveProperty('paciente');
      },
    );

    it('faz uma consulta só, trazendo o registro de paciente junto', async () => {
      const { findUnique } = await autenticar(profissional, true);
      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        include: { paciente: { select: { id: true } } },
      });
    });
  });

  describe('RolesGuard', () => {
    function libera(rota: TipoUsuario[], user: Record<string, unknown>) {
      const guard = new RolesGuard({
        getAllAndOverride: () => rota,
      } as unknown as Reflector);
      return guard.canActivate(contexto({ user }));
    }
    const conta = (...papeis: TipoUsuario[]) => ({
      tipoUsuario: papeis[0],
      papeis,
    });

    it('contas de um papel só têm o mesmo acesso de antes', () => {
      expect(libera([paciente], conta(paciente))).toBe(true);
      expect(libera([paciente], conta(comum))).toBe(false);
      expect(libera([paciente], conta(profissional))).toBe(false);
      expect(libera([profissional], conta(profissional))).toBe(true);
      expect(libera([profissional], conta(paciente))).toBe(false);
      expect(libera([comum, paciente], conta(comum))).toBe(true);
      expect(libera([admin], conta(profissional))).toBe(false);
    });

    it('profissional com registro de paciente entra nas rotas dos dois', () => {
      const ambos = conta(profissional, paciente);
      expect(libera([paciente], ambos)).toBe(true);
      expect(libera([profissional], ambos)).toBe(true);
      expect(libera([admin], ambos)).toBe(false);
    });

    it('sem papeis (guards de teste), vale o tipo', () => {
      expect(libera([paciente], { tipoUsuario: paciente })).toBe(true);
      expect(libera([paciente], { tipoUsuario: comum })).toBe(false);
    });
  });
});
