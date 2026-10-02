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
import { ReceitaIngredienteDTO } from './dtos/receita-ingrediente';
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
  semAdaptacoesDeOutros,
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

    const ingredientes = await this.validarIngredientes(data.ingredientes);
    const ingredientesNaoListados = await this.verificarIngredientesOcultos(
      data.modoPreparo,
      ingredientes.map((i) => i.nome),
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
  async verificarIngredientesOcultos(
    modoPreparo: string | null | undefined,
    nomesIngredientes: string[],
  ): Promise<string[]> {
    if (!modoPreparo?.trim()) {
      return [];
    }
    try {
      const resposta = await this.iaService.ingredientesNaoListados(
        modoPreparo,
        nomesIngredientes,
      );
      return interpretarIngredientesNaoListados(resposta);
    } catch (erro) {
      this.logger.error(
        `Falha ao conferir ingredientes do modo de preparo: ${erro}`,
      );
      return [];
    }
  }

  /**
   * Confere a lista de ingredientes antes de gravar: repetido ou inexistente
   * daria erro 500 no banco (chave e FK de receita_ingredientes). Devolve os
   * ingredientes, na ordem da lista, para a checagem do modo de preparo.
   */
  async validarIngredientes(itens: ReceitaIngredienteDTO[]) {
    const ids = itens.map((i) => i.ingredienteId);
    const repetidos = [
      ...new Set(ids.filter((id, i) => ids.indexOf(id) !== i)),
    ];
    if (repetidos.length > 0) {
      throw new BadRequestException(
        `Ingrediente repetido na receita: ${repetidos.join(', ')}`,
      );
    }

    const idsUnidades = [...new Set(itens.map((i) => i.unidadeMedidaId))];
    const [ingredientes, unidades] = await Promise.all([
      this.prismaService.ingrediente.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
      }),
      this.prismaService.unidadeMedida.findMany({
        where: { id: { in: idsUnidades }, ativo: true },
        select: { id: true },
      }),
    ]);

    const encontrados = new Map(ingredientes.map((i) => [i.id, i]));
    const faltando = ids.filter((id) => !encontrados.has(id));
    if (faltando.length > 0) {
      throw new BadRequestException(
        `Ingrediente não encontrado: ${faltando.join(', ')}`,
      );
    }
    const unidadesOk = new Set(unidades.map((u) => u.id));
    const unidadesFaltando = idsUnidades.filter((id) => !unidadesOk.has(id));
    if (unidadesFaltando.length > 0) {
      throw new BadRequestException(
        `Unidade de medida não encontrada ou inativa: ${unidadesFaltando.join(', ')}`,
      );
    }

    return ids.map((id) => encontrados.get(id)!);
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
      // Adaptação pendente = adaptação a verificar: o profissional vê de
      // qual receita veio, para qual restrição e o resumo da IA.
      include: {
        adaptacaoDe: {
          select: {
            resumoIa: true,
            trocas: true,
            restricao: { select: { id: true, nome: true } },
            receitaOrigem: { select: { id: true, nome: true } },
          },
        },
      },
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
        AND: [this.semPrivadasDeOutros(usuario)],
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
        AND: [this.semPrivadasDeOutros(usuario)],
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

    // Modo de preparo ou lista de ingredientes novos: confere de novo os
    // ingredientes citados. Fora da transação (a IA demora) e só depois de
    // checar o autor, para ninguém gastar chamada de IA numa receita que não
    // pode editar.
    const novosIngredientes = updateReceita.ingredientes;
    let ingredientesNaoListados: string[] | undefined;
    if (
      updateReceita.modoPreparo !== undefined ||
      novosIngredientes !== undefined
    ) {
      await this.garantirAutorOuAdmin(id, usuario);

      const nomes = novosIngredientes
        ? (await this.validarIngredientes(novosIngredientes)).map((i) => i.nome)
        : (
            await this.prismaService.receitaIngrediente.findMany({
              where: { receitaId: id },
              select: { ingrediente: { select: { nome: true } } },
            })
          ).map((i) => i.ingrediente.nome);

      const modoPreparo =
        updateReceita.modoPreparo !== undefined
          ? updateReceita.modoPreparo
          : (
              await this.prismaService.receita.findUnique({
                where: { id },
                select: { modoPreparo: true },
              })
            )?.modoPreparo;

      ingredientesNaoListados = await this.verificarIngredientesOcultos(
        modoPreparo,
        nomes,
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

      // A lista nova substitui a antiga. Como muda o que a receita contém,
      // a receita aprovada volta para curadoria (abaixo), como qualquer edição.
      if (novosIngredientes) {
        await tx.receitaIngrediente.deleteMany({ where: { receitaId: id } });
        await tx.receitaIngrediente.createMany({
          data: novosIngredientes.map((i) => ({
            receitaId: id,
            ingredienteId: i.ingredienteId,
            quantidade: i.quantidade,
            unidadeMedidaId: i.unidadeMedidaId,
          })),
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

      // Adaptação verificada: as substituições que a IA fez viram
      // substitutos curados. Na próxima adaptação do mesmo ingrediente para
      // a mesma restrição, a IA recebe estes como preferidos.
      const adaptacao = await tx.receitaAdaptacao.findUnique({
        where: { receitaAdaptadaId: id },
        select: { restricaoId: true, trocas: true },
      });
      const restricaoAdaptada = adaptacao?.restricaoId;
      if (adaptacao && restricaoAdaptada) {
        const substituicoes = (
          adaptacao.trocas as unknown as {
            ingredienteOrigemId: string;
            acao: string;
            ingredienteDestinoId?: string;
          }[]
        ).filter((t) => t.acao === 'substituir' && t.ingredienteDestinoId);
        await tx.ingredienteSubstituto.createMany({
          data: substituicoes.map((t) => ({
            ingredienteOrigemId: t.ingredienteOrigemId,
            ingredienteDestinoId: t.ingredienteDestinoId!,
            restricaoId: restricaoAdaptada,
            observacao: `Aprovado na adaptação da receita "${receita.nome}"`,
          })),
          skipDuplicates: true,
        });
      }

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

      // A ligação de adaptação sai; a outra receita (origem ou adaptada)
      // continua existindo por conta própria.
      await tx.receitaAdaptacao.deleteMany({
        where: { OR: [{ receitaOrigemId: id }, { receitaAdaptadaId: id }] },
      });
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

  private ehEquipe(usuario?: UsuarioAutenticado) {
    return (
      usuario?.tipoUsuario === TipoUsuario.admin ||
      usuario?.tipoUsuario === TipoUsuario.profissional
    );
  }

  /** Para as listas só de aprovadas: esconde adaptações de outros pacientes. */
  private semPrivadasDeOutros(
    usuario?: UsuarioAutenticado,
  ): Prisma.ReceitaWhereInput {
    return this.ehEquipe(usuario) ? {} : semAdaptacoesDeOutros(usuario?.id);
  }

  /**
   * filtroBase mais as restrições do paciente:
   * - a receita aprovada que fere uma restrição estrita (alergia ou grave)
   *   some; o autor continua vendo as próprias;
   * - a adaptação ainda não verificada aparece para quem tem a restrição
   *   dela como leve/moderada, e para quem pediu, exceto se a restrição for
   *   estrita para ele: aí só depois da verificação.
   * Regras em regra_negocio_receitas_seguras.md.
   */
  private filtroVisibilidade(
    usuario: UsuarioAutenticado | undefined,
    restricoes: RestricaoDoPaciente[],
  ): Prisma.ReceitaWhereInput {
    if (
      !usuario ||
      usuario.tipoUsuario === TipoUsuario.admin ||
      usuario.tipoUsuario === TipoUsuario.profissional
    ) {
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
