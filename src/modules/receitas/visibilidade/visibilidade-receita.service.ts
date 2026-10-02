import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StatusReceita, TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import {
  RestricaoDoPaciente,
  clausulaSegura,
  restricaoPorId,
  restricoesDoUsuario,
  restricoesVioladas,
  semAdaptacoesDeOutros,
} from './restricoes-receita';

/**
 * Quem vê quais receitas, considerando as restrições alimentares do
 * paciente. Usado pelas listagens, pela receita aberta pelo id, pelos
 * favoritos e pela adaptação. Regras em regra_negocio_receitas_seguras.md.
 */
@Injectable()
export class VisibilidadeReceitaService {
  constructor(private readonly prismaService: PrismaService) {}

  ehEquipe(usuario?: UsuarioAutenticado) {
    return (
      usuario?.tipoUsuario === TipoUsuario.admin ||
      usuario?.tipoUsuario === TipoUsuario.profissional
    );
  }

  /**
   * Quem vê quais receitas, sem olhar restrição: visitante só as aprovadas;
   * usuário logado as aprovadas e as próprias; admin e profissional
   * (curadoria) todas. Adaptação feita para um paciente só aparece para ele.
   */
  filtroBase(usuario?: UsuarioAutenticado): Prisma.ReceitaWhereInput {
    if (!usuario) {
      return { status: StatusReceita.aprovada, AND: [semAdaptacoesDeOutros()] };
    }
    if (this.ehEquipe(usuario)) {
      return {};
    }
    return {
      OR: [
        {
          status: StatusReceita.aprovada,
          AND: [semAdaptacoesDeOutros(usuario.id)],
        },
        { criadoPor: usuario.id },
      ],
    };
  }

  /** Para as listas só de aprovadas: esconde adaptações de outros pacientes. */
  semPrivadasDeOutros(usuario?: UsuarioAutenticado): Prisma.ReceitaWhereInput {
    return this.ehEquipe(usuario) ? {} : semAdaptacoesDeOutros(usuario?.id);
  }

  /**
   * filtroBase mais as restrições do paciente:
   * - a receita aprovada que fere uma restrição estrita (alergia ou grave)
   *   some; o autor continua vendo as próprias;
   * - a adaptação ainda não verificada aparece para quem tem a restrição
   *   dela como leve/moderada, e para quem pediu, exceto se a restrição for
   *   estrita para ele: aí só depois da verificação.
   */
  filtroVisibilidade(
    usuario: UsuarioAutenticado | undefined,
    restricoes: RestricaoDoPaciente[],
  ): Prisma.ReceitaWhereInput {
    if (!usuario || this.ehEquipe(usuario)) {
      return this.filtroBase(usuario);
    }

    const estritas = restricoes.filter((r) => r.estrita);
    const flexiveis = restricoes.filter((r) => !r.estrita);
    const segura = clausulaSegura(estritas);
    return {
      OR: [
        {
          status: StatusReceita.aprovada,
          AND: [semAdaptacoesDeOutros(usuario.id)],
          ...segura,
        },
        { criadoPor: usuario.id, adaptacaoDe: { is: null } },
        {
          criadoPor: usuario.id,
          adaptacaoDe: {
            is: {
              restricaoId: { notIn: estritas.map((r) => r.restricaoId) },
            },
          },
          ...segura,
        },
        ...(flexiveis.length > 0
          ? [
              {
                status: StatusReceita.pendente,
                adaptacaoDe: {
                  is: {
                    restricaoId: { in: flexiveis.map((r) => r.restricaoId) },
                  },
                },
                ...segura,
              },
            ]
          : []),
      ],
    };
  }

  /** `?seguraPara=<restricaoId>`: só receitas seguras para essa restrição. */
  async filtroSeguraPara(
    restricaoId?: string,
  ): Promise<Prisma.ReceitaWhereInput> {
    if (!restricaoId) {
      return {};
    }
    const restricao = await restricaoPorId(this.prismaService, restricaoId);
    if (!restricao) {
      throw new NotFoundException('Restrição alimentar não encontrada');
    }
    return clausulaSegura([restricao]);
  }

  /**
   * Acrescenta `restricoesVioladas` a cada receita, para o paciente com
   * restrição. Sem restrição, devolve as receitas como estão.
   */
  async comRestricoesVioladas<T extends { id: string }>(
    receitas: T[],
    restricoes: RestricaoDoPaciente[],
  ) {
    if (restricoes.length === 0) {
      return receitas;
    }
    const violadas = await restricoesVioladas(
      this.prismaService,
      receitas.map((r) => r.id),
      restricoes,
    );
    return receitas.map((r) => ({
      ...r,
      restricoesVioladas: violadas.get(r.id) ?? [],
    }));
  }

  /**
   * A receita não passou no filtro. Se ela existe e só foi escondida por uma
   * restrição estrita do paciente, responde 403 dizendo qual; senão, 404.
   */
  async naoEncontrada(
    id: string,
    usuario: UsuarioAutenticado | undefined,
    restricoes: RestricaoDoPaciente[],
  ): Promise<never> {
    const estritas = restricoes.filter((r) => r.estrita);
    if (estritas.length > 0) {
      const existe = await this.prismaService.receita.findFirst({
        where: { id, ...this.filtroBase(usuario) },
        select: {
          id: true,
          status: true,
          ingredientesNaoListados: true,
          adaptacaoDe: { select: { id: true } },
        },
      });
      if (existe?.adaptacaoDe && existe.status === StatusReceita.pendente) {
        throw new ForbiddenException(
          'Esta adaptação ainda não foi verificada por um profissional',
        );
      }
      if (existe) {
        const violadas = await restricoesVioladas(
          this.prismaService,
          [id],
          estritas,
        );
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Esta receita não é segura para as suas restrições',
          restricoesVioladas: violadas.get(id) ?? [],
          ingredientesNaoListados: existe.ingredientesNaoListados ?? [],
        });
      }
    }
    throw new NotFoundException('Receita não encontrada');
  }

  /** 404/403 se o usuário não pode ver a receita. */
  async garantirVisivel(id: string, usuario?: UsuarioAutenticado) {
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receita = await this.prismaService.receita.findFirst({
      where: { id, ...this.filtroVisibilidade(usuario, restricoes) },
      select: { id: true },
    });
    if (!receita) {
      await this.naoEncontrada(id, usuario, restricoes);
    }
  }
}
