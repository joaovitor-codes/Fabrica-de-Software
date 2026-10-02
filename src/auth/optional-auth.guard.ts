import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';

/**
 * Para rotas públicas cujo conteúdo depende de quem está logado: com token
 * válido preenche `request.user` como o AuthGuard; sem token (ou com token
 * inválido) deixa passar com `request.user` indefinido.
 */
@Injectable()
export class OptionalAuthGuard extends AuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
        throw error;
      }
    }
    return true;
  }
}
