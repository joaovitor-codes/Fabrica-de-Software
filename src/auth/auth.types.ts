import { TipoUsuario, Usuario } from '@prisma/client';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  tokenType: 'access' | 'refresh';
  tipoUsuario?: TipoUsuario;
  sid?: string;
  exp?: number;
}

/** O que o AuthGuard coloca em `request.user`: o Usuario do banco + `sub` (= id). */
export type UsuarioAutenticado = Usuario & { sub: string };

/** Request de uma rota protegida pelo AuthGuard. */
export interface RequestAutenticado extends Request {
  user: UsuarioAutenticado;
}

/** Request de uma rota com OptionalAuthGuard: `user` só existe se havia token válido. */
export interface RequestOpcional extends Request {
  user?: UsuarioAutenticado;
}
