import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TipoUsuario } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import type { RequestAutenticado } from './auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<TipoUsuario[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest<RequestAutenticado>();
    // Libera se algum papel da conta está na rota. Sem `papeis` (guards de
    // teste que só preenchem o tipo), vale o tipo.
    const papeis = user.papeis ?? [user.tipoUsuario];
    return requiredRoles.some((papel) => papeis.includes(papel));
  }
}
