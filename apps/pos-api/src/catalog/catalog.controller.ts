import {
  Body,
  Controller,
  Delete,
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
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import { hasPermission, RequirePermission } from '../staff/require-permission';
import type { PosSession } from '../tenancy/session';
import {
  AgentProductCreate,
  CategoryInput,
  parse,
  ProductCreate,
  ProductQuery,
  ProductUpdate,
  Uuid,
} from './catalog.schemas';
import { CatalogService } from './catalog.service';

// A malformed id can never name a row of this store: 404, same as another store's id.
const idOf = (raw: string) => {
  const r = Uuid.safeParse(raw);
  return r.success ? r.data : '00000000-0000-0000-0000-000000000000';
};

@Controller('catalog/categories')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @AgentRoute()
  @Get()
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.catalog.listCategories(s.tenantId) };
  }

  @AgentRoute()
  @Post()
  @RequirePermission('catalog.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.catalog.createCategory(
      s.tenantId,
      parse(CategoryInput, body).name,
    );
  }

  @Patch(':id')
  @RequirePermission('catalog.manage')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.updateCategory(
      s.tenantId,
      idOf(id),
      parse(CategoryInput, body).name,
    );
  }

  @Delete(':id')
  @RequirePermission('catalog.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.catalog.deleteCategory(s.tenantId, idOf(id));
  }
}

/** Cost price is margin data: only actors who manage the catalog, read reports or buy stock see it. */
function withoutCost<T extends Record<string, unknown>>(s: PosSession, p: T) {
  const sees = (
    ['catalog.manage', 'reports.view', 'purchasing.manage'] as const
  ).some((k) => hasPermission(s, k));
  if (sees) return p;
  const rest: Record<string, unknown> = { ...p };
  delete rest.costPrice;
  return rest;
}

@Controller('catalog/products')
export class ProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @AgentRoute()
  @Get()
  async list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    const page = await this.catalog.listProducts(
      s.tenantId,
      parse(ProductQuery, query),
    );
    return { ...page, data: page.data.map((p) => withoutCost(s, p)) };
  }

  @AgentRoute()
  @Post()
  @RequirePermission('catalog.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    // UMKMall's agent creates with one base price only (AgentProductCreate); it never edits a product afterwards.
    return this.catalog.createProduct(
      s.tenantId,
      s.kind === 'agent'
        ? parse(AgentProductCreate, body)
        : parse(ProductCreate, body),
    );
  }

  @AgentRoute()
  @Get(':id')
  async get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return withoutCost(s, await this.catalog.getProduct(s.tenantId, idOf(id)));
  }

  @Patch(':id')
  @RequirePermission('catalog.manage')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.updateProduct(
      s.tenantId,
      idOf(id),
      parse(ProductUpdate, body),
    );
  }

  @Delete(':id')
  @RequirePermission('catalog.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.catalog.deleteProduct(s.tenantId, idOf(id));
  }

  // UMKMall's agent may ADD a photo (append only): it never deletes or replaces one, and never edits the product.
  @AgentRoute()
  @Post(':id/images')
  @RequirePermission('catalog.manage')
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
  @RequirePermission('catalog.manage')
  @HttpCode(204)
  async removeImage(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    await this.catalog.deleteImage(s.tenantId, idOf(id), idOf(imageId));
  }
}
