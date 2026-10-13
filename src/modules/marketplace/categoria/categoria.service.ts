import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateCategoria, UpdateCategoria } from './dtos/categoria';

@Injectable()
export class CategoriaService {
    constructor(
        private readonly prismaService: PrismaService,
    ){}

  async create(createCategoriaDto: CreateCategoria) {
    const categoria = await this.prismaService.categoriaProduto.create({
      data: {
        codigo: createCategoriaDto.codigo,
        nome: createCategoriaDto.nome,
        ativo: true,
      },
    }).catch(this.codigoDuplicado);
    return {
      success: 'Categoria criada com sucesso.',
      data: categoria,
    };
  }

  async findAllAtivos(){
    const categorias = await this.prismaService.categoriaProduto.findMany({
        where: {
            ativo: true,
        }
    });
    return categorias;
  }

  async findAllDesativados(){
    const categorias = await this.prismaService.categoriaProduto.findMany({
        where: {
            ativo: false,
        }
    });
    return categorias;
  }

  async findOne(categoriaId: string){
    const categoria = await this.prismaService.categoriaProduto.findUnique({
      where: {
        id: categoriaId,
      },
    });

    if(!categoria || !categoria.ativo){
      throw new NotFoundException('Categoria não encontrada');
    }

    return categoria;
  }

  async remove(categoriaId: string){
    const categoria = await this.prismaService.categoriaProduto.findUnique({
      where: {
        id: categoriaId,
      },
    });

    if(!categoria){
      throw new NotFoundException('Categoria não encontrada');
    }

    if(!categoria.ativo){
      throw new ConflictException('Categoria inativa');
    }

    await this.prismaService.categoriaProduto.update({
      where: {
        id: categoriaId,
      },
      data: {
        ativo: false,
      },
    });
  }

  async restaurar(categoriaId: string){
    const categoria = await this.prismaService.categoriaProduto.findUnique({
      where: {
        id: categoriaId,
      },
    });

    if(!categoria){
      throw new NotFoundException('Categoria não encontrada');
    }

    if(categoria.ativo){
      throw new ConflictException('Categoria já está ativa');
    }

    const categoriaRestaurada = await this.prismaService.categoriaProduto.update({
      where: {
        id: categoriaId,
      },
      data: {
        ativo: true,
      },
    });

    return categoriaRestaurada;
  }

  async update(categoriaId: string, updateCategoriaDto: UpdateCategoria){
    const categoria = await this.prismaService.categoriaProduto.findUnique({
      where: {
        id: categoriaId,
      },
    });

    if(!categoria){
      throw new NotFoundException('Categoria não encontrada');
    }

    if(!categoria.ativo){
      throw new ConflictException('Categoria inativa');
    }

    const categoriaAtualizada = await this.prismaService.categoriaProduto.update({
      where: {
        id: categoriaId,
      },
      data: {
        nome: updateCategoriaDto.nome,
        codigo: updateCategoriaDto.codigo,
      },
    }).catch(this.codigoDuplicado);

    return categoriaAtualizada;
  }

  private codigoDuplicado(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Já existe uma categoria com esse código');
    }
    throw error;
  }
}
