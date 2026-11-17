import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  CategoryInput,
  parse,
  ProductCreate,
  ProductQuery,
  ProductUpdate,
  Uuid,
} from './catalog.schemas';
import { CatalogService } from './catalog.service';

// shortcut: writes are owner-only until U4 roles land; then gate on the catalog permission instead.
function ownerOnly(session: PosSession) {
  if (session.kind !== 'owner') throw new ForbiddenException();
}

// A malformed id can never name a row of this store: 404, same as another store's id.
const idOf = (raw: string) => {
  const r = Uuid.safeParse(raw);
  return r.success ? r.data : '00000000-0000-0000-0000-000000000000';
};

@Controller('catalog/categories')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.catalog.listCategories(s.tenantId) };
  }

  @Post()
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    ownerOnly(s);
    return this.catalog.createCategory(
      s.tenantId,
      parse(CategoryInput, body).name,
    );
  }

  @Patch(':id')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    ownerOnly(s);
    return this.catalog.updateCategory(
      s.tenantId,
      idOf(id),
      parse(CategoryInput, body).name,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    ownerOnly(s);
    await this.catalog.deleteCategory(s.tenantId, idOf(id));
  }
}

@Controller('catalog/products')
export class ProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.catalog.listProducts(s.tenantId, parse(ProductQuery, query));
  }

  @Post()
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    ownerOnly(s);
    return this.catalog.createProduct(s.tenantId, parse(ProductCreate, body));
  }

  @Get(':id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.catalog.getProduct(s.tenantId, idOf(id));
  }

  @Patch(':id')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    ownerOnly(s);
    return this.catalog.updateProduct(
      s.tenantId,
      idOf(id),
      parse(ProductUpdate, body),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    ownerOnly(s);
    await this.catalog.deleteProduct(s.tenantId, idOf(id));
  }

  @Post(':id/images')
  // Multer stops at 2 MB + 1 byte; the service refuses anything over 2 MB with 422.
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 + 1, files: 1 },
    }),
  )
  addImage(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    ownerOnly(s);
    return this.catalog.addImage(s.tenantId, idOf(id), file);
  }

  @Get(':id/images/:imageId')
  async getImage(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Res() res: Response,
  ) {
    const image = await this.catalog.getImage(
      s.tenantId,
      idOf(id),
      idOf(imageId),
    );
    res
      .set({
        'Content-Type': image.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
      })
      .send(image.body);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(204)
  async removeImage(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    ownerOnly(s);
    await this.catalog.deleteImage(s.tenantId, idOf(id), idOf(imageId));
  }
}
