import { TipoUsuario, Usuario } from '@prisma/client';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  tokenType: 'access' | 'refresh';
  tipoUsuario?: TipoUsuario;
  sid?: string;
  exp?: number;
}

/**
 * O que o AuthGuard coloca em `request.user`: o Usuario do banco + `sub`
 * (= id) + `papeis` (ver papeisDaConta). Decida acesso por `papeis`, não
 * pelo `tipoUsuario`: o profissional com registro de paciente tem os dois.
 */
export type UsuarioAutenticado = Usuario & {
  sub: string;
  papeis: TipoUsuario[];
};

/** Request de uma rota protegida pelo AuthGuard. */
export interface RequestAutenticado extends Request {
  user: UsuarioAutenticado;
}

/** Request de uma rota com OptionalAuthGuard: `user` só existe se havia token válido. */
export interface RequestOpcional extends Request {
  user?: UsuarioAutenticado;
}
