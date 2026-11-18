import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StatusCompraReceita,
  StatusReceita,
  StatusRecebedor,
  TipoUsuario,
} from '@prisma/client';
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
 * A cópia de uma compra é aprovada e não tem oferta, mas é conteúdo pago.
 * O `criadoPor` dela é o vendedor, então ser o autor não libera a cópia.
 */
const semCopiasDeCompra = {
  copiaDeCompra: { is: null },
} satisfies Prisma.ReceitaWhereInput;

/**
 * Status da compra em que o comprador tem a cópia (seção 4.5 das decisões
 * do marketplace). Reembolsada, a cópia sai do ar.
 */
export const STATUS_COM_COPIA = [
  StatusCompraReceita.paga,
  StatusCompraReceita.reembolso_em_analise,
];

/** A cópia que o próprio usuário comprou (P8: o acesso vem da compra). */
const copiaDoComprador = (usuarioId: string) =>
  ({
    copiaDeCompra: {
      is: { compradorId: usuarioId, status: { in: STATUS_COM_COPIA } },
    },
  }) satisfies Prisma.ReceitaWhereInput;

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
   * A cópia de uma compra só o comprador e o admin abrem; o vendedor, que é
   * o `criadoPor` dela, não.
   */
  filtroBase(usuario?: UsuarioAutenticado): Prisma.ReceitaWhereInput {
    if (!usuario) {
      return {
        ...semCopiasDeCompra,
        status: StatusReceita.aprovada,
        AND: [semAdaptacoesDeOutros()],
      };
    }
    if (usuario.tipoUsuario === TipoUsuario.admin) {
      return {};
    }
    if (this.ehEquipe(usuario)) {
      return { OR: [semCopiasDeCompra, copiaDoComprador(usuario.id)] };
    }
    return {
      OR: [
        {
          ...semCopiasDeCompra,
          status: StatusReceita.aprovada,
          AND: [semAdaptacoesDeOutros(usuario.id)],
        },
        { ...semCopiasDeCompra, criadoPor: usuario.id },
        copiaDoComprador(usuario.id),
      ],
    };
  }

  /** Tira as cópias de compra; para quem ainda não abre a cópia por esta rota. */
  semCopiasDeCompra(): Prisma.ReceitaWhereInput {
    return semCopiasDeCompra;
  }

  /**
   * A compra que dá ao usuário acesso à cópia, achada pelo id da cópia ou da
   * receita original (o comprador que abre a original recebe a cópia dele).
   * Sem compra paga ou em análise de reembolso, null.
   */
  async compraComCopia(receitaId: string, usuario?: UsuarioAutenticado) {
    if (!usuario) return null;
    return this.prismaService.receitaCompra.findFirst({
      where: {
        compradorId: usuario.id,
        status: { in: STATUS_COM_COPIA },
        receitaCopiaId: { not: null },
        OR: [{ receitaCopiaId: receitaId }, { oferta: { receitaId } }],
      },
      select: {
        id: true,
        receitaCopiaId: true,
        primeiroAcessoEm: true,
        oferta: {
          select: {
            receita: {
              select: { id: true, nome: true, criadoPor: true, status: true },
            },
          },
        },
      },
      orderBy: { pagaEm: 'desc' },
    });
  }

  /**
   * Abrir a cópia (detalhe ou ingredientes) grava `primeiroAcessoEm`, que
   * decide se o reembolso é automático (seção 4.7). Só a primeira abertura
   * conta: as seguintes não mexem na data.
   */
  async registrarAbertura(compraId: string, agora = new Date()) {
    await this.prismaService.receitaCompra.updateMany({
      where: { id: compraId, primeiroAcessoEm: null },
      data: { primeiroAcessoEm: agora },
    });
  }

  /** Das receitas dadas, as que o usuário comprou e cuja cópia ele tem. */
  async receitasCompradas(
    receitaIds: string[],
    usuario?: UsuarioAutenticado,
  ): Promise<Set<string>> {
    if (!usuario || receitaIds.length === 0) return new Set();
    const compras = await this.prismaService.receitaCompra.findMany({
      where: {
        compradorId: usuario.id,
        status: { in: STATUS_COM_COPIA },
        oferta: { receitaId: { in: receitaIds } },
      },
      select: { oferta: { select: { receitaId: true } } },
    });
    return new Set(compras.map((c) => c.oferta.receitaId));
  }

  /**
   * Para as listagens gratuitas (/all, /nome, /sugestoes, /validadas): receita
   * com oferta, ativa ou pausada, é paga e só aparece em /a-venda (D13), e a
   * cópia de uma compra não aparece em nenhuma. Vale para todos, inclusive
   * autor e equipe. O detalhe não usa este filtro.
   */
  semReceitasPagas(): Prisma.ReceitaWhereInput {
    return { ...semCopiasDeCompra, oferta: { is: null } };
  }

  /**
   * Receita à venda: as quatro condições da seção 4.1 das decisões do
   * marketplace. Oferta pausada ou vendedor sem Mercado Pago ativo saem da
   * vitrine, mas o conteúdo continua fechado (semReceitasPagas).
   */
  filtroAVenda(): Prisma.ReceitaWhereInput {
    return {
      status: StatusReceita.aprovada,
      deletedAt: null,
      adaptacaoDe: { is: null },
      ...semCopiasDeCompra,
      oferta: { is: { ativa: true } },
      criador: {
        contaRecebedor: { is: { status: StatusRecebedor.ativo } },
      },
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
   * - a cópia que ele comprou aparece mesmo que fira uma restrição (a
   *   curadoria de ingredientes pode mudar depois da compra), só com o aviso.
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
          ...semCopiasDeCompra,
          status: StatusReceita.aprovada,
          AND: [semAdaptacoesDeOutros(usuario.id)],
          ...segura,
        },
        {
          ...semCopiasDeCompra,
          criadoPor: usuario.id,
          adaptacaoDe: { is: null },
        },
        {
          ...semCopiasDeCompra,
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
                ...semCopiasDeCompra,
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
        copiaDoComprador(usuario.id),
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
