import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import {
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
import { IaService } from '../../ia/ia.service';
import { interpretarIngredientesNaoListados } from './ingredientes-ocultos';
import {
  RestricaoDoPaciente,
  clausulaSegura,
  restricaoPorId,
  restricoesDoPaciente,
  restricoesDoUsuario,
  restricoesVioladas,
} from './restricoes-receita';

@Injectable()
export class ReceitaService {
  private readonly logger = new Logger(ReceitaService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly usuario: UsuarioService,
    private readonly cacheService: CacheService,
    private readonly pontosTransacaoService: PontosTransacaoService,
    private readonly iaService: IaService,
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

    const ingredientesNaoListados = await this.verificarIngredientesOcultos(
      data.modoPreparo,
      data.ingredientes.map((i) => i.ingredienteId),
    );

    const receita = await this.prismaService.receita.create({
      data: {
        nome: data.nome,
        descricao: data.descricao,
        modoPreparo: data.modoPreparo,
        ingredientesNaoListados,
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
    return {
      success: 'Receita criada com sucesso.',
      ...this.avisoIngredientesOcultos(ingredientesNaoListados),
      data: receita,
    };
  }

  /**
   * Pergunta à IA quais ingredientes o modo de preparo cita e a lista não
   * tem. Falha da IA não impede salvar a receita: volta lista vazia e fica
   * no log.
   */
  private async verificarIngredientesOcultos(
    modoPreparo: string | null | undefined,
    ingredienteIds: string[],
  ): Promise<string[]> {
    if (!modoPreparo?.trim()) {
      return [];
    }
    try {
      const ingredientes = await this.prismaService.ingrediente.findMany({
        where: { id: { in: ingredienteIds } },
        select: { nome: true },
      });
      const resposta = await this.iaService.ingredientesNaoListados(
        modoPreparo,
        ingredientes.map((i) => i.nome),
      );
      return interpretarIngredientesNaoListados(resposta);
    } catch (erro) {
      this.logger.error(
        `Falha ao conferir ingredientes do modo de preparo: ${erro}`,
      );
      return [];
    }
  }

  private avisoIngredientesOcultos(ingredientesNaoListados: string[]) {
    if (ingredientesNaoListados.length === 0) {
      return {};
    }
    return {
      aviso:
        `O modo de preparo cita ingredientes que não estão na lista: ` +
        `${ingredientesNaoListados.join(', ')}. Inclua-os na receita: ` +
        `enquanto isso, ela não aparece para quem tem alergia ou restrição grave.`,
    };
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

  async findAll(usuario?: UsuarioAutenticado, seguraPara?: string) {
    // Só a lista pública (visitante sem login, sem filtro) vai para o cache:
    // a de quem está logado depende do usuário.
    const cacheKey = 'receitas:all';
    const usaCache = !usuario && !seguraPara;

    if (usaCache) {
      const cachedReceitas = await this.cacheService.get<Receita[]>(cacheKey);

      if (cachedReceitas) {
        return cachedReceitas;
      }
    }

    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receitas = await this.prismaService.receita.findMany({
      where: {
        deletedAt: null,
        AND: [
          this.filtroVisibilidade(usuario, restricoes),
          await this.filtroSeguraPara(seguraPara),
        ],
      },
    });

    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }

    if (usaCache) {
      await this.cacheService.set(cacheKey, receitas, 300_000);
    }

    return this.comRestricoesVioladas(receitas, restricoes);
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

    // Favorito não some por causa de restrição nova: só ganha o aviso.
    return this.comRestricoesVioladas(
      favoritos.map(({ receita }) => receita),
      await restricoesDoPaciente(this.prismaService, { usuarioId }),
    );
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
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receita = await this.prismaService.receita.findFirst({
      where: { id, ...this.filtroVisibilidade(usuario, restricoes) },
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
      return this.naoEncontrada(id, usuario, restricoes);
    }
    const [anotada] = await this.comRestricoesVioladas([receita], restricoes);
    return anotada;
  }

  async findByName(
    nome: string,
    usuario?: UsuarioAutenticado,
    seguraPara?: string,
  ) {
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receita = await this.prismaService.receita.findMany({
      where: {
        nome: { contains: nome, mode: 'insensitive' },
        deletedAt: null,
        AND: [
          this.filtroVisibilidade(usuario, restricoes),
          await this.filtroSeguraPara(seguraPara),
        ],
      },
    });
    if (!receita || receita.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada com esse nome');
    }
    return this.comRestricoesVioladas(receita, restricoes);
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
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receitas = await this.prismaService.receita.findMany({
      where: {
        status: 'aprovada',
        deletedAt: null,
        OR: [{ nivelDificuldade: 'facil' }, { nivelDificuldade: 'medio' }],
        ...clausulaSegura(restricoes.filter((r) => r.estrita)),
      },
    });
    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }

    return this.comRestricoesVioladas(receitas, restricoes);
  }

  async findValidated(usuario?: UsuarioAutenticado) {
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receitas = await this.prismaService.receita.findMany({
      where: {
        status: 'aprovada',
        deletedAt: null,
        ...clausulaSegura(restricoes.filter((r) => r.estrita)),
      },
    });
    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }
    return this.comRestricoesVioladas(receitas, restricoes);
  }

  async findFeedbacks(_id: string) {} // TODO: Implementar o método de encontrar feedbacks para uma receita

  async update(
    id: string,
    updateReceita: UpdateReceitaDto,
    usuario: UsuarioAutenticado,
  ) {
    const cacheKey = 'receitas:all';

    // Modo de preparo novo: confere de novo os ingredientes citados. Fora da
    // transação (a IA demora) e só depois de checar o autor, para ninguém
    // gastar chamada de IA numa receita que não pode editar.
    let ingredientesNaoListados: string[] | undefined;
    if (updateReceita.modoPreparo !== undefined) {
      await this.garantirAutorOuAdmin(id, usuario);
      const itens = await this.prismaService.receitaIngrediente.findMany({
        where: { receitaId: id },
        select: { ingredienteId: true },
      });
      ingredientesNaoListados = await this.verificarIngredientesOcultos(
        updateReceita.modoPreparo,
        itens.map((i) => i.ingredienteId),
      );
    }

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
          ingredientesNaoListados,
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

      return {
        success: 'Receita atualizada com sucesso.',
        ...this.avisoIngredientesOcultos(ingredientesNaoListados ?? []),
        data: receita,
      };
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
   * Quem vê quais receitas, sem olhar restrição: visitante só as aprovadas;
   * usuário logado as aprovadas e as próprias; admin e profissional
   * (curadoria) todas.
   */
  private filtroBase(usuario?: UsuarioAutenticado): Prisma.ReceitaWhereInput {
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
      OR: [{ status: StatusReceita.aprovada }, { criadoPor: usuario.id }],
    };
  }

  /**
   * filtroBase mais as restrições estritas (alergia ou grave) do paciente:
   * a receita aprovada que fere alguma delas some. O autor continua vendo as
   * próprias. Regras em regra_negocio_receitas_seguras.md.
   */
  private filtroVisibilidade(
    usuario: UsuarioAutenticado | undefined,
    restricoes: RestricaoDoPaciente[],
  ): Prisma.ReceitaWhereInput {
    const estritas = restricoes.filter((r) => r.estrita);
    if (!usuario || estritas.length === 0) {
      return this.filtroBase(usuario);
    }
    return {
      OR: [
        { status: StatusReceita.aprovada, ...clausulaSegura(estritas) },
        { criadoPor: usuario.id },
      ],
    };
  }

  /** `?seguraPara=<restricaoId>`: só receitas seguras para essa restrição. */
  private async filtroSeguraPara(
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
  private async comRestricoesVioladas<T extends { id: string }>(
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
  private async naoEncontrada(
    id: string,
    usuario: UsuarioAutenticado | undefined,
    restricoes: RestricaoDoPaciente[],
  ): Promise<never> {
    const estritas = restricoes.filter((r) => r.estrita);
    if (estritas.length > 0) {
      const existe = await this.prismaService.receita.findFirst({
        where: { id, ...this.filtroBase(usuario) },
        select: { id: true, ingredientesNaoListados: true },
      });
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

  private async garantirVisivel(id: string, usuario?: UsuarioAutenticado) {
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const receita = await this.prismaService.receita.findFirst({
      where: { id, ...this.filtroVisibilidade(usuario, restricoes) },
      select: { id: true },
    });
    if (!receita) {
      await this.naoEncontrada(id, usuario, restricoes);
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
