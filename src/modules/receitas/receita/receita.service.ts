import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import {
  Gravidade,
  Prisma,
  Receita,
  StatusAprovacao,
  StatusReceita,
  TipoMidia,
  TipoRestricao,
  TipoTransacaoPontos,
  TipoUsuario,
} from '@prisma/client';
import { ReceitaDto } from './dtos/receita';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UpdateReceitaDto } from './dtos/update-receita';
import { CacheService } from '../../../common/cache/cache.service';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { PontosTransacaoService } from '../pontos-transacao/pontos-transacao.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { CAMPO_INGREDIENTE } from '../../nutricao/ingrediente-restricao/regra-nutricional.service';

@Injectable()
export class ReceitaService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usuario: UsuarioService,
    private readonly cacheService: CacheService,
    private readonly pontosTransacaoService: PontosTransacaoService,
  ) {}

  private async alreadyExists(id: string) {
    const receita = await this.prismaService.receita.findUnique({
      where: { id },
    });
    return !!receita && !receita.deletedAt;
  }

  async create(data: ReceitaDto, userId: string) {
    await this.cacheService.del('receitas:all');

    const userExists = await this.usuario.userExists(userId);

    if (!userExists) {
      throw new BadRequestException('Usuário não encontrado');
    }

    if (!data.ingredientes || data.ingredientes.length === 0) {
      throw new BadRequestException(
        'A receita deve ter pelo menos um ingrediente',
      );
    }
    const receita = await this.prismaService.receita.create({
      data: {
        nome: data.nome,
        descricao: data.descricao,
        modoPreparo: data.modoPreparo,
        tempoPreparoMin: data.tempoPreparoMin,
        porcoes: data.porcoes,
        nivelDificuldade: data.nivelDificuldade,
        avisoContaminacaoCruzada: data.avisoContaminacaoCruzada,
        criadoPor: userId,

        ingredientes: {
          create: data.ingredientes.map((ingrediente) => ({
            ingredienteId: ingrediente.ingredienteId,
            quantidade: ingrediente.quantidade,
            unidadeMedidaId: ingrediente.unidadeMedidaId,
          })),
        },
      },
      include: {
        ingredientes: {
          include: {
            ingrediente: true,
            unidadeMedida: true,
          },
        },
      },
    });
    return { success: 'Receita criada com sucesso.', data: receita };
  }

  async uploadMedia(
    id: string,
    file: Express.Multer.File,
    tipo: TipoMidia,
    ordem: number,
    usuario: UsuarioAutenticado,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'video/mp4'];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      await unlink(file.path).catch(() => undefined);

      throw new BadRequestException('invalid file type');
    }

    const maxSize = 5 * 1024 * 1024;

    if (file.size > maxSize) {
      await unlink(file.path).catch(() => undefined);

      throw new BadRequestException('file is too large!');
    }

    try {
      await this.garantirAutorOuAdmin(id, usuario);
    } catch (error) {
      await unlink(file.path).catch(() => undefined);

      throw error;
    }

    let folder: string;

    if (file.fieldname === 'image') {
      folder = 'images';
    } else if (file.fieldname === 'video') {
      folder = 'videos';
    } else {
      await unlink(file.path).catch(() => undefined);

      throw new BadRequestException('Invalid file field');
    }

    try {
      const midia = await this.prismaService.receitaMidia.create({
        data: {
          receitaId: id,
          url: `/uploads/receitas/${folder}/${file.filename}`,
          tipo,
          ordem,
        },
      });

      return {
        success: 'Mídia enviada com sucesso.',
        data: midia,
      };
    } catch (error) {
      await unlink(file.path).catch(() => undefined);

      throw error;
    }
  }

  async findAll(usuario?: UsuarioAutenticado) {
    // Só a lista pública (visitante sem login) vai para o cache: a de quem
    // está logado depende do usuário.
    const cacheKey = 'receitas:all';

    if (!usuario) {
      const cachedReceitas = await this.cacheService.get<Receita[]>(cacheKey);

      if (cachedReceitas) {
        return cachedReceitas;
      }
    }

    const receitas = await this.prismaService.receita.findMany({
      where: { deletedAt: null, ...(await this.filtroVisibilidade(usuario)) },
    });

    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }

    if (!usuario) {
      await this.cacheService.set(cacheKey, receitas, 300_000);
    }

    return receitas;
  }

  async findPendentes() {
    return this.prismaService.receita.findMany({
      where: { status: StatusReceita.pendente, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findFavorites(usuarioId: string) {
    const favoritos = await this.prismaService.favorito.findMany({
      where: { usuarioId },
      include: {
        receita: {
          include: {
            ingredientes: {
              include: {
                ingrediente: true,
                unidadeMedida: true,
              },
            },
            midias: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!favoritos || favoritos.length === 0) {
      throw new NotFoundException('Nenhuma receita favorita encontrada');
    }

    return favoritos.map(({ receita }) => receita);
  }

  async addFavorite(receitaId: string, usuarioId: string) {
    const receitaExists = await this.alreadyExists(receitaId);
    if (!receitaExists) {
      throw new NotFoundException('Receita não encontrada');
    }

    const favoritoExists = await this.prismaService.favorito.findUnique({
      where: {
        usuarioId_receitaId: { usuarioId, receitaId },
      },
    });

    if (favoritoExists) {
      throw new ConflictException('A receita já foi favoritada');
    }

    const favorito = await this.prismaService.favorito.create({
      data: { usuarioId, receitaId },
    });

    return { success: 'Receita favoritada com sucesso.', data: favorito };
  }

  async removeFavorite(receitaId: string, usuarioId: string) {
    const favorito = await this.prismaService.favorito.findUnique({
      where: {
        usuarioId_receitaId: { usuarioId, receitaId },
      },
    });

    if (!favorito) {
      throw new NotFoundException('Receita não está nos favoritos');
    }

    await this.prismaService.favorito.delete({
      where: {
        usuarioId_receitaId: { usuarioId, receitaId },
      },
    });

    return { success: 'Receita removida dos favoritos com sucesso.' };
  }

  async findOne(id: string, usuario?: UsuarioAutenticado) {
    const receita = await this.prismaService.receita.findFirst({
      where: { id, ...(await this.filtroVisibilidade(usuario)) },
      include: {
        ingredientes: {
          include: {
            ingrediente: true,
            unidadeMedida: true,
          },
        },
        midias: true,
      },
    });
    if (!receita) {
      throw new NotFoundException('Receita não encontrada');
    }
    return receita;
  }

  async findByName(nome: string, usuario?: UsuarioAutenticado) {
    const receita = await this.prismaService.receita.findMany({
      where: {
        nome: { contains: nome, mode: 'insensitive' },
        deletedAt: null,
        ...(await this.filtroVisibilidade(usuario)),
      },
    });
    if (!receita || receita.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada com esse nome');
    }
    return receita;
  }

  async findIngredients(id: string, usuario?: UsuarioAutenticado) {
    await this.garantirVisivel(id, usuario);

    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      include: { ingredientes: true },
    });
    return receita!.ingredientes;
  }

  /**
   * Alertas de restrição alimentar da receita: cada restrição vinculada a
   * algum ingrediente dela, com os ingredientes que a disparam, e os
   * ingredientes que ninguém revisou ainda (a falta de vínculo neles não
   * garante nada).
   */
  async findAlerts(id: string, usuario?: UsuarioAutenticado) {
    await this.garantirVisivel(id, usuario);

    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      select: {
        avisoContaminacaoCruzada: true,
        ingredientes: {
          select: {
            ingrediente: {
              select: {
                id: true,
                nome: true,
                restricoesRevisadasEm: true,
                restricoes: {
                  select: {
                    restricao: { select: { id: true, nome: true, tipo: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const porRestricao = new Map<
      string,
      {
        id: string;
        nome: string;
        tipo: TipoRestricao;
        ingredientes: { id: string; nome: string }[];
      }
    >();
    const ingredientesNaoRevisados: { id: string; nome: string }[] = [];
    for (const { ingrediente } of receita!.ingredientes) {
      if (!ingrediente.restricoesRevisadasEm) {
        ingredientesNaoRevisados.push({
          id: ingrediente.id,
          nome: ingrediente.nome,
        });
      }
      for (const { restricao } of ingrediente.restricoes) {
        const alerta = porRestricao.get(restricao.id) ?? {
          ...restricao,
          ingredientes: [],
        };
        alerta.ingredientes.push({
          id: ingrediente.id,
          nome: ingrediente.nome,
        });
        porRestricao.set(restricao.id, alerta);
      }
    }

    return {
      avisoContaminacaoCruzada: receita!.avisoContaminacaoCruzada,
      restricoes: [...porRestricao.values()],
      ingredientesNaoRevisados,
    };
  }

  async findSuggestions(usuario?: UsuarioAutenticado) {
    const receitas = await this.prismaService.receita.findMany({
      where: {
        status: 'aprovada',
        deletedAt: null,
        OR: [{ nivelDificuldade: 'facil' }, { nivelDificuldade: 'medio' }],
        ...(await this.filtroRestricoes(usuario)),
      },
    });
    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }

    return receitas;
  }

  async findValidated(usuario?: UsuarioAutenticado) {
    const receitas = await this.prismaService.receita.findMany({
      where: {
        status: 'aprovada',
        deletedAt: null,
        ...(await this.filtroRestricoes(usuario)),
      },
    });
    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }
    return receitas;
  }

  async findFeedbacks(_id: string) {} // TODO: Implementar o método de encontrar feedbacks para uma receita

  async update(
    id: string,
    updateReceita: UpdateReceitaDto,
    usuario: UsuarioAutenticado,
  ) {
    const cacheKey = 'receitas:all';
    return this.prismaService.$transaction(async (tx) => {
      const receitaAtual = await tx.receita.findUnique({ where: { id } });

      if (!receitaAtual || receitaAtual.deletedAt) {
        throw new NotFoundException('Receita não encontrada');
      }

      this.verificarAutorOuAdmin(receitaAtual.criadoPor, usuario);

      await this.cacheService.del(cacheKey);

      if (receitaAtual.status === 'aprovada') {
        await tx.receitaVersao.create({
          data: {
            receitaId: receitaAtual.id,
            versao: receitaAtual.versaoAtual,
            nome: receitaAtual.nome,
            descricao: receitaAtual.descricao,
            modoPreparo: receitaAtual.modoPreparo,
            alteradoPor: usuario.id,
          },
        });
      }

      const receita = await tx.receita.update({
        where: { id },
        data: {
          nome: updateReceita.nome,
          descricao: updateReceita.descricao,
          modoPreparo: updateReceita.modoPreparo,
          tempoPreparoMin: updateReceita.tempoPreparoMin,
          porcoes: updateReceita.porcoes,
          nivelDificuldade: updateReceita.nivelDificuldade,
          avisoContaminacaoCruzada: updateReceita.avisoContaminacaoCruzada,
          // Conteúdo aprovado que muda precisa de nova curadoria.
          ...(receitaAtual.status === 'aprovada'
            ? {
                versaoAtual: { increment: 1 },
                status: StatusReceita.pendente,
                profissionalAprovadorId: null,
                dataAprovacao: null,
              }
            : {}),
        },
      });

      return { success: 'Receita atualizada com sucesso.', data: receita };
    });
  }

  async aprovarReceita(id: string, usuarioId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { usuarioId },
    });

    if (!profissional) {
      throw new NotFoundException(
        'Você ainda não possui cadastro profissional',
      );
    }

    if (profissional.statusAprovacao !== StatusAprovacao.aprovado) {
      throw new UnauthorizedException(
        'Apenas profissionais aprovados podem realizar esta ação',
      );
    }

    const resultado = await this.prismaService.$transaction(async (tx) => {
      const receita = await tx.receita.findUnique({ where: { id } });

      if (!receita || receita.deletedAt) {
        throw new NotFoundException('Receita não encontrada');
      }

      if (receita.criadoPor === usuarioId) {
        throw new ForbiddenException(
          'Não é possível aprovar a própria receita',
        );
      }

      if (receita.status === 'aprovada') {
        throw new ConflictException('A receita já foi aprovada');
      }

      const receitaAprovada = await tx.receita.update({
        where: { id },
        data: {
          status: 'aprovada',
          profissionalAprovadorId: profissional.id,
          dataAprovacao: new Date(),
        },
      });

      await this.pontosTransacaoService.createPontoTransacao(
        profissional.id,
        TipoTransacaoPontos.ganho_aprovacao,
        10,
        `Aprovação da receita: ${receita.nome}`,
        tx,
      );

      return {
        success: 'Receita aprovada com sucesso.',
        data: receitaAprovada,
      };
    });

    // O status mudou: a lista pública em cache ficou desatualizada.
    await this.cacheService.del('receitas:all');
    return resultado;
  }

  async rejeitarReceita(id: string, usuarioId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { usuarioId },
    });

    if (!profissional) {
      throw new NotFoundException(
        'Você ainda não possui cadastro profissional',
      );
    }

    const resultado = await this.prismaService.$transaction(async (tx) => {
      const receita = await tx.receita.findUnique({ where: { id } });

      if (!receita || receita.deletedAt) {
        throw new NotFoundException('Receita não encontrada');
      }

      if (receita.criadoPor === usuarioId) {
        throw new ForbiddenException(
          'Não é possível rejeitar a própria receita',
        );
      }

      if (receita.status === 'rejeitada') {
        throw new ConflictException('A receita já foi rejeitada');
      }

      const receitaRejeitada = await tx.receita.update({
        where: { id },
        data: {
          status: 'rejeitada',
        },
      });

      await this.pontosTransacaoService.createPontoTransacao(
        profissional.id,
        TipoTransacaoPontos.ganho_rejeicao,
        5,
        `Rejeição da receita: ${receita.nome}`,
        tx,
      );

      return {
        success: 'Receita rejeitada com sucesso.',
        data: receitaRejeitada,
      };
    });

    // O status mudou: a lista pública em cache ficou desatualizada.
    await this.cacheService.del('receitas:all');
    return resultado;
  }

  /**
   * Receita usada em algum plano alimentar é só marcada como excluída
   * (deletedAt): some das listagens, mas o plano do paciente continua
   * mostrando. Fora de planos, é apagada de vez. Favoritos saem nos dois casos.
   */
  async remove(id: string, usuario: UsuarioAutenticado) {
    await this.garantirAutorOuAdmin(id, usuario);

    const usadaEmPlano = await this.prismaService.planoAlimentarItem.count({
      where: { receitaId: id },
    });

    await this.prismaService.$transaction(async (tx) => {
      await tx.favorito.deleteMany({ where: { receitaId: id } });

      if (usadaEmPlano > 0) {
        await tx.receita.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        return;
      }

      await tx.receitaVersao.deleteMany({ where: { receitaId: id } });
      await tx.receitaMidia.deleteMany({ where: { receitaId: id } });
      await tx.receitaIngrediente.deleteMany({ where: { receitaId: id } });
      await tx.receita.delete({ where: { id } });
    });

    await this.cacheService.del('receitas:all');
    return { success: 'Receita removida com sucesso.' };
  }

  /**
   * Quem vê quais receitas: visitante só as aprovadas; usuário logado as
   * aprovadas (que não firam suas restrições estritas) e as próprias; admin e
   * profissional (curadoria) todas.
   */
  private async filtroVisibilidade(
    usuario?: UsuarioAutenticado,
  ): Promise<Prisma.ReceitaWhereInput> {
    if (!usuario) {
      return { status: StatusReceita.aprovada };
    }
    if (
      usuario.tipoUsuario === TipoUsuario.admin ||
      usuario.tipoUsuario === TipoUsuario.profissional
    ) {
      return {};
    }
    return {
      OR: [
        {
          status: StatusReceita.aprovada,
          ...(await this.filtroRestricoes(usuario)),
        },
        { criadoPor: usuario.id },
      ],
    };
  }

  /**
   * Esconde do paciente as receitas que ferem uma restrição estrita dele
   * (alergia ou gravidade grave). Ingrediente sem vínculo só conta como
   * seguro se já teve as restrições revisadas por um curador: um ingrediente
   * recém-criado também nasce sem vínculo.
   *
   * Se a restrição tem regra nutricional (ex: sódio > 600 para hipertensão),
   * o ingrediente também precisa ter o dado daquele campo: sem o dado, a
   * regra não consegue vincular, e a falta de vínculo não prova nada.
   */
  private async filtroRestricoes(
    usuario?: UsuarioAutenticado,
  ): Promise<Prisma.ReceitaWhereInput> {
    if (usuario?.tipoUsuario !== TipoUsuario.paciente) {
      return {};
    }

    const estritas = await this.prismaService.pacienteRestricao.findMany({
      where: {
        paciente: { usuarioId: usuario.id },
        OR: [
          { gravidade: Gravidade.grave },
          { restricao: { tipo: TipoRestricao.alergia } },
        ],
      },
      select: {
        restricaoId: true,
        restricao: {
          select: {
            regrasNutricionais: {
              where: { valorLimite: { not: null } },
              select: { campoNutricional: true },
            },
          },
        },
      },
    });

    if (estritas.length === 0) {
      return {};
    }

    const camposDasRegras = new Set(
      estritas.flatMap((r) =>
        r.restricao.regrasNutricionais.map(
          (regra) => CAMPO_INGREDIENTE[regra.campoNutricional],
        ),
      ),
    );

    return {
      ingredientes: {
        every: {
          ingrediente: {
            restricoesRevisadasEm: { not: null },
            ...Object.fromEntries(
              [...camposDasRegras].map((campo) => [campo, { not: null }]),
            ),
            restricoes: {
              none: {
                restricaoId: { in: estritas.map((r) => r.restricaoId) },
              },
            },
          },
        },
      },
    };
  }

  private async garantirVisivel(id: string, usuario?: UsuarioAutenticado) {
    const receita = await this.prismaService.receita.findFirst({
      where: { id, ...(await this.filtroVisibilidade(usuario)) },
      select: { id: true },
    });
    if (!receita) {
      throw new NotFoundException('Receita não encontrada');
    }
  }

  private verificarAutorOuAdmin(
    criadoPor: string,
    usuario: UsuarioAutenticado,
  ) {
    if (usuario.tipoUsuario !== TipoUsuario.admin && criadoPor !== usuario.id) {
      throw new ForbiddenException(
        'Apenas o autor da receita ou um admin pode realizar esta ação',
      );
    }
  }

  private async garantirAutorOuAdmin(id: string, usuario: UsuarioAutenticado) {
    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      select: { criadoPor: true, deletedAt: true },
    });
    if (!receita || receita.deletedAt) {
      throw new NotFoundException('Receita não encontrada');
    }
    this.verificarAutorOuAdmin(receita.criadoPor, usuario);
  }
}
